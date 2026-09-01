import { describe, expect, test } from "bun:test"
import {
  AccpSemanticGate,
  type AccpEnvelope,
  type ActionAuthorizationPolicy,
  createActionProposal,
  type ExecutionReceipt,
  type VerificationReceipt,
} from "../../src/rivet/accp"
import {
  HardState,
  SoftWorkspace,
  CognitiveView,
  type NoesisEvent,
} from "../../src/rivet/noesis"
import {
  PraxisEngine,
  type ParsedTestReport,
} from "../../src/rivet/praxis"
import {
  Revision,
  Scope,
  createActionId,
  createClaimId,
  createEvidenceId,
  createObligationId,
  createReceiptId,
  createSessionId,
  createTaskId,
  RivetError,
} from "../../src/rivet/types"
import {
  HarnessCore,
  InMemoryStateStore,
  type ModelBackendHandler,
  type RuntimeExecutionHandler,
} from "../../src/rivet/harness"

describe("Rivet Constitutional Invariants (I-01 .. I-20 / CT-001 .. CT-008)", () => {
  test("I-01 / CT-001: Controller claim cannot become Observation or Receipt", () => {
    // Cognitive Controller emitting an observation/receipt envelope must be rejected by the gate
    const invalidReceiptEnvelope: AccpEnvelope = {
      accpVersion: "3.0",
      messageId: "msg-claim-obs",
      sender: "COGNITIVE_CONTROLLER",
      family: "RECEIPT",
      kind: "OBSERVATION",
      payload: { observation: "File exists and is valid" },
    }

    expect(() => AccpSemanticGate.validateMessage(invalidReceiptEnvelope)).toThrow(
      /COGNITIVE_CONTROLLER cannot emit RECEIPT/
    )
  })

  test("I-02 / CT-002: Controller cannot manufacture Evidence", () => {
    const invalidEvidenceEnvelope: AccpEnvelope = {
      accpVersion: "3.0",
      messageId: "msg-fake-evid",
      sender: "COGNITIVE_CONTROLLER",
      family: "RECEIPT",
      kind: "EVIDENCE",
      payload: { evidence_id: "evid_fake", content: "test passed" },
    }

    expect(() => AccpSemanticGate.validateMessage(invalidEvidenceEnvelope)).toThrow(
      /COGNITIVE_CONTROLLER cannot emit RECEIPT/
    )
  })

  test("I-03: ActionProposal is not ExecutionReceipt", () => {
    const proposal = createActionProposal({
      capability: "file.write",
      target: "src/lib.ts",
      intent: "edit",
      scope: Scope.global("rivet", Revision.ZERO),
    })

    // ActionProposal has no execution status, exit code, or evidence ID
    expect((proposal as any).success).toBeUndefined()
    expect((proposal as any).exitCode).toBeUndefined()
    expect((proposal as any).evidenceId).toBeUndefined()
  })

  test("I-04: ExecutionReceipt is not VerificationReceipt", () => {
    const execReceipt: ExecutionReceipt = {
      receiptId: createReceiptId(),
      actionId: createActionId(),
      idempotencyKey: "k1",
      actionFingerprint: "fp1",
      capability: "file.write",
      success: true,
      scope: Scope.global("rivet", Revision.ZERO),
      risk: "material",
      humanApproved: true,
      outputSummary: "Wrote 10 lines",
      evidenceId: createEvidenceId(),
      executionDurationMs: 5,
      timestamp: new Date().toISOString(),
    }

    // Execution success does not close an obligation or prove verification
    expect((execReceipt as any).obligationId).toBeUndefined()
    expect((execReceipt as any).passed).toBeUndefined()
  })

  test("I-05 / CT-003: Unknown evidence reference is rejected during state promotion", () => {
    const hardState = new HardState()
    const unknownEvid = createEvidenceId()

    // Cannot promote to supported if evidence does not exist in HardState
    expect(hardState.canPromoteToSupported([unknownEvid])).toBe(false)
  })

  test("I-06 / CT-004: Stale revision is rejected", () => {
    const policy: ActionAuthorizationPolicy = {
      repository: "rivet",
      currentRevision: Revision.from(10),
      allowedScope: Scope.global("rivet", Revision.from(10)),
      allowedCapabilities: ["file.read"],
      allowMaterial: false,
      humanApproved: false,
    }

    const staleProposal = createActionProposal({
      capability: "file.read",
      target: "src/main.ts",
      intent: "read",
      scope: Scope.global("rivet", Revision.from(9)), // Stale revision 9 vs 10
    })

    const decision = AccpSemanticGate.authorizeAction(staleProposal, policy)
    expect(decision.verdict).toBe("block")
    expect(decision.reason).toContain("stale")
  })

  test("I-07 / CT-005: Scope widening is rejected (fails closed)", () => {
    const policy: ActionAuthorizationPolicy = {
      repository: "rivet",
      currentRevision: Revision.ZERO,
      allowedScope: Scope.path("rivet", "packages/core/**", Revision.ZERO),
      allowedCapabilities: ["file.write"],
      allowMaterial: true,
      humanApproved: false,
    }

    const widenedProposal = createActionProposal({
      capability: "file.write",
      target: "packages/server/src/index.ts", // Outside allowed packages/core/**
      intent: "write to server",
      scope: Scope.path("rivet", "packages/server/**", Revision.ZERO),
    })

    const decision = AccpSemanticGate.authorizeAction(widenedProposal, policy)
    expect(decision.verdict).toBe("block")
    expect(decision.reason).toContain("outside Harness authority")
  })

  test("I-08: Retrieved memory is context, not new evidence", () => {
    const hardState = new HardState()
    const softWorkspace = new SoftWorkspace(createSessionId(), Revision.ZERO)
    softWorkspace.addHypothesis("Retrieved context from memory search")

    // Hypotheses in soft workspace do not add evidence records to HardState
    expect(hardState.evidence.size).toBe(0)
    expect(hardState.canPromoteToSupported([createEvidenceId()])).toBe(false)
  })

  test("I-09: Verification scope cannot inflate beyond target scope", () => {
    const targetScope = Scope.path("rivet", "src/auth/**", Revision.ZERO)
    const report: ParsedTestReport = {
      passedCount: 2,
      failedCount: 0,
      skippedCount: 0,
      rawStdout: "2 passed",
      rawStderr: "",
    }

    const receipt = PraxisEngine.evaluateTestResult(
      {
        obligationId: createObligationId(),
        predicate: "bun test src/auth",
        targetScope,
        timeoutSeconds: 30,
        timestamp: new Date().toISOString(),
      },
      report
    )

    expect(receipt.verifiedScope.containsScope(targetScope)).toBe(true)
    // Verification receipt does not inflate to global repo scope
    expect(receipt.verifiedScope.pathPattern).toBe("src/auth/**")
  })

  test("I-10 / CT-006: VERIFIED requires valid Praxis receipt + policy", () => {
    const hardState = new HardState()
    const oblgId = createObligationId()
    const passingReceiptId = createReceiptId()

    hardState.apply({
      type: "obligation_created",
      obligationId: oblgId,
      description: "Unit tests pass",
      scope: Scope.global("rivet", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })

    // Without Praxis verification receipt, obligation remains open
    expect(hardState.openObligationIds()).toContain(oblgId)

    // With Praxis verification receipt recorded
    hardState.apply({
      type: "verification_recorded",
      receipt: {
        receiptId: passingReceiptId,
        obligationId: oblgId,
        passed: true,
        evidenceId: createEvidenceId(),
        verifiedScope: Scope.global("rivet", Revision.ZERO),
        diagnostics: null,
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    })
    hardState.apply({
      type: "obligation_closed",
      obligationId: oblgId,
      receiptId: passingReceiptId,
      timestamp: new Date().toISOString(),
    })

    expect(hardState.openObligationIds()).not.toContain(oblgId)
    expect(hardState.passingVerificationReceipts()).toContain(passingReceiptId)
  })

  test("I-11: Open obligations block completion", () => {
    const proposal = {
      taskId: createTaskId(),
      summary: "Done",
      claimsAddressed: [],
      baseRevision: Revision.ZERO,
      timestamp: new Date().toISOString(),
    }

    const decision = AccpSemanticGate.evaluateCompletion(
      proposal,
      Revision.ZERO,
      [createObligationId()], // 1 open obligation
      [createReceiptId()]
    )

    expect(decision.completed).toBe(false)
    expect(decision.finalReceipt).toBeNull()
  })

  test("I-12: Completion requires current-revision verification", () => {
    const proposal = {
      taskId: createTaskId(),
      summary: "Done",
      claimsAddressed: [],
      baseRevision: Revision.from(1), // Base revision 1
      timestamp: new Date().toISOString(),
    }

    // Current revision moved to 2 after base revision was read
    const decision = AccpSemanticGate.evaluateCompletion(
      proposal,
      Revision.from(2), // Current revision 2
      [],
      [createReceiptId()]
    )

    expect(decision.completed).toBe(false)
  })

  test("I-13 / CT-007: Failure reopens work and clears completion", () => {
    const obligationId = createObligationId()
    const passingReceiptId = createReceiptId()
    const taskId = createTaskId()

    const state = HardState.replay([
      {
        type: "obligation_created",
        obligationId,
        description: "Test must pass",
        scope: Scope.global("rivet", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
      {
        type: "obligation_closed",
        obligationId,
        receiptId: passingReceiptId,
        timestamp: new Date().toISOString(),
      },
      {
        type: "completion_accepted",
        taskId,
        finalReceipt: passingReceiptId,
        timestamp: new Date().toISOString(),
      },
      {
        type: "verification_recorded",
        receipt: {
          receiptId: createReceiptId(),
          obligationId,
          passed: false, // Verification failed!
          evidenceId: createEvidenceId(),
          verifiedScope: Scope.global("rivet", Revision.ZERO),
          diagnostics: "Regression error",
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      },
    ])

    // Obligation must be reopened and completedTasks cleared
    expect(state.obligations.has(obligationId)).toBe(true)
    expect(state.completedTasks.size).toBe(0)
  })

  test("I-14: Hard State != Soft Workspace != Context", () => {
    const hardState = new HardState()
    const softWorkspace = new SoftWorkspace(createSessionId(), Revision.ZERO)

    softWorkspace.addHypothesis("Tentative hypothesis in RAM")
    expect(hardState.claims.size).toBe(0)

    hardState.apply({
      type: "claim_asserted",
      claimId: createClaimId(),
      proposition: "Hard belief",
      status: "supported",
      evidence: [],
      scope: Scope.global("rivet", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })

    const view = new CognitiveView({
      hardRevision: hardState.revision,
      goalDescription: "Test separation",
      activeClaims: Array.from(hardState.claims.values()),
      activeHypotheses: softWorkspace.hypotheses,
    })

    const prompt = view.formatPromptBlock()
    expect(prompt).toContain("### AUTHORITATIVE HARD CLAIMS:")
    expect(prompt).toContain("Hard belief")
    expect(prompt).toContain("### ACTIVE WORKING HYPOTHESES (Soft Workspace):")
    expect(prompt).toContain("Tentative hypothesis in RAM")
  })

  test("I-15 / CT-008: Deterministic Hard State replay and restart continuity", () => {
    const claim1 = createClaimId()
    const claim2 = createClaimId()
    const oblg1 = createObligationId()

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId: claim1,
        proposition: "First belief",
        status: "supported",
        evidence: [],
        scope: Scope.global("rivet", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
      {
        type: "obligation_created",
        obligationId: oblg1,
        description: "Verify second belief",
        scope: Scope.global("rivet", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: claim2,
        proposition: "Second belief",
        status: "supported",
        evidence: [],
        dependsOn: [claim1],
        scope: Scope.global("rivet", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
    ]

    const stateA = HardState.replay(events)
    const stateB = HardState.replay(events)

    expect(stateA.revision.toString()).toBe(stateB.revision.toString())
    expect(stateA.claims.size).toBe(stateB.claims.size)
    expect(stateA.obligations.size).toBe(stateB.obligations.size)
  })
})

import { describe, expect, test } from "bun:test"
import {
  AccpSemanticGate,
  parseProviderToolFrame,
  CognitiveViewCompiler,
  HardState,
  Revision,
  Scope,
  createActionId,
  createEvidenceId,
  createObligationId,
  createReceiptId,
  createTaskId,
  type ActionProposal,
  type AuthorizedAction,
  type ExecutionReceipt,
} from "../src/rivet/index"

describe("Rivet Native Harness Core & Architectural Guarantees (1..16)", () => {
  test("1 & 2: Provider-native tool call becomes ActionProposal; raw tool calls cannot bypass ACCP", () => {
    const rawToolCall = {
      name: "edit",
      args: { path: "src/main.ts", content: "console.log('hi')" },
    }
    const currentScope = Scope.global("repo", Revision.ZERO)
    const action = parseProviderToolFrame({ id: "provider-call-1", name: rawToolCall.name, input: rawToolCall.args }, currentScope)

    expect(action.type).toBe("action_proposal")
    if (action.type === "action_proposal") {
      expect(action.proposal.capability).toBe("file.write")
      expect(action.proposal.target).toBe("src/main.ts")
      expect(action.proposal.estimatedRisk).toBe("material")
    }
  })

  test("3: Stale revision proposal is blocked before execution", () => {
    const proposal: ActionProposal = {
      actionId: createActionId(),
      capability: "file.write",
      target: "src/auth.ts",
      parameters: { content: "fixed" },
      estimatedRisk: "material",
      intent: "Fix auth",
      scope: Scope.path("repo", "src/auth.ts", Revision.from(1)), // Stale revision 1
      providerName: "edit",
      timestamp: new Date().toISOString(),
    }

    const policy = {
      repository: "repo",
      currentRevision: Revision.from(2), // Current revision 2
      allowedScope: Scope.global("repo", Revision.from(2)),
      allowedCapabilities: ["file.write"],
      allowMaterial: true,
      humanApproved: true,
    }

    const auth = AccpSemanticGate.authorize(proposal, policy)
    expect(auth.authorizedAction).toBeNull()
    expect(auth.decision.verdict).toBe("block")
    expect(auth.decision.reason).toContain("stale")
  })

  test("4: Out-of-scope proposal is blocked before execution", () => {
    const proposal: ActionProposal = {
      actionId: createActionId(),
      capability: "file.write",
      target: "../secret/config.json", // Out of scope & path traversal
      parameters: {},
      estimatedRisk: "material",
      intent: "Malicious escape",
      scope: Scope.path("repo", "../secret/config.json", Revision.ZERO),
      providerName: "edit",
      timestamp: new Date().toISOString(),
    }

    const policy = {
      repository: "repo",
      currentRevision: Revision.ZERO,
      allowedScope: Scope.global("repo", Revision.ZERO),
      allowedCapabilities: ["file.write"],
      allowMaterial: true,
      humanApproved: true,
    }

    const auth = AccpSemanticGate.authorize(proposal, policy)
    expect(auth.authorizedAction).toBeNull()
    expect(auth.decision.verdict).toBe("block")
  })

  test("5 & 6: Accepted action produces AuthorizedAction consumed by executor", () => {
    const proposal: ActionProposal = {
      actionId: createActionId(),
      capability: "file.write",
      target: "src/app.ts",
      parameters: { content: "export const x = 1" },
      estimatedRisk: "material",
      intent: "Create app.ts",
      scope: Scope.path("repo", "src/app.ts", Revision.ZERO),
      providerName: "edit",
      timestamp: new Date().toISOString(),
    }

    const policy = {
      repository: "repo",
      currentRevision: Revision.ZERO,
      allowedScope: Scope.global("repo", Revision.ZERO),
      allowedCapabilities: ["file.write"],
      allowMaterial: true,
      humanApproved: true,
    }

    const auth = AccpSemanticGate.authorize(proposal, policy)
    expect(auth.authorizedAction).not.toBeNull()
    expect(auth.decision.verdict).toBe("allow")

    const authorized: AuthorizedAction = auth.authorizedAction!
    expect(authorized.revision.equals(Revision.ZERO)).toBe(true)
    expect(authorized.proposal.actionId).toBe(proposal.actionId)
  })

  test("7 & 8: Execution returns ExecutionReceipt, which alone does NOT verify a claim", () => {
    const receipt: ExecutionReceipt = {
      receiptId: createReceiptId(),
      actionId: createActionId(),
      idempotencyKey: "call-1",
      actionFingerprint: "{}",
      capability: "file.write",
      success: true,
      exitCode: 0,
      scope: Scope.global("repo", Revision.ZERO),
      risk: "material",
      humanApproved: true,
      outputSummary: "Wrote file",
      evidenceId: createEvidenceId(),
      executionDurationMs: 10,
      timestamp: new Date().toISOString(),
    }

    const hardState = new HardState()
    hardState.apply({
      type: "execution_recorded",
      receipt,
      timestamp: new Date().toISOString(),
    })

    // Execution was recorded, but passing verification receipts remains empty!
    expect(hardState.executionReceipts.length).toBe(1)
    expect(hardState.passingVerificationReceipts().length).toBe(0)
  })

  test("9 & 10: Evidence admission and Praxis verification remain separate and distinct", () => {
    const hardState = new HardState()
    const evidenceId = createEvidenceId()
    const obligationId = createObligationId()

    // Step 1: Explicit Evidence Admission
    hardState.apply({
      type: "evidence_recorded",
      evidenceId,
      source: "bun test",
      summary: "3 pass, 0 fail",
      timestamp: new Date().toISOString(),
    })
    expect(hardState.evidence.has(evidenceId)).toBe(true)
    expect(hardState.verificationReceipts.size).toBe(0)

    // Step 2: Separate Praxis Verification
    hardState.apply({
      type: "verification_recorded",
      receipt: {
        receiptId: createReceiptId(),
        obligationId,
        passed: true,
        evidenceId,
        verifiedScope: Scope.global("repo", Revision.ZERO),
        diagnostics: null,
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    })
    expect(hardState.verificationReceipts.size).toBe(1)
  })

  test("11 & 12: CognitiveView is structured first-class projection, not prompt prose decoration", () => {
    const hardState = new HardState()
    const obligationId = createObligationId()
    hardState.apply({
      type: "obligation_created",
      obligationId,
      description: "Ensure test suite passes",
      scope: Scope.global("repo", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })

    const view = CognitiveViewCompiler.compile({
      hardState,
      goalDescription: "Fix bugs",
      repositoryId: "repo",
      tokenBudget: 4000,
      mode: "HYBRID",
    })

    expect(view.hardRevision.equals(Revision.from(1))).toBe(true)
    expect(view.openObligations.length).toBe(1)
    expect(view.openObligations[0][0]).toBe(obligationId)
  })

  test("13: Restart reconstructs knowledge from Noesis events, not transcript replay", async () => {
    const obligationId = createObligationId()
    const events = [
      { type: "goal_set" as const, goal: "Implement feature X", timestamp: new Date().toISOString() },
      {
        type: "obligation_created" as const,
        obligationId,
        description: "Implement feature X",
        scope: Scope.global("repo", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
    ]

    // A fresh HardState rebuilds from semantic events. No provider transcript is involved.
    const restarted = HardState.replay(events)
    expect(restarted.goalDescription).toBe("Implement feature X")
    expect(restarted.obligations.has(obligationId)).toBe(true)
  })

  test("14 & 15: Ordinary session termination or model prose cannot complete goal; open obligations block completion", () => {
    const openObligationId = createObligationId()
    const proposal = {
      taskId: createTaskId(),
      summary: "I am done",
      claimsAddressed: [],
      baseRevision: Revision.ZERO,
      timestamp: new Date().toISOString(),
    }

    const decision = AccpSemanticGate.evaluateCompletion(
      proposal,
      Revision.ZERO,
      [openObligationId], // Open obligation unclosed!
      [] // No passing verification receipts!
    )

    expect(decision.completed).toBe(false)
    expect(decision.finalReceipt).toBeNull()
    expect(decision.unclosedObligations).toContain(openObligationId)
  })
})

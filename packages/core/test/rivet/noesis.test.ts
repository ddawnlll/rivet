import { describe, expect, test } from "bun:test"
import {
  HardState,
  SoftWorkspace,
  CognitiveView,
  type NoesisEvent,
} from "../../src/rivet/noesis"
import {
  Revision,
  Scope,
  createClaimId,
  createEvidenceId,
  createObligationId,
  createReceiptId,
  createSessionId,
  createTaskId,
} from "../../src/rivet/types"
import type { VerificationReceipt } from "../../src/rivet/accp"

describe("Noesis State Kernel & Bounded Workspace", () => {
  test("Event replay determinism: same event history -> same materialized state", () => {
    const claimId = createClaimId()
    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId,
        proposition: "State is event-sourced",
        status: "supported",
        evidence: [],
        scope: Scope.global("rivet", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_status_changed",
        claimId,
        newStatus: "verified",
        reason: "Praxis PASS",
        timestamp: new Date().toISOString(),
      },
    ]

    const state1 = HardState.replay(events)
    const state2 = HardState.replay(events)

    expect(state1.revision.toString()).toBe("r2")
    expect(state1.claims.get(claimId)?.status).toBe("verified")
    expect(state1.revision.equals(state2.revision)).toBe(true)
  })

  test("Soft Workspace is strictly bounded in RAM", () => {
    const ws = new SoftWorkspace(createSessionId(), Revision.ZERO)
    ws.maxCapacityItems = 3
    ws.setFocus(["focus-a", "focus-b"])
    ws.addHypothesis("hypothesis-a")
    ws.addUnknown("unknown-a")
    ws.addCandidateAction("action-a")

    expect(ws.itemCount()).toBeLessThanOrEqual(ws.maxCapacityItems)
  })

  test("Recursive invalidation cascade", () => {
    const rootClaim = createClaimId()
    const depClaim = createClaimId()
    const leafClaim = createClaimId()

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId: rootClaim,
        proposition: "Root premise",
        status: "supported",
        evidence: [],
        scope: Scope.global("repo", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: depClaim,
        proposition: "Dependent premise",
        status: "supported",
        evidence: [],
        dependsOn: [rootClaim],
        scope: Scope.global("repo", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: leafClaim,
        proposition: "Leaf premise",
        status: "supported",
        evidence: [],
        dependsOn: [depClaim],
        scope: Scope.global("repo", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_contradicted",
        claimId: rootClaim,
        contradictedBy: [createEvidenceId()],
        reason: "Falsified by test",
        scope: Scope.global("repo", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)
    expect(state.claims.get(rootClaim)?.status).toBe("rejected")
    expect(state.claims.get(depClaim)?.status).toBe("rejected")
    expect(state.claims.get(leafClaim)?.status).toBe("rejected")
    expect(state.rejectedClaims.has(depClaim)).toBe(true)
    expect(state.rejectedClaims.has(leafClaim)).toBe(true)
  })

  test("Failed verification reopens closed obligation and clears completed tasks", () => {
    const obligationId = createObligationId()
    const receiptId = createReceiptId()
    const taskId = createTaskId()

    const failedReceipt: VerificationReceipt = {
      receiptId: createReceiptId(),
      obligationId,
      passed: false,
      evidenceId: createEvidenceId(),
      verifiedScope: Scope.global("rivet", Revision.ZERO),
      diagnostics: "Regression failure",
      timestamp: new Date().toISOString(),
    }

    const events: NoesisEvent[] = [
      {
        type: "obligation_created",
        obligationId,
        description: "Must pass tests",
        scope: Scope.global("rivet", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
      {
        type: "obligation_closed",
        obligationId,
        receiptId,
        timestamp: new Date().toISOString(),
      },
      {
        type: "completion_accepted",
        taskId,
        finalReceipt: receiptId,
        timestamp: new Date().toISOString(),
      },
      {
        type: "verification_recorded",
        receipt: failedReceipt,
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)
    expect(state.obligations.has(obligationId)).toBe(true)
    expect(state.closedObligations.has(obligationId)).toBe(false)
    expect(state.completedTasks.size).toBe(0)
  })

  test("Cognitive View formats prompt block and respects token/byte bounds", () => {
    const view = new CognitiveView({
      hardRevision: Revision.ZERO,
      goalDescription: "Implement feature X",
      activeClaims: [],
      contradictions: ["Claim A contradicts Evidence B"],
      openObligations: ["oblg_1: Verify unit tests pass"],
      tokenBudgetHint: 1024,
    })

    const text = view.formatPromptBlock()
    expect(text).toContain("### CURRENT GOAL")
    expect(text).toContain("Claim A contradicts Evidence B")
    expect(text).toContain("oblg_1: Verify unit tests pass")

    const smallView = new CognitiveView({
      hardRevision: Revision.ZERO,
      goalDescription: "x".repeat(1000),
      tokenBudgetHint: 16,
    })
    expect(smallView.formatPromptBlock()).toContain("[view truncated]")
  })
})

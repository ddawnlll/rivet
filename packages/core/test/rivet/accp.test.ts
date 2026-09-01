import { describe, expect, test } from "bun:test"
import {
  AccpSemanticGate,
  type AccpEnvelope,
  type ActionAuthorizationPolicy,
  createActionProposal,
  type ClaimProposal,
  type CompletionProposal,
} from "../../src/rivet/accp"
import {
  Revision,
  Scope,
  createActionId,
  createClaimId,
  createObligationId,
  createReceiptId,
  createTaskId,
  RivetError,
} from "../../src/rivet/types"

describe("ACCP 3.0 Protocol & Semantic Gates", () => {
  test("Producer matrix validation: Controller cannot emit DECISION or RECEIPT", () => {
    const invalidEnvelope: AccpEnvelope = {
      accpVersion: "3.0",
      messageId: "msg_1",
      sender: "COGNITIVE_CONTROLLER",
      family: "DECISION",
      kind: "ACTION",
      payload: { verdict: "allow" },
    }

    expect(() => AccpSemanticGate.validateMessage(invalidEnvelope)).toThrow(
      /COGNITIVE_CONTROLLER cannot emit DECISION/
    )
  })

  test("Producer matrix validation: Harness cannot emit PROPOSAL", () => {
    const invalidEnvelope: AccpEnvelope = {
      accpVersion: "3.0",
      messageId: "msg_2",
      sender: "HARNESS",
      family: "PROPOSAL",
      kind: "ACTION",
      payload: { target: "src/main.ts" },
    }

    expect(() => AccpSemanticGate.validateMessage(invalidEnvelope)).toThrow(
      /HARNESS cannot emit PROPOSAL/
    )
  })

  test("Claim proposal: Controller cannot directly mint VERIFIED status", () => {
    const illegalClaim: ClaimProposal = {
      claimId: createClaimId(),
      proposition: "Fixed the bug",
      proposedStatus: "verified",
      supportingEvidence: [],
      scope: Scope.global("repo", Revision.ZERO),
      timestamp: new Date().toISOString(),
    }

    expect(() => AccpSemanticGate.validateClaimProposal(illegalClaim)).toThrow(
      /Controller cannot mint VERIFIED/
    )
  })

  test("Action authorization: Stale revision is blocked", () => {
    const policy: ActionAuthorizationPolicy = {
      repository: "rivet",
      currentRevision: Revision.from(5),
      allowedScope: Scope.global("rivet", Revision.from(5)),
      allowedCapabilities: ["file.read", "file.write"],
      allowMaterial: true,
      humanApproved: false,
    }

    const staleProposal = createActionProposal({
      capability: "file.read",
      target: "src/main.ts",
      intent: "read file",
      scope: Scope.path("rivet", "src/**", Revision.from(4)), // stale revision 4 vs 5
    })

    const decision = AccpSemanticGate.authorizeAction(staleProposal, policy)
    expect(decision.verdict).toBe("block")
    expect(decision.reason).toContain("stale")
  })

  test("Action authorization: Scope widening or escape is blocked", () => {
    const policy: ActionAuthorizationPolicy = {
      repository: "rivet",
      currentRevision: Revision.ZERO,
      allowedScope: Scope.path("rivet", "src/**", Revision.ZERO),
      allowedCapabilities: ["file.read"],
      allowMaterial: false,
      humanApproved: false,
    }

    const outsideProposal = createActionProposal({
      capability: "file.read",
      target: "docs/readme.md", // outside src/**
      intent: "read docs",
      scope: Scope.path("rivet", "docs/**", Revision.ZERO),
    })

    const decision = AccpSemanticGate.authorizeAction(outsideProposal, policy)
    expect(decision.verdict).toBe("block")
    expect(decision.reason).toContain("outside Harness authority")
  })

  test("Action authorization: Destructive action requires human approval", () => {
    const policyWithoutApproval: ActionAuthorizationPolicy = {
      repository: "rivet",
      currentRevision: Revision.ZERO,
      allowedScope: Scope.global("rivet", Revision.ZERO),
      allowedCapabilities: ["git.reset"],
      allowMaterial: true,
      humanApproved: false,
    }

    const destructiveProposal = createActionProposal({
      capability: "git.reset",
      target: "src/main.ts",
      estimatedRisk: "destructive",
      intent: "hard reset",
      scope: Scope.global("rivet", Revision.ZERO),
    })

    const decision = AccpSemanticGate.authorizeAction(destructiveProposal, policyWithoutApproval)
    expect(decision.verdict).toBe("require_human_approval")
  })

  test("Completion gating: Open obligations block completion", () => {
    const unclosed = [createObligationId()]
    expect(() => AccpSemanticGate.checkCompletionAuthority(unclosed)).toThrow(
      /obligations remain unverified/
    )
  })

  test("Completion gating: Evaluation requires passing receipt and zero open obligations", () => {
    const proposal: CompletionProposal = {
      taskId: createTaskId(),
      summary: "Work finished",
      claimsAddressed: [],
      baseRevision: Revision.from(2),
      timestamp: new Date().toISOString(),
    }
    const receipt = createReceiptId()

    // With open obligations -> incomplete
    const incomplete = AccpSemanticGate.evaluateCompletion(
      proposal,
      Revision.from(2),
      [createObligationId()],
      [receipt]
    )
    expect(incomplete.completed).toBe(false)
    expect(incomplete.finalReceipt).toBeNull()

    // Without open obligations and with receipt -> complete
    const complete = AccpSemanticGate.evaluateCompletion(
      proposal,
      Revision.from(2),
      [],
      [receipt]
    )
    expect(complete.completed).toBe(true)
    expect(complete.finalReceipt).toBe(receipt)
  })
})

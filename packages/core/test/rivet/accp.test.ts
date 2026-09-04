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

  test("Action authorization: Equivalent repository-relative and absolute targets get the same decision", () => {
    // Production shape: the Harness repository identity is the session
    // location's absolute directory, while provider read targets may arrive
    // as either repository-relative or absolute spellings of the same file.
    const repository = "/work/checkouts/rivet"
    const file = "packages/core/src/rivet/goal-compiler.ts"
    const policy: ActionAuthorizationPolicy = {
      repository,
      currentRevision: Revision.ZERO,
      allowedScope: Scope.global(repository, Revision.ZERO),
      allowedCapabilities: ["file.read"],
      allowMaterial: false,
      humanApproved: false,
    }
    const read = (target: string) =>
      AccpSemanticGate.authorizeAction(
        createActionProposal({
          capability: "file.read",
          target,
          intent: "read file",
          scope: Scope.global(repository, Revision.ZERO),
        }),
        policy
      )

    expect(read(file).verdict).toBe("allow")
    expect(read(`${repository}/${file}`).verdict).toBe("allow")
    // Alternate lexical spellings of the same repository-local file canonicalize identically
    expect(read(`./${file}`).verdict).toBe("allow")
    expect(read(`${repository}/./packages//core/src/rivet/./goal-compiler.ts`).verdict).toBe("allow")
    expect(read(`${repository}/${file}/`).verdict).toBe("allow")
  })

  test("Action authorization: Absolute escape spellings remain blocked (fails closed)", () => {
    const repository = "/work/checkouts/rivet"
    const policy: ActionAuthorizationPolicy = {
      repository,
      currentRevision: Revision.ZERO,
      allowedScope: Scope.global(repository, Revision.ZERO),
      allowedCapabilities: ["file.read"],
      allowMaterial: false,
      humanApproved: false,
    }
    const read = (target: string) =>
      AccpSemanticGate.authorizeAction(
        createActionProposal({
          capability: "file.read",
          target,
          intent: "read file",
          scope: Scope.global(repository, Revision.ZERO),
        }),
        policy
      )

    // Outside the repository root entirely
    const outside = read("/etc/passwd")
    expect(outside.verdict).toBe("block")
    expect(outside.reason).toContain("outside Harness authority")
    // Sibling directory sharing the root's name as a string prefix
    expect(read("/work/checkouts/rivet-evils/x.ts").verdict).toBe("block")
    // Traversal disguised inside an absolute spelling
    expect(read(`${repository}/packages/../../secrets.env`).verdict).toBe("block")
    // Drive-style absolute against a POSIX root: no containment proof exists
    expect(read("C:/Windows/x.ts").verdict).toBe("block")
    // UNC network share
    expect(read("//server/share/x").verdict).toBe("block")
    // Repository-relative traversal still blocked
    expect(read("../outside.ts").verdict).toBe("block")
  })

  test("Action authorization: Contained scope policy applies to absolute spellings too", () => {
    const repository = "/work/checkouts/rivet"
    const policy: ActionAuthorizationPolicy = {
      repository,
      currentRevision: Revision.ZERO,
      allowedScope: Scope.path(repository, "packages/core/**", Revision.ZERO),
      allowedCapabilities: ["file.read"],
      allowMaterial: false,
      humanApproved: false,
    }
    const read = (target: string) =>
      AccpSemanticGate.authorizeAction(
        createActionProposal({
          capability: "file.read",
          target,
          intent: "read file",
          scope: Scope.path(repository, "packages/core/**", Revision.ZERO),
        }),
        policy
      )

    expect(read("packages/core/src/x.ts").verdict).toBe("allow")
    expect(read(`${repository}/packages/core/src/x.ts`).verdict).toBe("allow")
    const outsideScope = read(`${repository}/docs/x.md`)
    expect(outsideScope.verdict).toBe("block")
    expect(outsideScope.reason).toContain("outside Harness authority")
  })

  test("Action authorization: Absolute targets against a symbolic repository identity fail closed", () => {
    // A non-path repository identity cannot establish filesystem containment
    // for an absolute target; only repository-relative spellings are accepted.
    const policy: ActionAuthorizationPolicy = {
      repository: "rivet",
      currentRevision: Revision.ZERO,
      allowedScope: Scope.global("rivet", Revision.ZERO),
      allowedCapabilities: ["file.read"],
      allowMaterial: false,
      humanApproved: false,
    }
    const read = (target: string) =>
      AccpSemanticGate.authorizeAction(
        createActionProposal({
          capability: "file.read",
          target,
          intent: "read file",
          scope: Scope.global("rivet", Revision.ZERO),
        }),
        policy
      )

    expect(read("src/main.ts").verdict).toBe("allow")
    const ambiguous = read("/rivet/src/main.ts")
    expect(ambiguous.verdict).toBe("block")
    expect(ambiguous.reason).toContain("repository-local")
  })

  test("Action authorization: Rejection reason names the failed authority predicate", () => {
    const repository = "/work/checkouts/rivet"
    const policy: ActionAuthorizationPolicy = {
      repository,
      currentRevision: Revision.ZERO,
      allowedScope: Scope.path(repository, "packages/core/**", Revision.ZERO),
      allowedCapabilities: ["file.read"],
      allowMaterial: false,
      humanApproved: false,
    }

    const wrongRepo = AccpSemanticGate.authorizeAction(
      createActionProposal({
        capability: "file.read",
        target: "packages/core/src/x.ts",
        intent: "read",
        scope: Scope.global("other-repo", Revision.ZERO),
      }),
      policy
    )
    expect(wrongRepo.reason).toContain("repository does not match")

    const widened = AccpSemanticGate.authorizeAction(
      createActionProposal({
        capability: "file.read",
        target: "packages/core/src/x.ts",
        intent: "read",
        scope: Scope.global(repository, Revision.ZERO),
      }),
      policy
    )
    expect(widened.reason).toContain("not contained in Harness allowed scope")

    const badTarget = AccpSemanticGate.authorizeAction(
      createActionProposal({
        capability: "file.read",
        target: "/etc/passwd",
        intent: "read",
        scope: Scope.path(repository, "packages/core/**", Revision.ZERO),
      }),
      policy
    )
    expect(badTarget.reason).toContain("cannot be established as repository-local")

    const outsidePattern = AccpSemanticGate.authorizeAction(
      createActionProposal({
        capability: "file.read",
        target: "docs/readme.md",
        intent: "read",
        scope: Scope.path(repository, "packages/core/src/**", Revision.ZERO),
      }),
      policy
    )
    expect(outsidePattern.reason).toContain("canonicalized target is outside Harness allowed scope")
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

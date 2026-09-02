import { describe, expect, test } from "bun:test"
import {
  HardState,
  type NoesisEvent,
} from "../../src/rivet/noesis"
import {
  Revision,
  Scope,
  createClaimId,
  createEvidenceId,
  createObligationId,
} from "../../src/rivet/types"
import { ValidityEngine } from "../../src/rivet/validity"
import { CognitiveViewCompiler } from "../../src/rivet/view-compiler"

describe("Rivet Epistemic Event Replay Determinism & Crash Recovery", () => {
  test("Complex event history with invalidation, supersession and premise conflicts replays identically", () => {
    const scope = Scope.global("project-x", Revision.ZERO)
    const c1 = createClaimId("c1")
    const c2 = createClaimId("c2")
    const c3 = createClaimId("c3")

    const events: NoesisEvent[] = [
      {
        type: "goal_set",
        goal: "Build compiler frontend",
        timestamp: new Date().toISOString(),
      },
      {
        type: "obligation_created",
        obligationId: createObligationId("ob1"),
        description: "Parse AST tokens",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: c1,
        proposition: "Lexer uses regular expressions",
        status: "supported",
        evidence: [],
        dependencies: [{ type: "file", path: "src/lexer.ts" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: c2,
        proposition: "Parser is recursive descent",
        status: "verified",
        evidence: [],
        dependencies: [{ type: "file", path: "src/parser.ts" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_dirtied",
        claimId: c1,
        reason: "lexer.ts rewritten",
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_superseded",
        claimId: c1,
        supersededBy: c3,
        reason: "Superseded by hand-written state machine",
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: c3,
        proposition: "Lexer uses hand-written deterministic state machine",
        status: "verified",
        evidence: [],
        dependencies: [{ type: "file", path: "src/lexer_fsm.ts" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "premise_conflict_detected",
        conflict: {
          userPremise: "Lexer uses regex",
          currentValidState: "Lexer uses hand-written deterministic state machine",
          conflictingClaimId: c1,
          supersededAtRevision: Revision.from(6),
          evidenceRefs: [],
        },
        timestamp: new Date().toISOString(),
      },
    ]

    const stateA = HardState.replay(events)
    const stateB = HardState.replay(events)

    expect(stateA.revision.equals(stateB.revision)).toBe(true)
    expect(stateA.claims.get(c1)?.status).toBe("superseded")
    expect(stateB.claims.get(c1)?.status).toBe("superseded")
    expect(stateA.claims.get(c2)?.status).toBe("verified")
    expect(stateA.claims.get(c3)?.status).toBe("verified")

    // Compile view on both states
    const viewA = CognitiveViewCompiler.compile({
      hardState: stateA,
      goalDescription: "Build compiler frontend",
      repositoryId: "project-x",
      tokenBudget: 2000,
      mode: "HYBRID",
    })

    const viewB = CognitiveViewCompiler.compile({
      hardState: stateB,
      goalDescription: "Build compiler frontend",
      repositoryId: "project-x",
      tokenBudget: 2000,
      mode: "HYBRID",
    })

    expect(viewA.activeClaims.map((c) => c.id)).toEqual(viewB.activeClaims.map((c) => c.id))
    expect(viewA.premiseConflicts.length).toBe(viewB.premiseConflicts.length)
  })
})

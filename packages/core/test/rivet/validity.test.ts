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
  createReceiptId,
} from "../../src/rivet/types"
import { ValidityEngine, ValidityGraph } from "../../src/rivet/validity"

describe("Rivet Validity-Aware Bi-Temporal Epistemic Memory (P0/P1 Invariants)", () => {
  test("Invariant 1 & 6: Current mutable claim becomes DIRTY when underlying dependency changes", () => {
    const claimId = createClaimId()
    const scope = Scope.global("rivet", Revision.ZERO)

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId,
        proposition: "Authentication uses JWT tokens in auth.ts",
        status: "supported",
        evidence: [],
        dependencies: [{ type: "file", path: "src/auth.ts" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)
    expect(state.claims.get(claimId)?.status).toBe("supported")

    // File change observed
    const impact = ValidityEngine.analyzeEnvironmentChanges(state.validityGraph, state, [
      { type: "file_modified", path: "src/auth.ts" },
    ])

    expect(impact.allDirtyClaimIds).toContain(claimId)

    // Apply dirty transition
    state.apply({
      type: "claim_dirtied",
      claimId,
      reason: "File src/auth.ts was modified",
      timestamp: new Date().toISOString(),
    })

    expect(state.claims.get(claimId)?.status).toBe("dirty")

    // Invariant 7: Dirty claims have ZERO operational authority in Read-Time Barrier
    const barrier = ValidityEngine.applyReadTimeBarrier(state)
    expect(barrier.activeClaims.map((c) => c.id)).not.toContain(claimId)
    expect(barrier.dirtyClaims.map((c) => c.id)).toContain(claimId)
  })

  test("Invariant 4: Unaffected claims remain valid during localized environment change", () => {
    const authClaim = createClaimId()
    const dbClaim = createClaimId()
    const scope = Scope.global("rivet", Revision.ZERO)

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId: authClaim,
        proposition: "Auth module uses bcrypt",
        status: "verified",
        evidence: [],
        dependencies: [{ type: "file", path: "src/auth.ts" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: dbClaim,
        proposition: "Database uses PostgreSQL connection pool",
        status: "verified",
        evidence: [],
        dependencies: [{ type: "file", path: "src/db.ts" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)

    // Modify only auth.ts
    const impact = ValidityEngine.analyzeEnvironmentChanges(state.validityGraph, state, [
      { type: "file_modified", path: "src/auth.ts" },
    ])

    expect(impact.allDirtyClaimIds).toContain(authClaim)
    expect(impact.allDirtyClaimIds).not.toContain(dbClaim)

    state.apply({
      type: "claim_dirtied",
      claimId: authClaim,
      reason: "auth.ts modified",
      timestamp: new Date().toISOString(),
    })

    const barrier = ValidityEngine.applyReadTimeBarrier(state)
    expect(barrier.activeClaims.map((c) => c.id)).toContain(dbClaim)
    expect(barrier.activeClaims.map((c) => c.id)).not.toContain(authClaim)
  })

  test("Invariant 5: Historical observations never become stale or dirty merely because environment changed", () => {
    const historicalClaim = createClaimId()
    const scope = Scope.global("rivet", Revision.ZERO)

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId: historicalClaim,
        proposition: "At revision 83, cargo test failed with lifetime error in engine.rs",
        status: "verified",
        evidence: [],
        dependencies: [{ type: "file", path: "src/engine.rs" }],
        validityPolicy: "HISTORICAL",
        scope,
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)

    // Modify engine.rs
    const impact = ValidityEngine.analyzeEnvironmentChanges(state.validityGraph, state, [
      { type: "file_modified", path: "src/engine.rs" },
    ])

    // Historical policy protects it from being marked dirty
    expect(impact.allDirtyClaimIds).not.toContain(historicalClaim)
    expect(state.claims.get(historicalClaim)?.status).toBe("verified")

    const barrier = ValidityEngine.applyReadTimeBarrier(state)
    expect(barrier.historicalClaims.map((c) => c.id)).toContain(historicalClaim)
  })

  test("Bi-Temporal Semantics: Distinct valid-time vs learned-time revisions", () => {
    const claimId = createClaimId()
    const scope = Scope.global("rivet", Revision.ZERO)

    const state = new HardState()
    // Simulate runtime at revision 50
    for (let i = 0; i < 50; i++) {
      state.apply({
        type: "evidence_recorded",
        evidenceId: createEvidenceId(),
        source: "test",
        summary: `Evidence ${i}`,
        timestamp: new Date().toISOString(),
      })
    }

    // A fact that was true in the world at revision 10 is learned by Rivet at revision 51
    state.apply({
      type: "claim_asserted",
      claimId,
      proposition: "Project adopted TypeScript at r10",
      status: "supported",
      evidence: [],
      validFromRevision: Revision.from(10),
      validityPolicy: "HISTORICAL",
      scope,
      timestamp: new Date().toISOString(),
    })

    const claim = state.claims.get(claimId)!
    expect(claim.validFromRevision.toString()).toBe("r10")
    expect(claim.learnedAtRevision.toString()).toBe("r51")
  })
})

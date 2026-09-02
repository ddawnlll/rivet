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
} from "../../src/rivet/types"
import { ValidityEngine } from "../../src/rivet/validity"
import { CognitiveViewCompiler } from "../../src/rivet/view-compiler"

describe("Rivet Read-Time Validity Barrier & Memory Frontier (P2 Invariants)", () => {
  test("Invariant 2 & 3: Stale / Superseded / Dirty memories cannot enter active claims", () => {
    const scope = Scope.global("demo", Revision.ZERO)
    const activeClaim = createClaimId("c_active")
    const dirtyClaim = createClaimId("c_dirty")
    const supersededClaim = createClaimId("c_superseded")
    const rejectedClaim = createClaimId("c_rejected")

    const state = new HardState()

    state.apply({
      type: "claim_asserted",
      claimId: activeClaim,
      proposition: "Server listens on port 3000",
      status: "verified",
      evidence: [],
      dependencies: [{ type: "file", path: "server.ts" }],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    state.apply({
      type: "claim_asserted",
      claimId: dirtyClaim,
      proposition: "Database uses pool size 50",
      status: "dirty",
      evidence: [],
      dependencies: [{ type: "file", path: "db.ts" }],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    state.apply({
      type: "claim_asserted",
      claimId: supersededClaim,
      proposition: "Legacy auth uses MD5 hashing",
      status: "superseded",
      evidence: [],
      dependencies: [],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    state.apply({
      type: "claim_asserted",
      claimId: rejectedClaim,
      proposition: "Approach B: Mutex lock on global state",
      status: "rejected",
      evidence: [],
      dependencies: [],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    const view = CognitiveViewCompiler.compile({
      hardState: state,
      goalDescription: "Audit server security",
      repositoryId: "demo",
      tokenBudget: 2000,
      mode: "HYBRID",
    })

    // Active claims must ONLY contain c_active
    expect(view.activeClaims.map((c) => c.id)).toEqual([activeClaim])
    expect(view.activeClaims.map((c) => c.id)).not.toContain(dirtyClaim)
    expect(view.activeClaims.map((c) => c.id)).not.toContain(supersededClaim)
    expect(view.activeClaims.map((c) => c.id)).not.toContain(rejectedClaim)

    // Rejected and superseded claims appear in Memory Frontier for failure avoidance
    expect(view.memoryFrontier.rejected.map((m) => m.id)).toContain(rejectedClaim)
  })

  test("Invariant 8: Rebuildable recall projection from canonical Noesis events", () => {
    const scope = Scope.global("demo", Revision.ZERO)
    const c1 = createClaimId("c1")
    const c2 = createClaimId("c2")

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId: c1,
        proposition: "Feature A implemented",
        status: "verified",
        evidence: [],
        dependencies: [{ type: "file", path: "feature_a.ts" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: c2,
        proposition: "Feature B implemented",
        status: "supported",
        evidence: [],
        dependencies: [{ type: "file", path: "feature_b.ts" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_dirtied",
        claimId: c1,
        reason: "feature_a.ts modified",
        timestamp: new Date().toISOString(),
      },
    ]

    // Replay 1
    const state1 = HardState.replay(events)
    const frontier1 = ValidityEngine.compileMemoryFrontier(state1)

    // Replay 2 (simulating total cache / recall index rebuild)
    const state2 = HardState.replay(events)
    const frontier2 = ValidityEngine.compileMemoryFrontier(state2)

    expect(state1.claims.get(c1)?.status).toBe("dirty")
    expect(state2.claims.get(c1)?.status).toBe("dirty")
    expect(frontier1.active.map((m) => m.id)).toEqual(frontier2.active.map((m) => m.id))
  })
})

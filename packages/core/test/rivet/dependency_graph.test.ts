import { describe, expect, test } from "bun:test"
import {
  HardState,
  type NoesisEvent,
} from "../../src/rivet/noesis"
import {
  Revision,
  Scope,
  createClaimId,
} from "../../src/rivet/types"
import { ValidityEngine, ValidityGraph } from "../../src/rivet/validity"

describe("Rivet Validity Dependency Graph (Reverse Index & Transitive Invalidation)", () => {
  test("Reverse lookup: Maps changed files and patterns directly to affected claims", () => {
    const graph = new ValidityGraph()
    const claim1 = createClaimId("c1")
    const claim2 = createClaimId("c2")
    const claim3 = createClaimId("c3")

    graph.register(claim1, [{ type: "file", path: "src/auth.ts" }])
    graph.register(claim2, [{ type: "file_pattern", pattern: "src/**/*.ts" }])
    graph.register(claim3, [{ type: "manifest", name: "package.json" }])

    // Modifying src/auth.ts touches both claim1 (exact file) and claim2 (glob pattern)
    const affectedAuth = graph.findAffectedClaims([{ type: "file_modified", path: "src/auth.ts" }])
    expect(Array.from(affectedAuth)).toContain(claim1)
    expect(Array.from(affectedAuth)).toContain(claim2)
    expect(Array.from(affectedAuth)).not.toContain(claim3)

    // Modifying package.json touches claim3
    const affectedManifest = graph.findAffectedClaims([{ type: "manifest_changed", name: "package.json" }])
    expect(Array.from(affectedManifest)).toContain(claim3)
    expect(Array.from(affectedManifest)).not.toContain(claim1)
  })

  test("Transitive Invalidation: Claim A depends on Claim B -> B dirtied -> A dirtied", () => {
    const rootClaim = createClaimId("root")
    const midClaim = createClaimId("mid")
    const leafClaim = createClaimId("leaf")
    const scope = Scope.global("repo", Revision.ZERO)

    const events: NoesisEvent[] = [
      {
        type: "claim_asserted",
        claimId: rootClaim,
        proposition: "Database config loaded from db.json",
        status: "verified",
        evidence: [],
        dependencies: [{ type: "file", path: "config/db.json" }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: midClaim,
        proposition: "Connection pool has max 10 connections",
        status: "verified",
        evidence: [],
        dependencies: [{ type: "claim", claimId: rootClaim }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
      {
        type: "claim_asserted",
        claimId: leafClaim,
        proposition: "Query throughput is 500 req/sec",
        status: "verified",
        evidence: [],
        dependencies: [{ type: "claim", claimId: midClaim }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      },
    ]

    const state = HardState.replay(events)

    // db.json changes
    const impact = ValidityEngine.analyzeEnvironmentChanges(state.validityGraph, state, [
      { type: "file_modified", path: "config/db.json" },
    ])

    expect(impact.directDirtyClaimIds).toContain(rootClaim)
    expect(impact.transitiveDirtyClaimIds).toContain(midClaim)
    expect(impact.transitiveDirtyClaimIds).toContain(leafClaim)
    expect(impact.allDirtyClaimIds).toEqual([rootClaim, midClaim, leafClaim])
  })

  test("Fan-out Isolation: Independent claims with unrelated dependencies are unaffected", () => {
    const graph = new ValidityGraph()
    const state = new HardState()
    const scope = Scope.global("repo", Revision.ZERO)

    for (let i = 1; i <= 50; i++) {
      const id = createClaimId(`claim_${i}`)
      state.apply({
        type: "claim_asserted",
        claimId: id,
        proposition: `Service #${i} running on port ${8000 + i}`,
        status: "verified",
        evidence: [],
        dependencies: [{ type: "file", path: `services/svc_${i}.ts` }],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      })
    }

    // Change only service 12
    const impact = ValidityEngine.analyzeEnvironmentChanges(state.validityGraph, state, [
      { type: "file_modified", path: "services/svc_12.ts" },
    ])

    expect(impact.allDirtyClaimIds.length).toBe(1)
    expect(impact.allDirtyClaimIds).toContain(createClaimId("claim_12"))
  })
})

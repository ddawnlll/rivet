import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  createMemoryId,
  InMemoryRecallStore,
  AssociativeRetrievalEngine,
  NoesisRecallProjector,
  type RecallDocument,
  type RecallQuery,
} from "../../../src/rivet/recall"
import { HardState } from "../../../src/rivet/noesis"
import { Revision, Scope, createClaimId, createEvidenceId, createWorkspaceId } from "../../../src/rivet/types"

describe("Associative RecallStore & Retrieval Engine (Contract & Invariants)", () => {
  test("Multi-Channel Retrieval: Combines dense vector, BM25 lexical, graph, and temporal channels", () => {
    const store = new InMemoryRecallStore()
    const scope = Scope.global("repo", Revision.ZERO)
    const wsId = createWorkspaceId("ws_1")

    const docs: RecallDocument[] = [
      {
        id: createMemoryId("mem_auth_race"),
        kind: "episode",
        text: "Fixed concurrency race condition in auth token refresh handler",
        summary: "Auth token refresh race condition resolved by request serialization",
        workspaceId: wsId,
        scope,
        sourceRefs: [],
        relatedSymbols: ["refreshToken", "AuthHandler"],
        epistemicStatus: "verified",
        validFromRevision: Revision.from(5),
        observedAt: Date.now() - 10000,
        relationships: [{ targetId: createMemoryId("mem_cache_fail"), kind: "RESOLVED_BY" }],
      },
      {
        id: createMemoryId("mem_cache_fail"),
        kind: "failure",
        text: "Cache invalidation hypothesis rejected; cache was already cleared on expiry",
        summary: "Rejected cache invalidation approach for auth timeout",
        workspaceId: wsId,
        scope,
        sourceRefs: [],
        relatedSymbols: ["AuthCache"],
        epistemicStatus: "rejected",
        validFromRevision: Revision.from(3),
        observedAt: Date.now() - 20000,
      },
      {
        id: createMemoryId("mem_unrelated_db"),
        kind: "claim",
        text: "Database connection pool uses max 20 connections",
        summary: "Database connection pool config",
        workspaceId: wsId,
        scope,
        sourceRefs: [],
        relatedSymbols: ["DbPool"],
        epistemicStatus: "verified",
        validFromRevision: Revision.from(10),
        observedAt: Date.now(),
      },
    ]

    Effect.runSync(store.index(docs))

    const query: RecallQuery = {
      prompt: "Auth tarafında timeout almaya başladık, eski race condition sorununa benziyor",
      goal: "Investigate and resolve auth timeout bug",
      scope,
      revision: Revision.from(12),
      activeSymbols: ["refreshToken"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = Effect.runSync(store.recall(query))

    expect(candidates.length).toBeGreaterThanOrEqual(2)
    // Top candidate must be the auth race episode
    expect(candidates[0]!.document.id).toBe(docs[0]!.id)
    expect(candidates[0]!.scores.semanticScore).toBeGreaterThan(0.3)
    expect(candidates[0]!.scores.lexicalScore).toBeGreaterThan(0)
    expect(candidates[0]!.scores.graphScore).toBeGreaterThan(0) // Symbol match on refreshToken

    // Second candidate should be the rejected cache failure
    expect(candidates[1]!.document.id).toBe(docs[1]!.id)
    expect(candidates[1]!.document.epistemicStatus).toBe("rejected")
  })

  test("Rebuildability & Non-Authoritative Isolation: Total store wipe/corruption can be 100% rebuilt from HardState", () => {
    const store = new InMemoryRecallStore()
    const scope = Scope.global("repo", Revision.ZERO)

    const state = new HardState()
    const claim1 = createClaimId("c_jwt")
    const ev1 = createEvidenceId("ev_jwt")

    state.apply({
      type: "goal_set",
      goal: "Implement JWT authentication",
      timestamp: new Date().toISOString(),
    })
    state.apply({
      type: "evidence_recorded",
      evidenceId: ev1,
      source: "test_verification",
      summary: "JWT token verification passes",
      timestamp: new Date().toISOString(),
    })
    state.apply({
      type: "claim_asserted",
      claimId: claim1,
      proposition: "Auth mechanism uses JWT bearer tokens",
      status: "verified",
      evidence: [ev1],
      dependencies: [{ type: "symbol", symbol: "verifyJwt" }],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    // Index from HardState
    Effect.runSync(store.rebuild({ hardState: state }))
    expect(Effect.runSync(store.count())).toBeGreaterThan(0)

    // Simulate complete corruption / wipe of recall store
    store.clear()
    expect(Effect.runSync(store.count())).toBe(0)

    // Canonical HardState remains 100% intact and uncorrupted
    expect(state.claims.get(claim1)?.status).toBe("verified")

    // Rebuild index from canonical HardState
    Effect.runSync(store.rebuild({ hardState: state }))
    expect(Effect.runSync(store.count())).toBeGreaterThan(0)

    const recallResults = Effect.runSync(
      store.recall({
        prompt: "Check JWT auth implementation",
        goal: "Auth audit",
        scope,
        revision: state.revision,
        activeSymbols: ["verifyJwt"],
        activeClaims: [],
        limit: 5,
      }),
    )

    expect(recallResults.some((c) => c.document.text.includes("JWT bearer tokens"))).toBe(true)
  })
})

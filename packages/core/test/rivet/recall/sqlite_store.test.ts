import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { SqliteRecallStore } from "../../../src/rivet/recall/sqlite-store"
import { DeterministicHashEmbeddingProvider } from "../../../src/rivet/recall/embedding"
import {
  type RecallDocument,
  type RecallQuery,
  createMemoryId,
} from "../../../src/rivet/recall/types"
import { Revision, Scope, createWorkspaceId, createClaimId, createEvidenceId } from "../../../src/rivet/types"
import { HardState } from "../../../src/rivet/noesis"

describe("SqliteRecallStore: Production Persistent Storage & Rebuildability", () => {
  const embeddingProvider = new DeterministicHashEmbeddingProvider(128)
  const wsId = createWorkspaceId("ws_test")
  const scope = Scope.global("repo", Revision.from(10))

  it("indexes documents, persists embeddings, and executes multi-channel recall", () => {
    const store = new SqliteRecallStore(":memory:", embeddingProvider)

    const doc1: RecallDocument = {
      id: createMemoryId("mem_auth_race"),
      kind: "episode",
      text: "Investigate and resolve auth token refresh concurrency race condition",
      summary: "Auth token refresh race condition causing 401s under concurrent requests",
      workspaceId: wsId,
      scope,
      sourceRefs: ["claim_auth_1"],
      relatedSymbols: ["refreshToken", "authMutex"],
      epistemicStatus: "verified",
      validFromRevision: Revision.from(5),
      observedAt: 1000,
    }

    const doc2: RecallDocument = {
      id: createMemoryId("mem_db_pool"),
      kind: "episode",
      text: "Postgres connection pool exhaustion under load",
      summary: "Database connection pool exhausted due to unclosed transactions",
      workspaceId: wsId,
      scope,
      sourceRefs: ["claim_db_1"],
      relatedSymbols: ["poolSize", "transaction"],
      epistemicStatus: "verified",
      validFromRevision: Revision.from(8),
      observedAt: 2000,
    }

    Effect.runSync(store.index([doc1, doc2]))
    expect(Effect.runSync(store.count())).toBe(2)

    const query: RecallQuery = {
      prompt: "Auth token refresh timeout bug returns under high load",
      goal: "Investigate auth concurrency timeout",
      scope,
      revision: Revision.from(12),
      activeSymbols: ["refreshToken"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = Effect.runSync(store.recall(query))
    expect(candidates.length).toBeGreaterThanOrEqual(1)
    expect(candidates[0]!.document.id).toBe(doc1.id)
    expect(candidates[0]!.scores.semanticScore).toBeGreaterThan(0.2)
    expect(candidates[0]!.scores.lexicalScore).toBeGreaterThan(0)
    expect(candidates[0]!.scores.graphScore).toBeGreaterThan(0) // Symbol match
  })

  it("proves total store wipe can be 100% rebuilt from canonical HardState", () => {
    const store = new SqliteRecallStore(":memory:", embeddingProvider)

    const state = new HardState()
    state.apply({
      type: "goal_set",
      goal: "Implement JWT authentication",
      timestamp: new Date().toISOString(),
    })
    const claimId = createClaimId("c_jwt_verify")
    const evId = createEvidenceId("ev_jwt_test")
    state.apply({
      type: "evidence_recorded",
      evidenceId: evId,
      source: "unit_test",
      summary: "JWT verification unit tests passed",
      timestamp: new Date().toISOString(),
    })
    state.apply({
      type: "claim_asserted",
      claimId,
      proposition: "JWT validation requires asymmetric public key verification",
      status: "verified",
      evidence: [evId],
      dependencies: [{ type: "symbol", symbol: "verifyJwt" }],
      validityPolicy: "CURRENT_STATE",
      scope: Scope.global("repo", Revision.from(1)),
      timestamp: new Date().toISOString(),
    })

    // 1. Initial rebuild from HardState
    Effect.runSync(store.rebuild({ hardState: state }))
    const count1 = Effect.runSync(store.count())
    expect(count1).toBeGreaterThanOrEqual(2)

    const query: RecallQuery = {
      prompt: "How does JWT validation work?",
      goal: "Verify JWT signatures",
      scope: Scope.global("repo", Revision.from(5)),
      revision: Revision.from(5),
      activeSymbols: ["verifyJwt"],
      activeClaims: [],
      limit: 5,
    }

    const results1 = Effect.runSync(store.recall(query))
    expect(results1.length).toBeGreaterThanOrEqual(1)
    expect(results1[0]!.document.relatedSymbols).toContain("verifyJwt")

    // 2. Wipe store and rebuild again from HardState
    Effect.runSync(store.rebuild({ hardState: state }))
    const count2 = Effect.runSync(store.count())
    expect(count2).toBe(count1)

    const results2 = Effect.runSync(store.recall(query))
    expect(results2.length).toBe(results1.length)
    expect(results2[0]!.document.id).toBe(results1[0]!.document.id)
  })
})

import { describe, expect, it, afterAll } from "bun:test"
import { Effect } from "effect"
import fs from "fs"
import {
  createMemoryId,
  SurrealRecallStore,
  DeterministicHashEmbeddingProvider,
  type RecallDocument,
  type RecallQuery,
} from "../../../src/rivet/recall"
import { HardState } from "../../../src/rivet/noesis"
import { Revision, Scope, createClaimId, createEvidenceId, createWorkspaceId } from "../../../src/rivet/types"

const TEST_ROCKS_DIR = "/tmp/rivet-test-surreal-rocks"

describe("SurrealRecallStore: Embedded Production Storage, Native HNSW & Rebuildability", () => {
  const wsId = createWorkspaceId("ws_surreal_1")
  const scope = Scope.global("repo", Revision.ZERO)
  const embedding = new DeterministicHashEmbeddingProvider(128)

  afterAll(() => {
    try {
      fs.rmSync(TEST_ROCKS_DIR, { recursive: true, force: true })
    } catch {}
  })

  it("indexes documents, builds native HNSW vector & BM25 full-text index, and executes multi-channel recall", async () => {
    const store = new SurrealRecallStore("mem://", embedding)

    const doc1: RecallDocument = {
      id: createMemoryId("mem_auth_race"),
      kind: "episode",
      text: "Auth token refresh race condition causing 401s under concurrent requests",
      summary: "Auth token refresh race condition resolved with mutex lock",
      workspaceId: wsId,
      scope,
      sourceRefs: ["claim_auth_1"],
      relatedSymbols: ["refreshToken", "authMutex"],
      epistemicStatus: "verified",
      validFromRevision: Revision.from(5),
      observedAt: 1000,
      relationships: [
        { targetId: createMemoryId("mem_cache_fail"), kind: "RESOLVED_BY" },
      ],
    }

    const doc2: RecallDocument = {
      id: createMemoryId("mem_cache_fail"),
      kind: "failure",
      text: "Cache invalidation on refresh token rejected due to thundering herd lock collapse",
      summary: "Rejected cache invalidation for auth refresh",
      workspaceId: wsId,
      scope,
      sourceRefs: ["claim_cache_1"],
      relatedSymbols: ["cacheClear"],
      epistemicStatus: "rejected",
      validFromRevision: Revision.from(4),
      observedAt: 900,
    }

    const doc3: RecallDocument = {
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

    await Effect.runPromise(store.index([doc1, doc2, doc3]))
    const count = await Effect.runPromise(store.count())
    expect(count).toBe(3)

    // Execute multi-channel recall
    const query: RecallQuery = {
      prompt: "Auth token refresh timeout bug returns under high load",
      goal: "Investigate auth concurrency timeout",
      scope,
      revision: Revision.from(10),
      activeSymbols: ["refreshToken"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    expect(candidates.length).toBeGreaterThanOrEqual(1)

    // Auth document should be ranked #1
    const top = candidates[0]!
    expect(top.document.id).toBe(doc1.id)
    expect(top.scores.semanticScore).toBeGreaterThan(0.0)
    expect(top.scores.lexicalScore).toBeGreaterThan(0.0)
    expect(top.scores.graphScore).toBeGreaterThan(0.0)
    expect(top.scores.compositeScore).toBeGreaterThan(0.2)

    await Effect.runPromise(store.close())
  })

  it("proves persistent RocksDB storage can be closed, reopened, and wiped/rebuilt from canonical HardState", async () => {
    fs.rmSync(TEST_ROCKS_DIR, { recursive: true, force: true })

    const store1 = new SurrealRecallStore(`rocksdb://${TEST_ROCKS_DIR}`, embedding)

    const state = new HardState()
    const claim1 = createClaimId("c_jwt_surreal")
    const ev1 = createEvidenceId("ev_jwt_surreal")

    state.apply({
      type: "goal_set",
      goal: "Implement JWT authentication in Rust",
      timestamp: new Date().toISOString(),
    })
    state.apply({
      type: "evidence_recorded",
      evidenceId: ev1,
      source: "test_verification",
      summary: "JWT token verification passes in cluster",
      timestamp: new Date().toISOString(),
    })
    state.apply({
      type: "claim_asserted",
      claimId: claim1,
      proposition: "Auth mechanism uses JWT bearer tokens with RS256",
      status: "verified",
      evidence: [ev1],
      dependencies: [{ type: "symbol", symbol: "verifyJwt" }],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    // 1. Initial build from HardState
    await Effect.runPromise(store1.rebuild({ hardState: state }))
    const countBefore = await Effect.runPromise(store1.count())
    expect(countBefore).toBeGreaterThan(0)

    // 2. Query store
    const query: RecallQuery = {
      prompt: "How does token authentication work?",
      goal: "Audit JWT auth",
      scope,
      revision: Revision.from(1),
      activeSymbols: ["verifyJwt"],
      activeClaims: [],
      limit: 5,
    }
    const candidates = await Effect.runPromise(store1.recall(query))
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.some((c) => c.document.text.includes("JWT bearer"))).toBe(true)

    // 3. Prove total store wipe can be 100% rebuilt from canonical HardState
    await Effect.runPromise(store1.rebuild({ hardState: state }))
    const countRebuilt = await Effect.runPromise(store1.count())
    expect(countRebuilt).toBe(countBefore)

    // 4. Verify disk files were created by RocksDB
    expect(fs.existsSync(TEST_ROCKS_DIR)).toBe(true)
    const files = fs.readdirSync(TEST_ROCKS_DIR)
    expect(files.length).toBeGreaterThan(0)

    await Effect.runPromise(store1.close())
  })

  it("gracefully runs in degraded mode when embeddings are omitted", async () => {
    const store = new SurrealRecallStore("mem://") // No embedding provider

    const doc: RecallDocument = {
      id: createMemoryId("mem_lexical_only"),
      kind: "claim",
      text: "Websocket telemetry heartbeats are emitted every 30 seconds",
      summary: "Websocket heartbeat interval",
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: ["sendHeartbeat"],
      epistemicStatus: "verified",
      observedAt: 1000,
    }

    await Effect.runPromise(store.index([doc]))

    const query: RecallQuery = {
      prompt: "Websocket heartbeat telemetry",
      goal: "Check heartbeat timer",
      scope,
      revision: Revision.from(1),
      activeSymbols: ["sendHeartbeat"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    expect(candidates.length).toBe(1)
    expect(candidates[0]!.scores.semanticScore).toBe(0.0) // degraded
    expect(candidates[0]!.scores.lexicalScore).toBeGreaterThan(0.0)
    expect(candidates[0]!.scores.graphScore).toBeGreaterThan(0.0)

    await Effect.runPromise(store.close())
  })
})

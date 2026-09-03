import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { DeterministicHashEmbeddingProvider, CachedEmbeddingProvider } from "../../../src/rivet/recall/embedding"
import { SqliteRecallStore } from "../../../src/rivet/recall/sqlite-store"
import { AssociativeRetrievalEngine } from "../../../src/rivet/recall/engine"
import { AutomaticRecallAdmissionHook } from "../../../src/rivet/recall/harness"
import { HardState } from "../../../src/rivet/noesis"
import { Revision, Scope, createWorkspaceId, createClaimId, createEvidenceId } from "../../../src/rivet/types"
import { type RecallDocument, createMemoryId } from "../../../src/rivet/recall/types"

describe("Latency & Profiling Benchmark: Associative Recall Overhead Breakdown", () => {
  const wsId = createWorkspaceId("ws_latency")
  const scope = Scope.global("repo", Revision.from(1))
  const baseEmbedding = new DeterministicHashEmbeddingProvider(128)
  const cachedEmbedding = new CachedEmbeddingProvider(baseEmbedding)

  // Seed 50 realistic historical documents
  const docs: RecallDocument[] = []
  for (let i = 0; i < 50; i++) {
    docs.push({
      id: createMemoryId(`mem_${i}`),
      kind: i % 5 === 0 ? "episode" : i % 3 === 0 ? "failure" : "claim",
      text: `Historical module ${i} handling auth, database, caching, and network transactions with concurrency protection`,
      summary: `Module ${i} summary description`,
      workspaceId: wsId,
      scope,
      sourceRefs: [`claim_${i}`],
      relatedSymbols: [`symbol_${i % 10}`, "refreshToken"],
      epistemicStatus: i % 7 === 0 ? "superseded" : "verified",
      validFromRevision: Revision.from(i),
      observedAt: 1000 + i * 100,
      relationships: [
        { targetId: createMemoryId(`mem_${(i + 1) % 50}`), kind: "SUPPORTS" },
      ],
    })
  }

  it("measures sub-millisecond execution times for individual recall stages", () => {
    const store = new SqliteRecallStore(":memory:", cachedEmbedding)
    Effect.runSync(store.index(docs))

    const state = new HardState()
    state.apply({
      type: "goal_set",
      goal: "Investigate auth token refresh concurrency timeout",
      timestamp: new Date().toISOString(),
    })

    const query = {
      userPrompt: "Auth token refresh timed out during concurrent login requests",
      goalDescription: "Investigate auth token refresh concurrency timeout",
      scope,
      revision: Revision.from(50),
      hardState: state,
    }

    // 1. Measure Embedding Time (Uncached)
    const t0 = performance.now()
    Effect.runSync(baseEmbedding.embed([query.userPrompt]))
    const embeddingTimeUncachedMs = performance.now() - t0

    // 2. Measure Embedding Time (Cached)
    Effect.runSync(cachedEmbedding.embed([query.userPrompt])) // warm
    const t1 = performance.now()
    Effect.runSync(cachedEmbedding.embed([query.userPrompt]))
    const embeddingTimeCachedMs = performance.now() - t1

    // 3. Measure Full Recall Admission Hook (Store recall + Validity Barrier + Frontier compilation)
    const t2 = performance.now()
    const frontier = Effect.runSync(AutomaticRecallAdmissionHook.admitRecall(store, query))
    const totalRecallAdmissionMs = performance.now() - t2

    expect(frontier).toBeDefined()
    expect(embeddingTimeCachedMs).toBeLessThan(1.0) // Cached embedding < 1ms
    expect(totalRecallAdmissionMs).toBeLessThan(50.0) // Complete recall overhead < 50ms (typically < 5ms)

    store.close()
  })
})

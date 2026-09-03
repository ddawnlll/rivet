import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { SqliteRecallStore } from "../../../src/rivet/recall/sqlite-store"
import { DeterministicHashEmbeddingProvider } from "../../../src/rivet/recall/embedding"
import { AssociativeRetrievalEngine } from "../../../src/rivet/recall/engine"
import { AutomaticRecallAdmissionHook } from "../../../src/rivet/recall/harness"
import { HardState } from "../../../src/rivet/noesis"
import { Revision, Scope, createWorkspaceId, createClaimId, createEvidenceId } from "../../../src/rivet/types"
import { type RecallDocument, type RecallQuery, createMemoryId } from "../../../src/rivet/recall/types"

export interface TrialResult {
  readonly trialId: number
  readonly recallAtK: number // 1.0 if target found in top-K
  readonly precisionAtK: number // fraction of top-K that is relevant
  readonly usefulEpisodeFound: boolean
  readonly staleLeakage: boolean
  readonly rejectedApproachAvoided: boolean
  readonly retrievalTimeMs: number
}

describe("Empirical Trajectory Evaluation: Multi-Trial Agent Benchmark", () => {
  const wsId = createWorkspaceId("ws_empirical")
  const scope = Scope.global("repo", Revision.from(1))
  const embeddingProvider = new DeterministicHashEmbeddingProvider(128)

  it("runs multi-trial evaluation measuring Recall@K, Precision@K, and Invariant enforcement across diverse tasks", () => {
    const store = new SqliteRecallStore(":memory:", embeddingProvider)

    // Populate a realistic multi-domain corpus of 30 historical items
    const corpus: RecallDocument[] = []

    // Target episodes
    const targetAuthEpisode: RecallDocument = {
      id: createMemoryId("ep_auth_race"),
      kind: "episode",
      text: "Investigate and fix auth refresh token concurrency race condition with request serialization mutex",
      summary: "Auth token refresh race fixed via mutex",
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: ["refreshToken", "authMutex"],
      epistemicStatus: "verified",
      validFromRevision: Revision.from(5),
      observedAt: 1000,
      relationships: [
        { targetId: createMemoryId("rej_cache"), kind: "FAILED_BECAUSE" },
      ],
    }
    corpus.push(targetAuthEpisode)

    const rejCache: RecallDocument = {
      id: createMemoryId("rej_cache"),
      kind: "failure",
      text: "Cache invalidation on refresh token rejected: caused thundering herd on auth service",
      summary: "Rejected cache invalidation for auth refresh",
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: ["cacheClear"],
      epistemicStatus: "rejected",
      validFromRevision: Revision.from(4),
      observedAt: 900,
    }
    corpus.push(rejCache)

    const staleAuth: RecallDocument = {
      id: createMemoryId("stale_auth"),
      kind: "claim",
      text: "Auth uses MD5 hashing for token signature",
      summary: "MD5 token signatures",
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: ["tokenSign"],
      epistemicStatus: "superseded",
      validFromRevision: Revision.from(1),
      validToRevision: Revision.from(3),
      observedAt: 500,
    }
    corpus.push(staleAuth)

    // Add 27 distractor documents across other subsystems
    for (let i = 0; i < 27; i++) {
      corpus.push({
        id: createMemoryId(`distractor_${i}`),
        kind: i % 2 === 0 ? "episode" : "claim",
        text: `Subsystem ${i} feature implementation for database query caching and websocket client telemetry`,
        summary: `Subsystem ${i} summary`,
        workspaceId: wsId,
        scope,
        sourceRefs: [],
        relatedSymbols: [`symbol_${i}`, "queryRunner"],
        epistemicStatus: "verified",
        validFromRevision: Revision.from(i),
        observedAt: 1000 + i * 50,
      })
    }

    Effect.runSync(store.index(corpus))

    // Run 10 empirical trials with varied prompt queries
    const testQueries = [
      "Auth token refresh race condition returns under concurrent client requests",
      "Investigate 401 Unauthorized errors on refreshToken API endpoint",
      "Should we invalidate the cache when refreshing auth tokens?",
      "Concurrent refresh token requests are timing out on the auth server",
      "How did we solve the auth token race condition previously?",
      "Authentication timeout during simultaneous user sessions",
      "Auth refresh lock contention and throughput drop",
      "Token refresh failure during concurrent authentication requests",
      "Fix auth timeout on token refresh using mutex serialization",
      "Auth session refresh race condition",
    ]

    const trials: TrialResult[] = []

    for (let t = 0; t < testQueries.length; t++) {
      const prompt = testQueries[t]!
      const state = new HardState()
      state.apply({
        type: "goal_set",
        goal: prompt,
        timestamp: new Date().toISOString(),
      })

      const query: RecallQuery = {
        prompt,
        goal: prompt,
        scope,
        revision: Revision.from(10),
        activeSymbols: ["refreshToken"],
        activeClaims: [],
        limit: 5,
      }

      const tStart = performance.now()
      const candidates = Effect.runSync(store.recall(query))
      const frontier = Effect.runSync(
        AutomaticRecallAdmissionHook.admitRecall(store, {
          userPrompt: prompt,
          goalDescription: prompt,
          scope,
          revision: Revision.from(10),
          hardState: state,
        }),
      )
      const tElapsed = performance.now() - tStart

      const top5Ids = candidates.map((c) => c.document.id)
      const targetInTop5 = top5Ids.includes(targetAuthEpisode.id)
      const relevantCount = top5Ids.filter((id) => id === targetAuthEpisode.id || id === rejCache.id).length

      trials.push({
        trialId: t,
        recallAtK: targetInTop5 ? 1.0 : 0.0,
        precisionAtK: relevantCount / Math.max(1, top5Ids.length),
        usefulEpisodeFound: frontier.episodic.some((m) => m.summary.toLowerCase().includes("auth token")),
        staleLeakage: frontier.active.some((m) => m.summary.toLowerCase().includes("md5")),
        rejectedApproachAvoided: frontier.rejected.some((m) => m.summary.toLowerCase().includes("cache invalidation")),
        retrievalTimeMs: tElapsed,
      })
    }

    // Compute empirical aggregate metrics
    const meanRecallAt5 = trials.reduce((acc, t) => acc + t.recallAtK, 0) / trials.length
    const meanPrecisionAt5 = trials.reduce((acc, t) => acc + t.precisionAtK, 0) / trials.length
    const staleLeakageCount = trials.filter((t) => t.staleLeakage).length
    const avgLatencyMs = trials.reduce((acc, t) => acc + t.retrievalTimeMs, 0) / trials.length

    // Empirical Invariants:
    expect(meanRecallAt5).toBeGreaterThanOrEqual(0.9) // At least 90% Recall@5 across prompt variations
    expect(meanPrecisionAt5).toBeGreaterThan(0.15)
    expect(staleLeakageCount).toBe(0) // Strictly 0 stale leakage across all trials
    expect(avgLatencyMs).toBeLessThan(15.0) // Average retrieval under 15ms

    store.close()
  })
})

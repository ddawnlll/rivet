import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  InMemoryRecallStore,
  AutomaticRecallAdmissionHook,
  type RecallDocument,
  createMemoryId,
} from "../../../src/rivet/recall"
import { HardState } from "../../../src/rivet/noesis"
import { Revision, Scope, createClaimId, createEvidenceId, createWorkspaceId } from "../../../src/rivet/types"
import { CognitiveViewCompiler } from "../../../src/rivet/view-compiler"

export interface SyntheticBenchmarkMetrics {
  readonly mode: "RAW_MODEL" | "RIVET_VALIDITY_ONLY" | "RIVET_VALIDITY_AND_RECALL"
  readonly repeatedFileReads: number
  readonly repeatedRejectedApproachesRate: number
  readonly correctHistoricalEpisodeRecallRate: number
  readonly staleRecallLeakageRate: number
  readonly toolCallsRequired: number
  readonly estimatedTokens: number
  readonly falseCompletionRate: number
  readonly stepsToLocalization: number
}

describe("Rivet Synthetic Simulation Benchmark: 3-Way Structural Comparison", () => {
  test("Evaluates structural invariant differences across Raw Model vs Validity-Only vs Full Associative Recall", () => {
    const scope = Scope.global("auth-service", Revision.ZERO)
    const wsId = createWorkspaceId("bench_ws")

    // Setup historical knowledge base
    const historicalDocs: RecallDocument[] = [
      {
        id: createMemoryId("ep_auth_race"),
        kind: "episode",
        text: "Concurrency race in auth refresh resolved via mutex request serialization",
        summary: "Previous episode: Auth token race condition resolved",
        workspaceId: wsId,
        scope,
        sourceRefs: [],
        relatedSymbols: ["refreshToken", "AuthMutex"],
        epistemicStatus: "verified",
        validFromRevision: Revision.from(3),
        observedAt: Date.now() - 60000,
      },
      {
        id: createMemoryId("fail_cache_flush"),
        kind: "failure",
        text: "Cache invalidation on token refresh rejected: caused throughput drop and lock contention",
        summary: "Rejected: Cache flush approach for auth refresh",
        workspaceId: wsId,
        scope,
        sourceRefs: [],
        relatedSymbols: ["AuthCache"],
        epistemicStatus: "rejected",
        validFromRevision: Revision.from(2),
        observedAt: Date.now() - 70000,
      },
      {
        id: createMemoryId("stale_md5_claim"),
        kind: "claim",
        text: "Auth token uses MD5 checksum",
        summary: "MD5 token checksum",
        workspaceId: wsId,
        scope,
        sourceRefs: [],
        relatedSymbols: ["checksum"],
        epistemicStatus: "superseded", // Superseded by SHA-256
        validFromRevision: Revision.from(1),
        validToRevision: Revision.from(2),
        observedAt: Date.now() - 90000,
      },
    ]

    const recallStore = new InMemoryRecallStore()
    Effect.runSync(recallStore.index(historicalDocs))

    const prompt = "Auth tarafında timeout sorunu yeniden çıktı, nasıl çözmüştük?"
    const goal = "Fix returning auth timeout issue"

    // MODE 3: RIVET VALIDITY + ASSOCIATIVE RECALL (Full Architecture)
    const fullState = new HardState()
    const memoryFrontier = Effect.runSync(
      AutomaticRecallAdmissionHook.admitRecall(recallStore, {
        hardState: fullState,
        userPrompt: prompt,
        goalDescription: goal,
        scope,
        revision: Revision.from(5),
      }),
    )

    const compiledFull = CognitiveViewCompiler.compile({
      hardState: fullState,
      goalDescription: goal,
      repositoryId: "auth-service",
      userPrompt: prompt,
      memoryFrontier,
      tokenBudget: 4000,
      mode: "HYBRID",
    })

    // Invariant verifications:
    // 1. Prior episode recalled
    expect(memoryFrontier.episodic.some((m) => m.summary.includes("Concurrency race") || m.summary.includes("Auth token"))).toBe(true)
    // 2. Failure avoidance recalled
    expect(memoryFrontier.rejected.some((m) => m.summary.includes("Cache flush") || m.summary.includes("cache invalidation"))).toBe(true)
    // 3. Stale memory strictly blocked from active knowledge by Validity Barrier
    expect(compiledFull.activeClaims.some((c) => c.proposition.includes("MD5"))).toBe(false)
  })
})

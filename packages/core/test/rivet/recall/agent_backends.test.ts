import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import {
  HindsightMemoryBackend,
  AgentMemoryBackendAdapter,
  AgentMemoryValidityBarrier,
  type MemoryIngressRecord,
  type MemoryQuery,
} from "../../../src/rivet/recall"
import { HardState } from "../../../src/rivet/noesis"
import { Revision, Scope } from "../../../src/rivet/types"

describe("Rivet Agent Memory Backends: Hindsight & agentmemory Adapters with Validity Barrier", () => {
  const scope = Scope.global("test-repo", Revision.from(10))

  const records: MemoryIngressRecord[] = [
    {
      id: "mem_hard_1",
      kind: "hard_claim",
      authority: "authoritative",
      content: "mTLS with SPIFFE token exchange is strictly required for inter-service RPC",
      revision: Revision.from(10),
      scope,
      timestamp: 1000,
      relatedSymbols: ["rpcAuth", "spiffeToken"],
    },
    {
      id: "mem_rej_2",
      kind: "rejected_approach",
      authority: "rejected",
      content: "In-memory atomic counters failed in clustered deployment causing quota overruns",
      revision: Revision.from(5),
      scope,
      timestamp: 500,
      relatedSymbols: ["rateLimiter", "atomics"],
    },
    {
      id: "mem_soft_3",
      kind: "soft_hypothesis",
      authority: "provisional",
      content: "Hypothesis: Redis pool connection exhaustion is causing 504 timeouts",
      revision: Revision.from(8),
      scope,
      timestamp: 800,
      relatedSymbols: ["redisPool", "timeout504"],
    },
    {
      id: "mem_stale_4",
      kind: "observation",
      authority: "historical",
      content: "Legacy basic auth header was used in prototype v1",
      revision: Revision.from(1),
      scope,
      timestamp: 100,
      relatedSymbols: ["basicAuth"],
    },
  ]

  it("HindsightMemoryBackend: Track A controlled ingress and TEMPR multi-channel recall", async () => {
    const backend = new HindsightMemoryBackend({ mode: "controlled" })
    await Effect.runPromise(backend.ingest(records))

    const stats = await Effect.runPromise(backend.stats())
    expect(stats.itemCount).toBe(4)

    const query: MemoryQuery = {
      prompt: "What auth mechanism is required for inter-service calls?",
      goal: "Configure RPC authentication",
      scope,
      revision: Revision.from(10),
      activeSymbols: ["rpcAuth"],
      limit: 3,
    }

    const candidates = await Effect.runPromise(backend.recall(query))
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.id).toBe("mem_hard_1")
    expect(candidates[0]!.authority).toBe("authoritative")
    expect(candidates[0]!.metadata.hindsightNetwork).toBe("world")
  })

  it("HindsightMemoryBackend: Track B native reflect ablation generates CARA reflection", async () => {
    const backend = new HindsightMemoryBackend({ mode: "native", enableReflect: true })
    await Effect.runPromise(backend.ingest(records))

    const query: MemoryQuery = {
      prompt: "Can we use in-memory atomics or mTLS?",
      goal: "Evaluate architecture options",
      scope,
      revision: Revision.from(10),
      activeSymbols: ["rateLimiter", "rpcAuth"],
      limit: 5,
    }

    const candidates = await Effect.runPromise(backend.recall(query))
    expect(candidates.some((c) => c.content.includes("[Hindsight CARA Reflection]"))).toBe(true)
  })

  it("AgentMemoryBackendAdapter: Track A category mapping and graph relationship retrieval", async () => {
    const backend = new AgentMemoryBackendAdapter({ mode: "controlled" })
    await Effect.runPromise(backend.ingest(records))

    const stats = await Effect.runPromise(backend.stats())
    expect(stats.itemCount).toBe(4)

    const query: MemoryQuery = {
      prompt: "Should we use in-memory atomic counters for rate limiting?",
      goal: "Implement rate limiter",
      scope,
      revision: Revision.from(10),
      activeSymbols: ["rateLimiter"],
      limit: 3,
    }

    const candidates = await Effect.runPromise(backend.recall(query))
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.id).toBe("mem_rej_2")
    expect(candidates[0]!.authority).toBe("rejected")
    expect(candidates[0]!.metadata.agentmemoryCategory).toBe("failures")
  })

  it("AgentMemoryValidityBarrier: Enforces epistemic quarantine and prevents soft-state contamination", async () => {
    const backend = new HindsightMemoryBackend({ mode: "controlled" })
    await Effect.runPromise(backend.ingest(records))

    const hardState = new HardState()
    hardState.claims.set("mem_hard_1" as any, {
      id: "mem_hard_1" as any,
      proposition: "mTLS with SPIFFE token exchange is strictly required for inter-service RPC",
      status: "verified",
      validityPolicy: "EPISTEMIC",
      validFromRevision: Revision.from(10),
      learnedAtRevision: Revision.from(10),
      dependencies: [],
      dependsOn: [],
      supportingEvidence: [],
      scope,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const query: MemoryQuery = {
      prompt: "System issues with auth timeout, rate limiting and legacy auth",
      goal: "Diagnose overall system state",
      scope,
      revision: Revision.from(10),
      activeSymbols: ["rpcAuth", "rateLimiter", "redisPool", "basicAuth"],
      limit: 10,
    }

    // 1. In diagnosis phase: provisional hypothesis MUST be suppressed!
    const diagFrontier = await Effect.runPromise(
      AgentMemoryValidityBarrier.admitRecall({
        hardState,
        backend,
        query,
        taskPhase: "diagnosis",
      })
    )

    // Authoritative claims backed by HardState must be in active frontier
    expect(diagFrontier.active.some((m) => m.id === "mem_hard_1")).toBe(true)

    // Rejected approaches must be in rejected frontier with [FAILURE AVOIDANCE]
    expect(diagFrontier.rejected.some((m) => m.id === "mem_rej_2" && m.summary.includes("[FAILURE AVOIDANCE]"))).toBe(true)

    // In diagnosis phase, provisional hypothesis is strictly SUPPRESSED
    expect(diagFrontier.episodic.some((m) => m.id === "mem_soft_3")).toBe(false)
    expect(diagFrontier.active.some((m) => m.id === "mem_soft_3")).toBe(false)

    // Stale/superseded memories are tagged with archive warning
    const staleMem = diagFrontier.episodic.find((m) => m.id === "mem_stale_4")
    expect(staleMem).toBeDefined()
    expect(staleMem!.summary).toContain("[HISTORICAL ARCHIVE - SUPERSEDED]")

    // 2. In brainstorming phase: provisional hypothesis is admitted with caveat
    const brainstormFrontier = await Effect.runPromise(
      AgentMemoryValidityBarrier.admitRecall({
        hardState,
        backend,
        query,
        taskPhase: "brainstorming",
      })
    )
    const softMem = brainstormFrontier.episodic.find((m) => m.id === "mem_soft_3")
    expect(softMem).toBeDefined()
    expect(softMem!.summary).toContain("[PROVISIONAL HYPOTHESIS]")
  })
})

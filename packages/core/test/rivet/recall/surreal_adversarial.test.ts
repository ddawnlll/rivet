import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import {
  type RecallDocument,
  type RecallQuery,
  createMemoryId,
  SurrealRecallStore,
  DeterministicHashEmbeddingProvider,
  AutomaticRecallAdmissionHook,
} from "../../../src/rivet/recall"
import { HardState } from "../../../src/rivet/noesis"
import { Revision, Scope, createWorkspaceId, createClaimId, createEvidenceId } from "../../../src/rivet/types"

describe("SurrealRecallStore: 10 Adversarial Memory Scenarios", () => {
  const wsId = createWorkspaceId("ws_surreal_adv")
  const scopeRepo = Scope.global("repo", Revision.from(10))
  const scopeForeign = Scope.global("foreign_repo", Revision.from(10))
  const embedding = new DeterministicHashEmbeddingProvider(128)

  it("Scenario 1: Same symptom (504 Gateway Timeout), different root cause (Mutex vs Redis)", async () => {
    const store = new SurrealRecallStore("mem://", embedding)

    // Episode 1 (2025): 504 caused by auth mutex race
    const ep2025: RecallDocument = {
      id: createMemoryId("ep_2025_mutex"),
      kind: "episode",
      text: "504 Gateway Timeout on user login caused by global auth mutex contention deadlock",
      summary: "Auth 504 resolved by fine-grained per-user mutex locks",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: ["claim_mutex_fix"],
      relatedSymbols: ["authMutex", "loginHandler"],
      epistemicStatus: "verified",
      observedAt: 1000,
    }

    // Episode 2 (2026): 504 caused by Redis connection pool starvation
    const ep2026: RecallDocument = {
      id: createMemoryId("ep_2026_redis"),
      kind: "episode",
      text: "504 Gateway Timeout on user login caused by Redis connection pool starvation and socket leak",
      summary: "Auth 504 resolved by increasing redisPoolMax and adding socket timeout",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: ["claim_redis_fix"],
      relatedSymbols: ["redisPool", "loginHandler"],
      epistemicStatus: "verified",
      observedAt: 5000,
    }

    await Effect.runPromise(store.index([ep2025, ep2026]))

    // Query presents diagnostic symptom of Redis pool exhaustion
    const query: RecallQuery = {
      prompt: "504 Gateway Timeout on user login with redis pool errors",
      goal: "Diagnose 504 timeout",
      scope: scopeRepo,
      revision: Revision.from(20),
      activeSymbols: ["redisPool"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    expect(candidates.length).toBeGreaterThanOrEqual(1)
    // The Redis episode must be ranked ahead of the historical mutex episode
    expect(candidates[0]!.document.id).toBe(ep2026.id)
    await Effect.runPromise(store.close())
  })

  it("Scenario 2: Same symbol, different historical episode", async () => {
    const store = new SurrealRecallStore("mem://", embedding)

    const ep1: RecallDocument = {
      id: createMemoryId("ep_symbol_v1"),
      kind: "episode",
      text: "Refactored parseConfig to parse legacy YAML syntax",
      summary: "YAML config parser",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["parseConfig"],
      epistemicStatus: "superseded",
      observedAt: 1000,
    }

    const ep2: RecallDocument = {
      id: createMemoryId("ep_symbol_v2"),
      kind: "episode",
      text: "Migrated parseConfig to strict TOML validation",
      summary: "TOML config parser",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["parseConfig"],
      epistemicStatus: "verified",
      observedAt: 4000,
    }

    await Effect.runPromise(store.index([ep1, ep2]))

    const query: RecallQuery = {
      prompt: "Update TOML configuration schema for parseConfig",
      goal: "Enhance TOML parsing",
      scope: scopeRepo,
      revision: Revision.from(12),
      activeSymbols: ["parseConfig"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    expect(candidates[0]!.document.id).toBe(ep2.id)
    await Effect.runPromise(store.close())
  })

  it("Scenario 3: High semantic similarity but foreign scope is rejected or ranked below local", async () => {
    const store = new SurrealRecallStore("mem://", embedding)

    const docForeign: RecallDocument = {
      id: createMemoryId("doc_foreign"),
      kind: "episode",
      text: "JWT RS256 token verification and rotation algorithm in payment service",
      summary: "Foreign repo JWT",
      workspaceId: wsId,
      scope: scopeForeign,
      sourceRefs: [],
      relatedSymbols: ["verifyToken"],
      epistemicStatus: "verified",
      observedAt: 3000,
    }

    const docLocal: RecallDocument = {
      id: createMemoryId("doc_local"),
      kind: "episode",
      text: "JWT token validation in local auth middleware",
      summary: "Local auth JWT",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["verifyToken"],
      epistemicStatus: "verified",
      observedAt: 1000,
    }

    await Effect.runPromise(store.index([docForeign, docLocal]))

    const query: RecallQuery = {
      prompt: "JWT RS256 token verification in auth middleware",
      goal: "Verify JWT tokens",
      scope: scopeRepo,
      revision: Revision.from(15),
      activeSymbols: ["verifyToken"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    // Local scope document must rank ahead of foreign repository document
    expect(candidates[0]!.document.id).toBe(docLocal.id)
    expect(candidates[0]!.scores.scopeScore).toBeGreaterThan(candidates[1]?.scores.scopeScore ?? 0)
    await Effect.runPromise(store.close())
  })

  it("Scenario 4: Stale memory with higher vector score is blocked by Read-Time Validity Barrier", async () => {
    const store = new SurrealRecallStore("mem://", embedding)

    const staleDoc: RecallDocument = {
      id: createMemoryId("doc_stale_exact"),
      kind: "claim",
      text: "Database engine is MongoDB with replica set clustering on port 27017",
      summary: "MongoDB cluster config",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: ["claim_mongo"],
      relatedSymbols: ["mongoClient"],
      epistemicStatus: "superseded", // Superseded in Noesis!
      validToRevision: Revision.from(5),
      observedAt: 500,
    }

    await Effect.runPromise(store.index([staleDoc]))

    const query: RecallQuery = {
      prompt: "Database engine MongoDB replica set connection options",
      goal: "Connect to database",
      scope: scopeRepo,
      revision: Revision.from(10),
      activeSymbols: ["mongoClient"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    expect(candidates.length).toBeGreaterThanOrEqual(1)

    // Verify Validity Barrier: The superseded claim MUST NOT become an active claim in MemoryFrontier!
    const hardState = new HardState()
    const frontier = await Effect.runPromise(
      AutomaticRecallAdmissionHook.admitRecall(store, {
        hardState,
        userPrompt: query.prompt,
        goalDescription: query.goal,
        scope: query.scope,
        revision: query.revision,
        focusSymbols: query.activeSymbols,
      }),
    )

    // Must not appear in active claims (blocked by Validity Barrier)
    expect(frontier.active.some((c) => c.id === "doc_stale_exact" || c.id === "claim_mongo")).toBe(false)
    await Effect.runPromise(store.close())
  })

  it("Scenario 5: Rejected historical approach is delivered as warning to prevent repeated failure", async () => {
    const store = new SurrealRecallStore("mem://", embedding)

    const rejectedDoc: RecallDocument = {
      id: createMemoryId("doc_rejected_herd"),
      kind: "failure",
      text: "Flushing redis cache on every user logout caused massive database spike and thundering herd collapse",
      summary: "Cache flush on logout rejected",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: ["claim_flush_logout"],
      relatedSymbols: ["flushUserCache", "onLogout"],
      epistemicStatus: "rejected",
      observedAt: 2000,
    }

    await Effect.runPromise(store.index([rejectedDoc]))

    const query: RecallQuery = {
      prompt: "Should we flush redis cache on user logout?",
      goal: "Evaluate logout cache clearing",
      scope: scopeRepo,
      revision: Revision.from(10),
      activeSymbols: ["onLogout"],
      activeClaims: [],
      limit: 5,
    }

    const hardState = new HardState()
    const frontier = await Effect.runPromise(
      AutomaticRecallAdmissionHook.admitRecall(store, {
        hardState,
        userPrompt: query.prompt,
        goalDescription: query.goal,
        scope: query.scope,
        revision: query.revision,
        focusSymbols: query.activeSymbols,
      }),
    )

    // Must be unpacked into rejected approaches frontier
    expect(frontier.rejected.length).toBeGreaterThan(0)
    expect(frontier.rejected.some((r) => r.summary.includes("thundering herd") || r.summary.includes("rejected"))).toBe(true)
    await Effect.runPromise(store.close())
  })

  it("Scenario 6: Contradictory historical episodes maintain independent provenance and channel scores", async () => {
    const store = new SurrealRecallStore("mem://", embedding)

    const epA: RecallDocument = {
      id: createMemoryId("ep_approach_a"),
      kind: "decision",
      text: "Use in-memory Mutex for rate limiter synchronization",
      summary: "In-memory rate limiter",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["RateLimiter"],
      epistemicStatus: "superseded",
      observedAt: 1000,
      relationships: [
        { targetId: createMemoryId("ep_approach_b"), kind: "CONTRADICTS" },
      ],
    }

    const epB: RecallDocument = {
      id: createMemoryId("ep_approach_b"),
      kind: "decision",
      text: "Use Redis sliding window for rate limiter synchronization in clustered deployment",
      summary: "Redis distributed rate limiter",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["RateLimiter"],
      epistemicStatus: "verified",
      observedAt: 3000,
    }

    await Effect.runPromise(store.index([epA, epB]))

    const query: RecallQuery = {
      prompt: "RateLimiter clustering synchronization",
      goal: "Implement RateLimiter in multi-node cluster",
      scope: scopeRepo,
      revision: Revision.from(20),
      activeSymbols: ["RateLimiter"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    expect(candidates.length).toBe(2)
    // The verified cluster decision ranks ahead
    expect(candidates[0]!.document.id).toBe(epB.id)
    await Effect.runPromise(store.close())
  })

  it("Scenario 7: Graph-near but semantically orthogonal memory does not displace top semantic candidate", async () => {
    const store = new SurrealRecallStore("mem://", embedding)

    const targetDoc: RecallDocument = {
      id: createMemoryId("doc_target_sem"),
      kind: "episode",
      text: "Fixing WebCrypto subtle sign RS256 signature verification key format",
      summary: "WebCrypto RS256 format fix",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["cryptoSubtle", "importKey"],
      epistemicStatus: "verified",
      observedAt: 2000,
    }

    const graphDistractor: RecallDocument = {
      id: createMemoryId("doc_graph_distractor"),
      kind: "episode",
      text: "Updating CSS styles and layout spacing for user profile header avatar",
      summary: "CSS layout update",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["cryptoSubtle"], // accidental or shared import symbol
      epistemicStatus: "verified",
      observedAt: 2000,
    }

    await Effect.runPromise(store.index([targetDoc, graphDistractor]))

    const query: RecallQuery = {
      prompt: "WebCrypto subtle sign RS256 signature verification error",
      goal: "Fix RS256 importKey",
      scope: scopeRepo,
      revision: Revision.from(5),
      activeSymbols: ["cryptoSubtle"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    expect(candidates[0]!.document.id).toBe(targetDoc.id)
    expect(candidates[0]!.scores.semanticScore).toBeGreaterThan(candidates[1]!.scores.semanticScore)
    await Effect.runPromise(store.close())
  })

  it("Scenario 8: Vector-near but graph-disconnected memory is audited via per-channel scores", async () => {
    const store = new SurrealRecallStore("mem://", embedding)

    const doc: RecallDocument = {
      id: createMemoryId("doc_isolated_vector"),
      kind: "claim",
      text: "Worker thread concurrency queue management algorithm",
      summary: "Worker thread queue",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["isolatedWorker"],
      epistemicStatus: "verified",
      observedAt: 2000,
    }

    await Effect.runPromise(store.index([doc]))

    const query: RecallQuery = {
      prompt: "Worker thread queue management",
      goal: "Optimize worker queues",
      scope: scopeRepo,
      revision: Revision.from(1),
      activeSymbols: [], // No active symbols in query
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    expect(candidates.length).toBe(1)
    // Auditable per-channel scores
    expect(candidates[0]!.scores.semanticScore).toBeGreaterThan(0.0)
    expect(candidates[0]!.scores.graphScore).toBe(0.0) // Confirms graph channel was 0
    await Effect.runPromise(store.close())
  })

  it("Scenario 9: Embedding backend unavailable triggers degraded mode without crashing or data loss", async () => {
    // Construct store with NO embedding provider
    const store = new SurrealRecallStore("mem://")

    const doc: RecallDocument = {
      id: createMemoryId("doc_no_emb"),
      kind: "episode",
      text: "Resolved telemetry socket hangup by configuring keepalive packets",
      summary: "Telemetry socket keepalive",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["socketKeepalive"],
      epistemicStatus: "verified",
      observedAt: 1500,
    }

    await Effect.runPromise(store.index([doc]))

    const query: RecallQuery = {
      prompt: "Telemetry socket hangup keepalive",
      goal: "Fix socket drops",
      scope: scopeRepo,
      revision: Revision.from(2),
      activeSymbols: ["socketKeepalive"],
      activeClaims: [],
      limit: 5,
    }

    const candidates = await Effect.runPromise(store.recall(query))
    expect(candidates.length).toBe(1)
    expect(candidates[0]!.scores.semanticScore).toBe(0.0)
    expect(candidates[0]!.scores.lexicalScore).toBeGreaterThan(0.0)
    await Effect.runPromise(store.close())
  })

  it("Scenario 10: Corrupted or deleted recall index does not affect canonical Noesis HardState", async () => {
    const state = new HardState()
    const claim1 = createClaimId("c_core_truth")
    const ev1 = createEvidenceId("ev_core_truth")

    state.apply({
      type: "evidence_recorded",
      evidenceId: ev1,
      source: "kernel_test",
      summary: "Authoritative ground truth established",
      timestamp: new Date().toISOString(),
    })
    state.apply({
      type: "claim_asserted",
      claimId: claim1,
      proposition: "HardState is the sole epistemic source of truth",
      status: "verified",
      evidence: [ev1],
      dependencies: [],
      validityPolicy: "CURRENT_STATE",
      scope: scopeRepo,
      timestamp: new Date().toISOString(),
    })

    const store = new SurrealRecallStore("mem://", embedding)
    await Effect.runPromise(store.rebuild({ hardState: state }))
    expect(await Effect.runPromise(store.count())).toBeGreaterThan(0)

    // Simulate complete destruction of the recall store
    await Effect.runPromise(store.rebuild({ documents: [] }))
    expect(await Effect.runPromise(store.count())).toBe(0)

    // Invariant: Canonical HardState is completely intact and unaffected!
    expect(state.claims.has(claim1)).toBe(true)
    expect(state.claims.get(claim1)!.status).toBe("verified")

    // Rebuild back from HardState
    await Effect.runPromise(store.rebuild({ hardState: state }))
    expect(await Effect.runPromise(store.count())).toBeGreaterThan(0)
    await Effect.runPromise(store.close())
  })
})

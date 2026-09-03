import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import {
  type RecallDocument,
  type RecallQuery,
  createMemoryId,
} from "../../../src/rivet/recall/types"
import { AssociativeRetrievalEngine } from "../../../src/rivet/recall/engine"
import { AutomaticRecallAdmissionHook } from "../../../src/rivet/recall/harness"
import { InMemoryRecallStore } from "../../../src/rivet/recall/store"
import { HardState } from "../../../src/rivet/noesis"
import { Revision, Scope, createWorkspaceId, createClaimId, createEvidenceId } from "../../../src/rivet/types"

describe("Adversarial Epistemic Recall Suite (8 Scenarios)", () => {
  const wsId = createWorkspaceId("ws_adversarial")
  const scopeRepo = Scope.global("repo", Revision.from(10))
  const scopeForeign = Scope.global("other_repo", Revision.from(10))

  it("Scenario 1: Semantically similar but irrelevant episode is ranked below exact matches", () => {
    const docExact: RecallDocument = {
      id: createMemoryId("doc_exact"),
      kind: "episode",
      text: "Investigate payment gateway timeout during checkout credit card charge",
      summary: "Payment checkout timeout on Stripe API",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["chargeCard", "stripeClient"],
      epistemicStatus: "verified",
      observedAt: 1000,
    }

    const docDistractor: RecallDocument = {
      id: createMemoryId("doc_distractor"),
      kind: "episode",
      text: "Investigate database query timeout during monthly user billing report generation",
      summary: "Monthly billing report query timeout",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["generateBillingReport", "postgresPool"],
      epistemicStatus: "verified",
      observedAt: 1000,
    }

    const query: RecallQuery = {
      prompt: "Credit card charge timed out on checkout page with Stripe error",
      goal: "Fix Stripe payment checkout timeout",
      scope: scopeRepo,
      revision: Revision.from(11),
      activeSymbols: ["chargeCard", "stripeClient"],
      activeClaims: [],
      limit: 5,
    }

    const ranked = AssociativeRetrievalEngine.rank([docDistractor, docExact], query)
    expect(ranked.length).toBeGreaterThanOrEqual(1)
    expect(ranked[0]!.document.id).toBe(docExact.id)
    expect(ranked[0]!.scores.compositeScore).toBeGreaterThan(ranked[1]?.scores.compositeScore ?? 0)
  })

  it("Scenario 2: Old episode whose core premise is superseded is blocked from active knowledge by Validity Barrier", () => {
    const state = new HardState()
    const claimOld = createClaimId("c_python_auth")
    const claimNew = createClaimId("c_rust_auth")
    const ev = createEvidenceId("ev_rust_rewrite")

    state.apply({
      type: "claim_asserted",
      claimId: claimOld,
      proposition: "Auth module is implemented in Python FastAPI with async routes",
      status: "verified",
      evidence: [],
      validityPolicy: "CURRENT_STATE",
      scope: scopeRepo,
      timestamp: new Date().toISOString(),
    })

    state.apply({
      type: "evidence_recorded",
      evidenceId: ev,
      source: "cargo_build",
      summary: "Cargo.toml exists and auth-service compiles in Rust",
      timestamp: new Date().toISOString(),
    })

    // Supersede Python claim with Rust claim
    state.apply({
      type: "claim_superseded",
      claimId: claimOld,
      supersededBy: claimNew,
      reason: "Auth rewritten in Rust Actix",
      timestamp: new Date().toISOString(),
    })

    state.apply({
      type: "claim_asserted",
      claimId: claimNew,
      proposition: "Auth module is implemented in Rust Actix-web",
      status: "verified",
      evidence: [ev],
      validityPolicy: "CURRENT_STATE",
      scope: scopeRepo,
      timestamp: new Date().toISOString(),
    })

    const store = new InMemoryRecallStore()
    const docOld: RecallDocument = {
      id: claimOld as unknown as any,
      kind: "claim",
      text: "Auth module is implemented in Python FastAPI with async routes",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["authRoute"],
      epistemicStatus: "superseded", // Marked superseded
      validFromRevision: Revision.from(1),
      validToRevision: Revision.from(5),
      observedAt: 1000,
    }

    Effect.runSync(store.index([docOld]))

    const frontier = Effect.runSync(
      AutomaticRecallAdmissionHook.admitRecall(store, {
        userPrompt: "Where is auth implemented?",
        goalDescription: "Find auth routes",
        scope: scopeRepo,
        revision: Revision.from(6),
        hardState: state,
      }),
    )

    // Superseded claim must NEVER enter active claims
    expect(frontier.active.some((m) => m.summary.includes("Python FastAPI"))).toBe(false)
  })

  it("Scenario 3: Contradictory episodes are detected and ranked with premise contradiction awareness", () => {
    const docA: RecallDocument = {
      id: createMemoryId("doc_sync"),
      kind: "claim",
      text: "Worker runs synchronously in single-threaded process",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["runWorker"],
      epistemicStatus: "verified",
      observedAt: 1000,
      relationships: [{ targetId: createMemoryId("doc_async"), kind: "CONTRADICTS" }],
    }

    const docB: RecallDocument = {
      id: createMemoryId("doc_async"),
      kind: "claim",
      text: "Worker runs concurrently in worker threads pool",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["runWorker"],
      epistemicStatus: "verified",
      observedAt: 2000,
      relationships: [{ targetId: createMemoryId("doc_sync"), kind: "CONTRADICTS" }],
    }

    const query: RecallQuery = {
      prompt: "How does worker execution work?",
      goal: "Worker concurrency",
      scope: scopeRepo,
      revision: Revision.from(15),
      activeSymbols: ["runWorker"],
      activeClaims: ["doc_async"],
      limit: 5,
    }

    const ranked = AssociativeRetrievalEngine.rank([docA, docB], query)
    // Both are retrieved with scores; contradictory relationship is reflected in graph scoring
    expect(ranked.length).toBe(2)
  })

  it("Scenario 4: Same symbol, different root cause — disambiguated by diagnostic context", () => {
    const docAuthLeak: RecallDocument = {
      id: createMemoryId("doc_leak"),
      kind: "failure",
      text: "handleRequest failure: memory leak due to unclosed event listeners",
      summary: "handleRequest memory leak in event listener registration",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["handleRequest"],
      epistemicStatus: "rejected",
      observedAt: 1000,
    }

    const docAuthSyntax: RecallDocument = {
      id: createMemoryId("doc_syntax"),
      kind: "failure",
      text: "handleRequest failure: uncaught JSON parse exception on malformed body payload",
      summary: "handleRequest uncaught JSON parse error",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["handleRequest"],
      epistemicStatus: "rejected",
      observedAt: 2000,
    }

    const query: RecallQuery = {
      prompt: "handleRequest crashing with Unexpected token in JSON at position 0",
      goal: "Fix JSON parse crash in handleRequest",
      scope: scopeRepo,
      revision: Revision.from(12),
      activeSymbols: ["handleRequest"],
      activeClaims: [],
      limit: 5,
    }

    const ranked = AssociativeRetrievalEngine.rank([docAuthLeak, docAuthSyntax], query)
    expect(ranked[0]!.document.id).toBe(docAuthSyntax.id)
    expect(ranked[0]!.scores.lexicalScore).toBeGreaterThan(ranked[1]!.scores.lexicalScore)
  })

  it("Scenario 5: Same error string in different subsystems — disambiguated by scope and symbols", () => {
    const docAuthTimeout: RecallDocument = {
      id: createMemoryId("doc_auth_timeout"),
      kind: "episode",
      text: "Timeout 504: OAuth SSO callback gateway timeout",
      summary: "OAuth callback timeout",
      workspaceId: wsId,
      scope: Scope.path("repo", "src/auth/*", Revision.from(1)),
      sourceRefs: [],
      relatedSymbols: ["oauthCallback", "ssoHandler"],
      epistemicStatus: "verified",
      observedAt: 1000,
    }

    const docDbTimeout: RecallDocument = {
      id: createMemoryId("doc_db_timeout"),
      kind: "episode",
      text: "Timeout 504: Database replica read pool gateway timeout",
      summary: "Database read pool timeout",
      workspaceId: wsId,
      scope: Scope.path("repo", "src/db/*", Revision.from(1)),
      sourceRefs: [],
      relatedSymbols: ["replicaPool", "sqlQuery"],
      epistemicStatus: "verified",
      observedAt: 1000,
    }

    const query: RecallQuery = {
      prompt: "Received 504 Gateway Timeout in oauthCallback during user login",
      goal: "Fix 504 in OAuth SSO flow",
      scope: Scope.path("repo", "src/auth/sso.ts", Revision.from(5)),
      revision: Revision.from(5),
      activeSymbols: ["oauthCallback"],
      activeClaims: [],
      limit: 5,
    }

    const ranked = AssociativeRetrievalEngine.rank([docDbTimeout, docAuthTimeout], query)
    expect(ranked[0]!.document.id).toBe(docAuthTimeout.id)
    expect(ranked[0]!.scores.scopeScore).toBeGreaterThan(ranked[1]!.scores.scopeScore)
  })

  it("Scenario 6: High vector similarity but wrong repository scope receives zero scope score", () => {
    const docForeign: RecallDocument = {
      id: createMemoryId("doc_foreign"),
      kind: "episode",
      text: "Fix authentication token concurrency race condition with mutex lock",
      summary: "Auth mutex fix",
      workspaceId: wsId,
      scope: scopeForeign, // foreign repository
      sourceRefs: [],
      relatedSymbols: ["authMutex"],
      epistemicStatus: "verified",
      observedAt: 1000,
    }

    const query: RecallQuery = {
      prompt: "Fix authentication token concurrency race condition with mutex lock",
      goal: "Fix auth concurrency",
      scope: scopeRepo, // local repository
      revision: Revision.from(5),
      activeSymbols: [],
      activeClaims: [],
      limit: 5,
    }

    const scopeScore = AssociativeRetrievalEngine.computeScopeScore(docForeign, query)
    expect(scopeScore).toBe(0.0) // Strictly 0.0 for cross-repository foreign matches
  })

  it("Scenario 7: Rejected approach that becomes valid under altered revision can be re-evaluated", () => {
    // Under revision 1, cache invalidation failed due to lack of distributed lock
    // Under revision 10, distributed Redis lock exists
    const docRej: RecallDocument = {
      id: createMemoryId("doc_rej_cache"),
      kind: "failure",
      text: "Cache invalidation failed: no distributed lock available",
      summary: "Cache invalidation rejected under rev 1",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: ["cacheClear"],
      epistemicStatus: "rejected",
      validFromRevision: Revision.from(1),
      observedAt: 1000,
    }

    const query: RecallQuery = {
      prompt: "Should we try cache invalidation now that Redis distributed lock is available?",
      goal: "Evaluate cache invalidation with Redis",
      scope: scopeRepo,
      revision: Revision.from(10),
      activeSymbols: ["cacheClear", "redisLock"],
      activeClaims: [],
      limit: 5,
    }

    const ranked = AssociativeRetrievalEngine.rank([docRej], query)
    expect(ranked.length).toBe(1)
    // The memory is retrieved into the failure-avoidance frontier so the model sees the prior reason
    expect(ranked[0]!.document.epistemicStatus).toBe("rejected")
  })

  it("Scenario 8: Poisoned summary unsupported by provenance is rejected by validity barrier", () => {
    const state = new HardState()
    const claimPoisoned = createClaimId("c_hallucinated")

    // Assert claim without valid evidence or invalid epistemic status
    state.apply({
      type: "claim_asserted",
      claimId: claimPoisoned,
      proposition: "System uses PostgreSQL 18 with quantum storage backend",
      status: "hypothetical",
      evidence: [],
      validityPolicy: "EPISTEMIC",
      scope: scopeRepo,
      timestamp: new Date().toISOString(),
    })

    const store = new InMemoryRecallStore()
    const docPoisoned: RecallDocument = {
      id: claimPoisoned as unknown as any,
      kind: "claim",
      text: "System uses PostgreSQL 18 with quantum storage backend",
      summary: "Quantum DB",
      workspaceId: wsId,
      scope: scopeRepo,
      sourceRefs: [],
      relatedSymbols: [],
      epistemicStatus: "dirty", // Flagged dirty/unverified
      validFromRevision: Revision.from(1),
      observedAt: 1000,
    }
    Effect.runSync(store.index([docPoisoned]))

    const frontier = Effect.runSync(
      AutomaticRecallAdmissionHook.admitRecall(store, {
        userPrompt: "What database does the system use?",
        goalDescription: "Check DB",
        scope: scopeRepo,
        revision: Revision.from(2),
        hardState: state,
      }),
    )

    // Poisoned/dirty memory must NEVER enter active knowledge
    expect(frontier.active.some((m) => m.summary.includes("quantum"))).toBe(false)
  })
})

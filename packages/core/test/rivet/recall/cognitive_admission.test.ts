import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import {
  Noesis,
  HardState,
  type TaskPhase,
} from "../../../src/rivet/noesis"
import {
  HindsightMemoryBackend,
  AgentMemoryValidityBarrier,
  type MemoryIngressRecord,
  type MemoryQuery,
} from "../../../src/rivet/recall"
import { Revision, Scope } from "../../../src/rivet/types"

describe("Noesis Cognitive Admission Policy & Epistemic-Temporal Gatekeeper", () => {
  const scope = Scope.global("test-repo", Revision.from(100))

  it("Invariant: SoftWorkspace provisional hypotheses are SUPPRESSED during diagnosis", () => {
    const hardState = new HardState()
    const decision = Noesis.admitMemory(
      {
        id: "mem_provisional_1",
        content: "Provisional hypothesis: Server TCP keepalive drop is causing connection starvation",
        score: 0.85,
        proposedKind: "soft_hypothesis",
        revision: Revision.from(10), // H2 horizon
        scope,
      },
      {
        hardState,
        taskPhase: "diagnosis",
        currentRevision: Revision.from(100),
        scope,
        activeSymbols: ["poolStarvation"],
      }
    )

    expect(decision.kind).toBe("SUPPRESS")
    if (decision.kind === "SUPPRESS") {
      expect(decision.reason).toContain("Provisional SoftWorkspace hypotheses are strictly suppressed during diagnosis")
    }
  })

  it("Invariant: SoftWorkspace provisional hypotheses are conditionally ADMITTED during brainstorming", () => {
    const hardState = new HardState()
    const decision = Noesis.admitMemory(
      {
        id: "mem_provisional_2",
        content: "Provisional hypothesis: Maybe database connection pool is leaking idle sockets",
        score: 0.80,
        proposedKind: "soft_hypothesis",
        revision: Revision.from(90), // H1 horizon
        scope,
      },
      {
        hardState,
        taskPhase: "brainstorming",
        currentRevision: Revision.from(100),
        scope,
        activeSymbols: ["poolStarvation"],
      }
    )

    expect(decision.kind).toBe("ADMIT_HISTORICAL")
    if (decision.kind === "ADMIT_HISTORICAL") {
      expect(decision.ref.summary).toContain("[PROVISIONAL HYPOTHESIS]")
    }
  })

  it("Invariant: Memory candidate cannot mint 'verified' without canonical HardState proof", () => {
    const hardState = new HardState()
    // The candidate claims to be authoritative, but HardState has no record of it
    const decision = Noesis.admitMemory(
      {
        id: "mem_unbacked_authoritative",
        content: "All network calls are strictly encrypted with TLS 1.3",
        score: 0.90,
        metadata: { authority: "authoritative" },
        revision: Revision.from(95),
        scope,
      },
      {
        hardState,
        taskPhase: "implementation",
        currentRevision: Revision.from(100),
        scope,
      }
    )

    // Since it has no canonical claim in HardState, it cannot be admitted as an authoritative verified claim
    expect(decision.kind).toBe("ADMIT_HISTORICAL")
    if (decision.kind === "ADMIT_HISTORICAL") {
      expect(decision.ref.status).not.toBe("verified")
    }
  })

  it("Invariant: Canonical HardState claim is projected with authoritative status", () => {
    const hardState = new HardState()
    hardState.claims.set("claim_tls_verified" as any, {
      id: "claim_tls_verified" as any,
      proposition: "mTLS with SPIFFE token exchange is strictly required",
      status: "verified",
      validityPolicy: "EPISTEMIC",
      validFromRevision: Revision.from(80),
      learnedAtRevision: Revision.from(80),
      dependencies: [],
      dependsOn: [],
      supportingEvidence: [],
      scope,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const decision = Noesis.admitMemory(
      {
        id: "mem_tls",
        sourceRefs: ["claim_tls_verified"],
        content: "mTLS with SPIFFE token exchange is strictly required",
        score: 0.92,
        revision: Revision.from(80),
        scope,
      },
      {
        hardState,
        taskPhase: "implementation",
        currentRevision: Revision.from(100),
        scope,
      }
    )

    expect(decision.kind).toBe("ADMIT_CURRENT")
    if (decision.kind === "ADMIT_CURRENT") {
      expect(decision.ref.status).toBe("verified")
    }
  })

  it("Invariant: Long-horizon memory (H2) without active symbol match or strong score is SUPPRESSED", () => {
    const hardState = new HardState()
    const decision = Noesis.admitMemory(
      {
        id: "mem_old_vague_episode",
        content: "Encountered slow HTTP response on unrelated dashboard endpoint",
        score: 0.45, // Weak score
        proposedKind: "episode",
        revision: Revision.from(20), // H2 horizon (delta = 80 revs)
        scope,
        relatedSymbols: ["dashboardRoute"],
      },
      {
        hardState,
        taskPhase: "diagnosis",
        currentRevision: Revision.from(100),
        scope,
        activeSymbols: ["tokenRefresh", "authGateway"], // No symbol overlap
      }
    )

    expect(decision.kind).toBe("SUPPRESS")
    if (decision.kind === "SUPPRESS") {
      expect(decision.reason).toContain("Long-horizon historical memory requires strong relevance score")
    }
  })

  it("End-to-end: AgentMemoryValidityBarrier suppresses TCP keepalive provisional note during active bug diagnosis", async () => {
    const backend = new HindsightMemoryBackend({ mode: "controlled" })
    const records: MemoryIngressRecord[] = [
      {
        id: "mem_c2_s1_leak",
        kind: "episode",
        authority: "authoritative",
        content: "Fixed idle connection leak: unhandled streaming query error skipped pool.release. Enforced try/finally guard on poolAcquire.",
        revision: Revision.from(10),
        scope,
        timestamp: 1000,
        relatedSymbols: ["poolAcquire", "releaseConnection"],
      },
      {
        id: "mem_c2_s1_tcp_soft",
        kind: "soft_hypothesis",
        authority: "provisional",
        content: "Provisional hypothesis: Server TCP keepalive drop is causing connection starvation",
        revision: Revision.from(10),
        scope,
        timestamp: 1000,
        relatedSymbols: ["tcpKeepalive", "poolStarvation"],
      },
    ]
    await Effect.runPromise(backend.ingest(records))

    const hardState = new HardState()
    const query: MemoryQuery = {
      prompt: "Workers report connection starvation error after uptime with idle database connections. Diagnose connection pool leak.",
      goal: "Diagnose idle database connection pool leak",
      scope,
      revision: Revision.from(100),
      activeSymbols: ["poolAcquire", "poolStarvation"],
      limit: 5,
    }

    // Run admission in diagnosis phase
    const frontier = await Effect.runPromise(
      AgentMemoryValidityBarrier.admitRecall({
        hardState,
        backend,
        query,
        taskPhase: "diagnosis",
      })
    )

    // The provisional hypothesis MUST NOT be admitted to episodic, active, or procedural frontier!
    const leakedSoft = frontier.episodic.find((m) => m.id === "mem_c2_s1_tcp_soft")
    expect(leakedSoft).toBeUndefined()

    // The authoritative fix with matching symbols MUST be admitted!
    const admittedFix = frontier.episodic.find((m) => m.id === "mem_c2_s1_leak")
    expect(admittedFix).toBeDefined()
  })

  it("Architecture Migration: Python to Rust migration suppresses legacy Python asyncio memories in implementation", () => {
    const hardState = new HardState()

    // Rev 10: Python architecture (superseded at Rev 50)
    hardState.claims.set("claim_lang_py" as any, {
      id: "claim_lang_py" as any,
      proposition: "Core engine runs on Python 3.11 with asyncio event loop",
      status: "superseded",
      supersededBy: "claim_lang_rust" as any,
      validityPolicy: "EPISTEMIC",
      validFromRevision: Revision.from(10),
      validToRevision: Revision.from(50),
      learnedAtRevision: Revision.from(10),
      dependencies: [],
      dependsOn: [],
      supportingEvidence: [],
      scope,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Rev 50: Rust architecture (current verified truth)
    hardState.claims.set("claim_lang_rust" as any, {
      id: "claim_lang_rust" as any,
      proposition: "Core engine is completely rewritten in Rust with Tokio async runtime and zero-cost abstractions",
      status: "verified",
      validityPolicy: "EPISTEMIC",
      validFromRevision: Revision.from(50),
      learnedAtRevision: Revision.from(50),
      dependencies: [],
      dependsOn: [],
      supportingEvidence: [],
      scope,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const candidatePy = {
      id: "mem_py_concurrency",
      sourceRefs: ["claim_lang_py"],
      content: "Use Python threading and asyncio.gather for concurrent worker execution",
      score: 0.88,
      revision: Revision.from(10),
      relatedSymbols: ["asyncio", "gather"],
    }

    const candidateRust = {
      id: "mem_rust_concurrency",
      sourceRefs: ["claim_lang_rust"],
      content: "Core engine is completely rewritten in Rust with Tokio async runtime and zero-cost abstractions",
      score: 0.95,
      revision: Revision.from(50),
      relatedSymbols: ["tokio", "spawn"],
    }

    const ctxImpl = {
      hardState,
      taskPhase: "implementation" as TaskPhase,
      currentRevision: Revision.from(100),
      scope,
      activeSymbols: ["tokio", "spawn"],
    }

    // In implementation phase: Python memory MUST be SUPPRESSED
    const decPy = Noesis.admitMemory(candidatePy, ctxImpl)
    expect(decPy.kind).toBe("SUPPRESS")
    if (decPy.kind === "SUPPRESS") {
      expect(decPy.reason).toContain("Superseded architectural facts are suppressed during implementation")
    }

    // In implementation phase: Rust memory MUST be ADMITTED with verified status
    const decRust = Noesis.admitMemory(candidateRust, ctxImpl)
    expect(decRust.kind).toBe("ADMIT_CURRENT")
    if (decRust.kind === "ADMIT_CURRENT") {
      expect(decRust.ref.status).toBe("verified")
    }
  })
})

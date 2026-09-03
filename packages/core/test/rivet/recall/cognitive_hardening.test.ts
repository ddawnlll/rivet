import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import {
  Noesis,
  HardState,
  type ArchitectureEpoch,
  type TaskPhase,
} from "../../../src/rivet/noesis"
import {
  HindsightMemoryBackend,
  AgentMemoryValidityBarrier,
  inferTaskPhase,
  type MemoryIngressRecord,
  type MemoryQuery,
} from "../../../src/rivet/recall"
import { Revision, Scope } from "../../../src/rivet/types"

describe("Noesis Cognitive Hardening: Epochs, Explicit TaskPhase & Mandatory Canonical Refs", () => {
  const scope = Scope.global("core-service", Revision.from(100))

  it("Hardening 1: Mandatory sourceRefs - candidate without sourceRefs CANNOT be admitted as authoritative", () => {
    const hardState = new HardState()
    // Even if HardState has a claim with id "claim_123"
    hardState.claims.set("claim_123" as any, {
      id: "claim_123" as any,
      proposition: "Security auth token is encrypted with AES-256-GCM",
      status: "verified",
      validityPolicy: "EPISTEMIC",
      validFromRevision: Revision.from(90),
      learnedAtRevision: Revision.from(90),
      dependencies: [],
      dependsOn: [],
      supportingEvidence: [],
      scope,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Candidate arrives with id matching claim_123, but NO sourceRefs!
    const candidateWithoutSourceRefs = {
      id: "claim_123",
      content: "Security auth token is encrypted with AES-256-GCM",
      score: 0.95,
      // sourceRefs omitted!
      revision: Revision.from(90),
      scope,
    }

    const ctx = {
      hardState,
      taskPhase: "implementation" as TaskPhase,
      currentRevision: Revision.from(100),
      scope,
    }

    const decision = Noesis.admitMemory(candidateWithoutSourceRefs, ctx)

    // Invariant: Without canonical sourceRefs, it CANNOT be ADMIT_CURRENT!
    expect(decision.kind).toBe("ADMIT_HISTORICAL")
    if (decision.kind === "ADMIT_HISTORICAL") {
      expect(decision.ref.status).not.toBe("verified")
    }

    // When valid canonical sourceRefs are provided, it IS admitted as authoritative
    const candidateWithSourceRefs = {
      ...candidateWithoutSourceRefs,
      sourceRefs: ["claim_123"],
    }
    const verifiedDecision = Noesis.admitMemory(candidateWithSourceRefs, ctx)
    expect(verifiedDecision.kind).toBe("ADMIT_CURRENT")
    if (verifiedDecision.kind === "ADMIT_CURRENT") {
      expect(verifiedDecision.ref.status).toBe("verified")
    }
  })

  it("Hardening 2: Architecture Epochs - deltaRev = 1 across epoch boundary is treated as H2 Long-Term Historical", () => {
    const hardState = new HardState()

    const pythonEpoch: ArchitectureEpoch = {
      id: "epoch_python",
      name: "Python Async Architecture",
      startRevision: Revision.from(1),
      endRevision: Revision.from(100),
      primaryLanguage: "Python",
    }
    const rustEpoch: ArchitectureEpoch = {
      id: "epoch_rust",
      name: "Rust Tokio Architecture",
      startRevision: Revision.from(101),
      endRevision: Revision.from(200),
      primaryLanguage: "Rust",
    }

    hardState.recordEpoch(pythonEpoch)
    hardState.recordEpoch(rustEpoch)

    // Current revision is r101 (in Rust Epoch)
    // Candidate revision is r100 (in Python Epoch) -> Revision distance is ONLY 1 commit!
    const candidateLastPythonCommit = {
      id: "mem_last_py",
      content: "Use Python asyncio.get_event_loop() for background worker tasks",
      score: 0.50, // Moderate relevance
      revision: Revision.from(100), // r100 in epoch_python
      scope,
      relatedSymbols: ["asyncio"],
    }

    const ctx = {
      hardState,
      taskPhase: "implementation" as TaskPhase,
      currentRevision: Revision.from(101), // r101 in epoch_rust
      scope,
      activeSymbols: ["tokio", "worker"], // No symbol overlap
    }

    const decision = Noesis.admitMemory(candidateLastPythonCommit, ctx)

    // Even though deltaRev = 1 (which normally would be H0),
    // because it crosses the ArchitectureEpoch boundary, it is forced to H2_LONG_TERM!
    expect(decision.horizon).toBe("H2_LONG_TERM")

    // And because score is 0.50 and there is no active symbol match with the new Rust codebase,
    // it is SUPPRESSED!
    expect(decision.kind).toBe("SUPPRESS")
    if (decision.kind === "SUPPRESS") {
      expect(decision.reason).toContain("Long-horizon historical memory requires strong relevance score")
    }
  })

  it("Hardening 3: Explicit Harness TaskPhase overrides ambiguous prompt keyword heuristics", () => {
    const query: MemoryQuery = {
      // Conflicting text: contains "timeout", "bug", AND "implement"
      prompt: "Why did the timeout bug reoccur? Implement the new retry coordinator.",
      goal: "Implement retry coordinator",
      scope,
      revision: Revision.from(100),
      limit: 5,
    }

    // Heuristic inferTaskPhase without context would detect "timeout" or "why" and pick diagnosis
    const inferred = inferTaskPhase(query)
    expect(inferred).toBe("diagnosis")

    // But Harness explicitly knows the execution state is PLANNING
    const hardState = new HardState()
    const procedureMem = {
      id: "mem_procedure_retry",
      content: "Retry coordinator procedure: 1. exponential backoff with full jitter, 2. max 3 retries, 3. dead letter queue on 4th attempt.",
      score: 0.75,
      proposedKind: "procedure",
      revision: Revision.from(95),
      scope,
    }

    // In explicit planning phase: procedure is ADMIT_PROCEDURAL
    const planningDecision = Noesis.admitMemory(procedureMem, {
      hardState,
      taskPhase: "planning", // Explicit Harness State
      currentRevision: Revision.from(100),
      scope,
    })
    expect(planningDecision.kind).toBe("ADMIT_PROCEDURAL")

    // In explicit orientation phase: provisional SoftWorkspace notes are SUPPRESSED
    const softHypothesisMem = {
      id: "mem_soft_random",
      content: "Provisional hypothesis: Maybe the network switch is dropping TCP SYN packets",
      score: 0.80,
      proposedKind: "soft_hypothesis",
      revision: Revision.from(95),
      scope,
    }
    const orientationDecision = Noesis.admitMemory(softHypothesisMem, {
      hardState,
      taskPhase: "orientation", // Explicit Harness State
      currentRevision: Revision.from(100),
      scope,
    })
    expect(orientationDecision.kind).toBe("SUPPRESS")
    if (orientationDecision.kind === "SUPPRESS") {
      expect(orientationDecision.reason).toContain("Provisional SoftWorkspace hypotheses are strictly suppressed during orientation")
    }
  })
})

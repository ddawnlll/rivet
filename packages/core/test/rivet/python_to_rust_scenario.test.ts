import { describe, expect, test } from "bun:test"
import {
  HardState,
  type NoesisEvent,
} from "../../src/rivet/noesis"
import {
  Revision,
  Scope,
  createClaimId,
  createEvidenceId,
} from "../../src/rivet/types"
import { ValidityEngine } from "../../src/rivet/validity"
import { CognitiveViewCompiler } from "../../src/rivet/view-compiler"

describe("Canonical Python → Rust Migration Scenario (Constitutional Invariant)", () => {
  test("Full lifecycle: Change-time invalidation -> Write-time supersession -> Read-time filtering -> Premise conflict detection", () => {
    const scope = Scope.global("demo-repo", Revision.ZERO)
    const pythonClaimId = createClaimId("claim_python")
    const rustClaimId = createClaimId("claim_rust")

    const state = new HardState()

    // 1. Initial State: Python project
    state.apply({
      type: "goal_set",
      goal: "Maintain web service",
      timestamp: new Date().toISOString(),
    })

    const pythonEvidence = createEvidenceId("ev_py")
    state.apply({
      type: "evidence_recorded",
      evidenceId: pythonEvidence,
      source: "repo_census",
      summary: "Found pyproject.toml and src/app.py",
      timestamp: new Date().toISOString(),
    })

    state.apply({
      type: "claim_asserted",
      claimId: pythonClaimId,
      proposition: "Primary implementation language is Python",
      status: "supported",
      evidence: [pythonEvidence],
      dependencies: [
        { type: "manifest", name: "pyproject.toml" },
        { type: "file", path: "src/app.py" },
      ],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    expect(state.claims.get(pythonClaimId)?.status).toBe("supported")

    // Compile Initial View
    const initialView = CognitiveViewCompiler.compile({
      hardState: state,
      goalDescription: "Maintain web service",
      repositoryId: "demo-repo",
      tokenBudget: 2000,
      mode: "HYBRID",
    })

    expect(initialView.activeClaims.map((c) => c.id)).toContain(pythonClaimId)
    expect(initialView.premiseConflicts.length).toBe(0)

    // 2. Repository Mutates into Rust
    const envChanges = [
      { type: "file_deleted" as const, path: "pyproject.toml" },
      { type: "manifest_changed" as const, name: "Cargo.toml" },
      { type: "file_created" as const, path: "src/main.rs" },
    ]

    const impact = ValidityEngine.analyzeEnvironmentChanges(state.validityGraph, state, envChanges)
    expect(impact.allDirtyClaimIds).toContain(pythonClaimId)

    // Mark Python claim DIRTY
    state.apply({
      type: "claim_dirtied",
      claimId: pythonClaimId,
      reason: "pyproject.toml deleted; Cargo.toml added",
      timestamp: new Date().toISOString(),
    })

    expect(state.claims.get(pythonClaimId)?.status).toBe("dirty")

    // At this moment, Read-Time Barrier eliminates Python from active knowledge!
    const midView = CognitiveViewCompiler.compile({
      hardState: state,
      goalDescription: "Maintain web service",
      repositoryId: "demo-repo",
      tokenBudget: 2000,
      mode: "HYBRID",
    })
    expect(midView.activeClaims.map((c) => c.id)).not.toContain(pythonClaimId)
    expect(midView.dirtyClaims.map((c) => c.id)).toContain(pythonClaimId)

    // 3. Write-Time Barrier: Admit new Rust claim and automatically supersede Python claim
    const rustEvidence = createEvidenceId("ev_rs")
    state.apply({
      type: "evidence_recorded",
      evidenceId: rustEvidence,
      source: "repo_census",
      summary: "Found Cargo.toml and src/main.rs",
      timestamp: new Date().toISOString(),
    })

    const adjudication = ValidityEngine.adjudicateWriteTime(state, {
      claimId: rustClaimId,
      proposition: "Primary implementation language is Rust",
      proposedStatus: "supported",
      supportingEvidence: [rustEvidence],
      scope,
      timestamp: new Date().toISOString(),
    })

    expect(adjudication.action).toBe("supersede")
    expect(adjudication.supersededClaimId).toBe(pythonClaimId)

    // Apply supersession & assertion
    state.apply({
      type: "claim_superseded",
      claimId: pythonClaimId,
      supersededBy: rustClaimId,
      reason: "Superseded by Rust rewrite",
      timestamp: new Date().toISOString(),
    })

    state.apply({
      type: "claim_asserted",
      claimId: rustClaimId,
      proposition: "Primary implementation language is Rust",
      status: "supported",
      evidence: [rustEvidence],
      dependencies: [
        { type: "manifest", name: "Cargo.toml" },
        { type: "file", path: "src/main.rs" },
      ],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    expect(state.claims.get(pythonClaimId)?.status).toBe("superseded")
    expect(state.claims.get(rustClaimId)?.status).toBe("supported")

    // 4. Read-Time Barrier & Premise Conflict Detection
    const userPromptWithFalsePremise = "Please fix the auth handler in our Python codebase"

    const finalView = CognitiveViewCompiler.compile({
      hardState: state,
      goalDescription: "Maintain web service",
      repositoryId: "demo-repo",
      userPrompt: userPromptWithFalsePremise,
      currentEnvironmentLanguage: "Rust",
      tokenBudget: 2000,
      mode: "HYBRID",
    })

    // Active claims must contain ONLY Rust
    expect(finalView.activeClaims.map((c) => c.id)).toContain(rustClaimId)
    expect(finalView.activeClaims.map((c) => c.id)).not.toContain(pythonClaimId)

    // Structured premise conflict must be flagged
    expect(finalView.premiseConflicts.length).toBeGreaterThan(0)
    const conflict = finalView.premiseConflicts[0]
    expect(conflict.userPremise).toContain("Python")
    expect(conflict.currentValidState).toContain("Rust")
    expect(conflict.conflictingClaimId).toBe(pythonClaimId)

    // Memory Frontier check
    expect(finalView.memoryFrontier.active.map((m) => m.id)).toContain(rustClaimId)
    expect(finalView.memoryFrontier.active.map((m) => m.id)).not.toContain(pythonClaimId)
  })
})

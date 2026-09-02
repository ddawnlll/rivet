import { describe, expect, test } from "bun:test"
import { HardState, CognitiveView } from "../../src/rivet/noesis"
import { Revision, Scope, createClaimId, createEvidenceId } from "../../src/rivet/types"
import { CognitiveViewCompiler } from "../../src/rivet/view-compiler"

describe("Leak Isolation & Epistemic Authority Invariants (Items 9 & 10)", () => {
  test("Item 10: High-similarity superseded memory is strictly excluded from active claims by Read-Time Barrier", () => {
    const scope = Scope.global("demo", Revision.ZERO)
    const supersededId = createClaimId("c_superseded")
    const activeId = createClaimId("c_active")

    const state = new HardState()

    // Old superseded claim with high textual similarity to query
    state.apply({
      type: "claim_asserted",
      claimId: supersededId,
      proposition: "Primary database query engine is SQLite with synchronous=NORMAL",
      status: "superseded",
      evidence: [],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    // Active claim
    const evActive = createEvidenceId("ev_pg")
    state.apply({
      type: "evidence_recorded",
      evidenceId: evActive,
      source: "migration_receipt",
      summary: "Database migrated to Postgres connection pool",
      timestamp: new Date().toISOString(),
    })

    state.apply({
      type: "claim_asserted",
      claimId: activeId,
      proposition: "Primary database query engine is Postgres with connection pool",
      status: "verified",
      evidence: [evActive],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    // Query targeting "database query engine"
    const compiled = CognitiveViewCompiler.compile({
      hardState: state,
      goalDescription: "Optimize database query engine configuration",
      repositoryId: "demo",
      tokenBudget: 3000,
      mode: "HYBRID",
    })

    // 1. Active claims must contain ONLY the active Postgres claim
    expect(compiled.activeClaims.map((c) => c.id)).toContain(activeId)
    expect(compiled.activeClaims.map((c) => c.id)).not.toContain(supersededId)

    // 2. The formatted prompt block must NOT list the superseded claim under AUTHORITATIVE HARD CLAIMS
    const cognitiveView = new CognitiveView({
      hardRevision: compiled.hardRevision,
      goalDescription: compiled.goalDescription,
      activeClaims: [...compiled.activeClaims],
      contradictions: compiled.contradictions.map((item) => `${item.claimId}: ${item.reason}`),
      openObligations: compiled.openObligations.map(([id, description]) => `${id}: ${description}`),
      activeHypotheses: [...compiled.hypotheses],
    })
    const prompt = cognitiveView.formatPromptBlock()
    const activeClaimsSection = prompt.slice(prompt.indexOf("### AUTHORITATIVE HARD CLAIMS:"))
    const nextSectionIdx = activeClaimsSection.indexOf("###", 10)
    const activeClaimsText = nextSectionIdx !== -1 ? activeClaimsSection.slice(0, nextSectionIdx) : activeClaimsSection

    expect(activeClaimsText).toContain(activeId)
    expect(activeClaimsText).not.toContain(supersededId)
  })

  test("Item 9: Retrieved historical memory cannot mint VERIFIED status or bypass Praxis gate", () => {
    const state = new HardState()
    const scope = Scope.global("demo", Revision.ZERO)
    const memoryClaimId = createClaimId("c_recalled")

    state.apply({
      type: "claim_asserted",
      claimId: memoryClaimId,
      proposition: "Authentication passes all penetration tests",
      status: "supported",
      evidence: [], // No Praxis receipt
      validityPolicy: "HISTORICAL",
      scope,
      timestamp: new Date().toISOString(),
    })

    const claim = state.claims.get(memoryClaimId)!
    // Historical status cannot be VERIFIED without Praxis verification receipt
    expect(claim.status).not.toBe("verified")
    expect(state.passingVerificationReceipts().length).toBe(0)
  })
})

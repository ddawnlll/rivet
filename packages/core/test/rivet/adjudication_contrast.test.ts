import { describe, expect, test } from "bun:test"
import { HardState } from "../../src/rivet/noesis"
import { Revision, Scope, createClaimId, createEvidenceId } from "../../src/rivet/types"
import { ValidityEngine } from "../../src/rivet/validity"

describe("Write-Time Adjudication: Supersession vs Contradiction Audit (Item 1)", () => {
  test("Deterministic Temporal Supersession: Replacing an already DIRTY claim triggers supersession", () => {
    const scope = Scope.global("repo", Revision.ZERO)
    const oldClaimId = createClaimId("old_claim")
    const newClaimId = createClaimId("new_claim")

    const state = new HardState()
    state.apply({
      type: "claim_asserted",
      claimId: oldClaimId,
      proposition: "Auth mechanism is session cookies",
      status: "supported",
      evidence: [],
      dependencies: [{ type: "file", path: "src/auth.ts" }],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    // Environment changes: auth.ts modified -> claim becomes DIRTY
    state.apply({
      type: "claim_dirtied",
      claimId: oldClaimId,
      reason: "src/auth.ts rewritten",
      timestamp: new Date().toISOString(),
    })

    const newEvidence = createEvidenceId("ev_jwt")
    state.apply({
      type: "evidence_recorded",
      evidenceId: newEvidence,
      source: "code_inspection",
      summary: "src/auth.ts now implements JWT bearer tokens",
      timestamp: new Date().toISOString(),
    })

    // New claim proposes JWT auth for the same slot
    const result = ValidityEngine.adjudicateWriteTime(state, {
      claimId: newClaimId,
      proposition: "Auth mechanism is JWT bearer tokens",
      proposedStatus: "supported",
      supportingEvidence: [newEvidence],
      scope,
      timestamp: new Date().toISOString(),
    })

    expect(result.action).toBe("supersede")
    expect(result.supersededClaimId).toBe(oldClaimId)
  })

  test("Unresolved Contradiction: Mere contradictory claim against active non-dirty claim does NOT arbitrarily supersede", () => {
    const scope = Scope.global("repo", Revision.ZERO)
    const activeClaimId = createClaimId("active_claim")
    const conflictingClaimId = createClaimId("conflict_claim")

    const state = new HardState()
    const ev1 = createEvidenceId("ev_active")
    state.apply({
      type: "evidence_recorded",
      evidenceId: ev1,
      source: "audit",
      summary: "Verified server runs on port 8080",
      timestamp: new Date().toISOString(),
    })

    state.apply({
      type: "claim_asserted",
      claimId: activeClaimId,
      proposition: "Default port is 8080",
      status: "verified",
      evidence: [ev1],
      dependencies: [{ type: "file", path: "config.json" }],
      validityPolicy: "CURRENT_STATE",
      scope,
      timestamp: new Date().toISOString(),
    })

    // Notice: config.json was NOT modified, activeClaim is NOT dirty.
    // An adversarial/erroneous model turn proposes that default port is 9090 without evidence or invalidation
    const result = ValidityEngine.adjudicateWriteTime(state, {
      claimId: conflictingClaimId,
      proposition: "Default port is 9090",
      proposedStatus: "supported",
      supportingEvidence: [], // No fresh evidence
      scope,
      timestamp: new Date().toISOString(),
    })

    // Must be classified as CONTRADICT, not supersede!
    expect(result.action).toBe("contradict")
    expect(result.supersededClaimId).toBeUndefined()
    expect(result.contradictionReason).toContain("without prior dependency invalidation")

    // Active claim remains intact in HardState
    expect(state.claims.get(activeClaimId)?.status).toBe("verified")
  })
})

import type { HardState, ClaimRecord } from "./noesis"
import { Revision, Scope, type ClaimId, type EvidenceId } from "./types"

export type MaintenanceProposalType =
  | "revalidate_claim"
  | "stale_claim"
  | "mark_superseded"
  | "purge_orphan"
  | "request_evidence"
  | "reconcile_conflict"

export interface MaintenanceProposal {
  readonly id: string
  readonly type: MaintenanceProposalType
  readonly targetClaimId: ClaimId
  readonly reason: string
  readonly suggestedAction: string
  readonly severity: "low" | "medium" | "high" | "critical"
  readonly createdAtRevision: Revision
  readonly timestamp: string
}

export interface EpistemicAuditReport {
  readonly auditedRevision: Revision
  readonly totalClaimsAudited: number
  readonly activeValidClaims: number
  readonly unresolvedDirtyCount: number
  readonly orphanDependencyCount: number
  readonly weakProvenanceCount: number
  readonly brokenSupersessionCount: number
  readonly proposals: readonly MaintenanceProposal[]
  readonly timestamp: string
}

/**
 * Slow Epistemic Maintenance Engine (TrustMem arXiv:2606.25161).
 * Detects epistemic debt, stale dirty claims, orphan dependencies, weak provenance,
 * and broken supersessions, emitting non-authoritative proposals rather than silently mutating HardState.
 */
export class EpistemicMaintenanceEngine {
  /**
   * Performs an epistemic maintenance audit over the given HardState.
   */
  static audit(hardState: HardState, currentWorkspaceFiles?: readonly string[]): EpistemicAuditReport {
    const proposals: MaintenanceProposal[] = []
    let unresolvedDirtyCount = 0
    let orphanDependencyCount = 0
    let weakProvenanceCount = 0
    let brokenSupersessionCount = 0

    let proposalSeq = 1
    const createProposalId = () => `prop_maint_${Date.now()}_${proposalSeq++}`

    const existingFileSet = currentWorkspaceFiles ? new Set(currentWorkspaceFiles.map((f) => f.toLowerCase())) : null

    for (const [claimId, claim] of hardState.claims) {
      // 1. Detect unresolved DIRTY claims
      if (claim.status === "dirty") {
        unresolvedDirtyCount++
        const dirtyDurationRevisions = hardState.revision.value - claim.learnedAtRevision.value
        proposals.push({
          id: createProposalId(),
          type: "revalidate_claim",
          targetClaimId: claimId,
          reason: `Claim '${claimId}' has been in DIRTY state for ${dirtyDurationRevisions} revisions without updated evidence or supersession`,
          suggestedAction: `Perform probe or test verification on dependencies (${claim.dependencies.map((d) => d.type).join(", ")}) to revalidate or supersede`,
          severity: dirtyDurationRevisions > 10 ? "high" : "medium",
          createdAtRevision: hardState.revision,
          timestamp: new Date().toISOString(),
        })
      }

      // 2. Detect weak / missing provenance
      if ((claim.status === "supported" || claim.status === "verified") && claim.validityPolicy !== "HISTORICAL") {
        if (claim.supportingEvidence.length === 0) {
          weakProvenanceCount++
          proposals.push({
            id: createProposalId(),
            type: "request_evidence",
            targetClaimId: claimId,
            reason: `Claim '${claimId}' is marked '${claim.status}' but possesses 0 supporting evidence records`,
            suggestedAction: "Admit supporting observation/test evidence or demote to hypothetical",
            severity: claim.status === "verified" ? "critical" : "high",
            createdAtRevision: hardState.revision,
            timestamp: new Date().toISOString(),
          })
        } else {
          // Verify each evidenceId exists in hardState.evidence
          for (const evId of claim.supportingEvidence) {
            if (!hardState.evidence.has(evId)) {
              weakProvenanceCount++
              proposals.push({
                id: createProposalId(),
                type: "request_evidence",
                targetClaimId: claimId,
                reason: `Claim '${claimId}' references unknown/unadmitted evidenceId '${evId}'`,
                suggestedAction: `Admit evidence '${evId}' or re-evaluate claim backing`,
                severity: "high",
                createdAtRevision: hardState.revision,
                timestamp: new Date().toISOString(),
              })
            }
          }
        }
      }

      // 3. Detect orphan dependencies
      for (const dep of claim.dependencies) {
        if (dep.type === "claim") {
          if (!hardState.claims.has(dep.claimId)) {
            orphanDependencyCount++
            proposals.push({
              id: createProposalId(),
              type: "purge_orphan",
              targetClaimId: claimId,
              reason: `Claim '${claimId}' depends on non-existent claim '${dep.claimId}'`,
              suggestedAction: `Remove dependency edge or re-evaluate premise for '${claimId}'`,
              severity: "medium",
              createdAtRevision: hardState.revision,
              timestamp: new Date().toISOString(),
            })
          }
        } else if (dep.type === "file" && existingFileSet) {
          if (!existingFileSet.has(dep.path.toLowerCase())) {
            orphanDependencyCount++
            proposals.push({
              id: createProposalId(),
              type: "stale_claim",
              targetClaimId: claimId,
              reason: `Claim '${claimId}' depends on file '${dep.path}' which no longer exists in workspace`,
              suggestedAction: `Mark claim '${claimId}' as stale or dirty`,
              severity: "medium",
              createdAtRevision: hardState.revision,
              timestamp: new Date().toISOString(),
            })
          }
        }
      }

      // 4. Detect inconsistent supersession relationships
      if (claim.status === "superseded") {
        if (!claim.supersededBy) {
          brokenSupersessionCount++
          proposals.push({
            id: createProposalId(),
            type: "mark_superseded",
            targetClaimId: claimId,
            reason: `Claim '${claimId}' is marked superseded but has no supersededBy reference`,
            suggestedAction: "Link replacement claim ID in supersession lineage",
            severity: "low",
            createdAtRevision: hardState.revision,
            timestamp: new Date().toISOString(),
          })
        } else {
          // Check for cyclic supersession
          const replacement = hardState.claims.get(claim.supersededBy)
          if (replacement && replacement.supersededBy === claimId) {
            brokenSupersessionCount++
            proposals.push({
              id: createProposalId(),
              type: "mark_superseded",
              targetClaimId: claimId,
              reason: `Cyclic supersession detected between '${claimId}' and '${claim.supersededBy}'`,
              suggestedAction: "Break cycle and designate the single authoritative replacement claim",
              severity: "critical",
              createdAtRevision: hardState.revision,
              timestamp: new Date().toISOString(),
            })
          }
        }
      }
    }

    const activeValidClaims = Array.from(hardState.claims.values()).filter(
      (c) => (c.status === "supported" || c.status === "verified") && c.validityPolicy !== "HISTORICAL",
    ).length

    return {
      auditedRevision: hardState.revision,
      totalClaimsAudited: hardState.claims.size,
      activeValidClaims,
      unresolvedDirtyCount,
      orphanDependencyCount,
      weakProvenanceCount,
      brokenSupersessionCount,
      proposals,
      timestamp: new Date().toISOString(),
    }
  }
}

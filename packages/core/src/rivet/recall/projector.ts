import {
  type HardState,
  type NoesisEvent,
} from "../noesis"
import {
  type ClaimId,
  type EvidenceId,
  type ObligationId,
  type ReceiptId,
  type WorkspaceId,
  createWorkspaceId,
  Scope,
} from "../types"
import {
  type MemoryId,
  type MemoryKind,
  type RecallDocument,
  type RecallRelationship,
  createMemoryId,
} from "./types"

export interface StructuredEpisode {
  readonly problem: string
  readonly observations: readonly string[]
  readonly rejectedApproaches: readonly { readonly claimId: string; readonly reason: string; readonly proposition?: string }[]
  readonly decisions: readonly { readonly claimId: string; readonly proposition: string }[]
  readonly verifications: readonly { readonly obligationId: string; readonly receiptId: string }[]
  readonly relatedSymbols: readonly string[]
}

/**
 * NoesisRecallProjector deterministically projects canonical Noesis HardState
 * and durable NoesisEvent streams into structured RecallDocument records.
 */
export class NoesisRecallProjector {
  /**
   * Projects a complete HardState snapshot into typed RecallDocuments.
   */
  static projectFromHardState(
    hardState: HardState,
    workspaceId?: string,
  ): readonly RecallDocument[] {
    const docs: RecallDocument[] = []
    const wsId = createWorkspaceId(workspaceId ?? "default")

    // Collect all unique symbols referenced across claims for episode linking
    const allSymbolsSet = new Set<string>()
    for (const [, claim] of hardState.claims) {
      if (claim.dependencies) {
        for (const dep of claim.dependencies) {
          if (dep.type === "symbol") allSymbolsSet.add(dep.symbol)
        }
      }
    }
    const allSymbols = Array.from(allSymbolsSet)

    // Build structured episode components
    const observationsList: string[] = []
    for (const [, obs] of hardState.observations) {
      observationsList.push(obs.summary)
    }

    const rejectedList: { claimId: string; reason: string; proposition?: string }[] = []
    for (const [claimId, rej] of hardState.rejectedClaims) {
      const claim = hardState.claims.get(claimId)
      rejectedList.push({
        claimId: claimId as unknown as string,
        reason: rej.reason,
        proposition: claim?.proposition,
      })
    }

    const decisionsList: { claimId: string; proposition: string }[] = []
    for (const [claimId, claim] of hardState.claims) {
      if (claim.status === "verified" || claim.validityPolicy === "PROCEDURAL") {
        decisionsList.push({
          claimId: claimId as unknown as string,
          proposition: claim.proposition,
        })
      }
    }

    const verificationsList: { obligationId: string; receiptId: string }[] = []
    for (const [obId, receipt] of hardState.verificationReceipts) {
      verificationsList.push({
        obligationId: obId as unknown as string,
        receiptId: receipt.receiptId as unknown as string,
      })
    }

    // 1. Project Structured Session Episode (if goal is set)
    if (hardState.goalDescription) {
      const epHash = hashString(hardState.goalDescription).toString(36)
      const epRelationships: RecallRelationship[] = []

      // Link episode to decisions
      for (const dec of decisionsList) {
        epRelationships.push({
          targetId: dec.claimId as unknown as MemoryId,
          kind: "RESOLVED_BY",
        })
      }
      // Link episode to failures
      for (const rej of rejectedList) {
        epRelationships.push({
          targetId: rej.claimId as unknown as MemoryId,
          kind: "FAILED_BECAUSE",
        })
      }

      const structuredEpisode: StructuredEpisode = {
        problem: hardState.goalDescription,
        observations: observationsList,
        rejectedApproaches: rejectedList,
        decisions: decisionsList,
        verifications: verificationsList,
        relatedSymbols: allSymbols,
      }

      docs.push({
        id: createMemoryId(`ep_${wsId}_${epHash}`),
        kind: "episode",
        text: hardState.goalDescription,
        summary: `Prior Episode: ${hardState.goalDescription}`,
        workspaceId: wsId,
        scope: hardState.claims.values().next().value?.scope ?? Scope.global("repo", hardState.revision),
        sourceRefs: hardState.activeTaskId ? [hardState.activeTaskId as unknown as string] : [],
        relatedSymbols: allSymbols,
        epistemicStatus: "verified",
        validFromRevision: hardState.revision,
        observedAt: Date.now(),
        relationships: epRelationships,
        metadata: {
          structuredEpisode,
        },
      })
    }

    // 2. Project Verified / Active / Procedural Claims
    for (const [claimId, claim] of hardState.claims) {
      const symbols: string[] = []
      const rels: RecallRelationship[] = []

      if (claim.dependencies) {
        for (const dep of claim.dependencies) {
          if (dep.type === "symbol") symbols.push(dep.symbol)
          if (dep.type === "claim") {
            rels.push({
              targetId: dep.claimId as unknown as MemoryId,
              kind: "DEPENDS_ON",
            })
          }
        }
      }

      if (claim.supersededBy) {
        rels.push({
          targetId: claim.supersededBy as unknown as MemoryId,
          kind: "SUPERSEDES",
        })
      }

      const kind: MemoryKind = claim.validityPolicy === "PROCEDURAL" ? "procedure" : "claim"
      const summaryPrefix = claim.status === "verified" ? "[verified]" : `[${claim.status}]`

      docs.push({
        id: claimId as unknown as MemoryId,
        kind,
        text: claim.proposition,
        summary: `${summaryPrefix} ${claim.proposition}`,
        workspaceId: wsId,
        scope: claim.scope,
        sourceRefs: claim.supportingEvidence ? [...claim.supportingEvidence] : [],
        relatedSymbols: symbols,
        epistemicStatus: claim.status ?? "verified",
        validFromRevision: claim.validFromRevision,
        validToRevision: claim.validToRevision,
        observedAt: claim.learnedAtRevision ? Number(claim.learnedAtRevision.value) * 1000 : Date.now(),
        relationships: rels,
      })
    }

    // 3. Project Rejection Records (Failure Avoidance)
    for (const [claimId, rej] of hardState.rejectedClaims) {
      const origClaim = hardState.claims.get(claimId)
      const claimText = origClaim?.proposition ?? (claimId as unknown as string)
      docs.push({
        id: createMemoryId(`rej_${claimId}`),
        kind: "failure",
        text: `${claimText} — Rejected: ${rej.reason}`,
        summary: `Previous rejected approach: ${rej.reason}`,
        workspaceId: wsId,
        scope: origClaim?.scope ?? Scope.global("repo", hardState.revision),
        sourceRefs: rej.evidence ? [...rej.evidence] : [],
        relatedSymbols: origClaim?.dependencies
          ? origClaim.dependencies.filter((d) => d.type === "symbol").map((d: any) => d.symbol)
          : [],
        epistemicStatus: "rejected",
        validFromRevision: hardState.revision,
        observedAt: Date.now(),
        relationships: [{ targetId: claimId as unknown as MemoryId, kind: "CONTRADICTS" }],
        metadata: {
          originalClaimId: claimId,
          rejectionReason: rej.reason,
        },
      })
    }

    // 4. Project Process Error Attributions
    for (const attr of hardState.processErrorAttributions) {
      docs.push({
        id: attr.attributionId as unknown as MemoryId,
        kind: "failure",
        text: `${attr.category}: ${attr.diagnostic}`,
        summary: `Failure attribution [${attr.category}]: ${attr.diagnostic}`,
        workspaceId: wsId,
        scope: Scope.global("repo", hardState.revision),
        sourceRefs: [attr.attributionId as unknown as string],
        relatedSymbols: [],
        epistemicStatus: "rejected",
        validFromRevision: hardState.revision,
        observedAt: Date.now(),
      })
    }

    // 5. Project Verification Receipts (Historical procedures)
    for (const [obId, receipt] of hardState.verificationReceipts) {
      docs.push({
        id: receipt.receiptId as unknown as MemoryId,
        kind: "procedure",
        text: `Verified obligation ${obId} with receipt ${receipt.receiptId}`,
        summary: `Historical verification receipt ${receipt.receiptId} for obligation ${obId}`,
        workspaceId: wsId,
        scope: receipt.verifiedScope ?? Scope.global("repo", hardState.revision),
        sourceRefs: [receipt.receiptId as unknown as string],
        relatedSymbols: [],
        epistemicStatus: "verified",
        validFromRevision: hardState.revision,
        observedAt: Date.now(),
        relationships: [{ targetId: obId as unknown as MemoryId, kind: "TESTED_BY" }],
      })
    }

    return docs
  }

  /**
   * Deterministically projects a sequence of NoesisEvents into RecallDocuments by replaying into HardState.
   */
  static projectFromEvents(
    events: readonly NoesisEvent[],
    workspaceId?: string,
  ): readonly RecallDocument[] {
    const { HardState } = require("../noesis")
    const state = new HardState()
    for (const ev of events) {
      state.apply(ev)
    }
    return this.projectFromHardState(state, workspaceId)
  }
}

function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return hash >>> 0
}

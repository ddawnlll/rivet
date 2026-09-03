import {
  type ClaimRecord,
  HardState,
  type NoesisEvent,
} from "../noesis"
import {
  Revision,
  Scope,
  createWorkspaceId,
} from "../types"
import {
  createMemoryId,
  type MemoryId,
  type RecallDocument,
  type RecallRelationship,
} from "./types"

/**
 * NoesisRecallProjector projects canonical Noesis HardState and NoesisEvent streams
 * into typed RecallDocuments with graph relationships and bi-temporal metadata.
 */
export class NoesisRecallProjector {
  /**
   * Projects a complete HardState snapshot into an array of RecallDocuments.
   */
  static projectFromHardState(hardState: HardState, workspaceId?: string): readonly RecallDocument[] {
    const docs: RecallDocument[] = []
    const wsId = createWorkspaceId(workspaceId ?? hardState.revision.toString())

    const allSymbols = new Set<string>()
    for (const claim of hardState.claims.values()) {
      for (const dep of claim.dependencies) {
        if (dep.type === "symbol") allSymbols.add(dep.symbol)
      }
    }

    // 1. Project Goal & Current Episode
    if (hardState.goalDescription) {
      const epHash = hashString(hardState.goalDescription)
      docs.push({
        id: createMemoryId(`ep_${wsId}_${epHash}`),
        kind: "episode",
        text: hardState.goalDescription,
        summary: `Episode at ${hardState.revision.toString()}: ${hardState.goalDescription}`,
        workspaceId: wsId,
        scope: Scope.global("repo", hardState.revision),
        sourceRefs: [],
        relatedSymbols: Array.from(allSymbols),
        epistemicStatus: "verified",
        validFromRevision: hardState.revision,
        observedAt: Date.now(),
      })
    }

    // 2. Project Claims
    for (const [claimId, claim] of hardState.claims) {
      const relationships: RecallRelationship[] = []
      const relatedSymbols: string[] = []

      for (const dep of claim.dependencies) {
        if (dep.type === "claim") {
          relationships.push({ targetId: dep.claimId as unknown as MemoryId, kind: "DEPENDS_ON" })
        } else if (dep.type === "symbol") {
          relatedSymbols.push(dep.symbol)
        } else if (dep.type === "file") {
          relationships.push({ targetId: createMemoryId(dep.path), kind: "TOUCHED" })
        }
      }

      if (claim.supersededBy) {
        relationships.push({ targetId: claim.supersededBy as unknown as MemoryId, kind: "SUPERSEDES" })
      }

      docs.push({
        id: claimId as unknown as MemoryId,
        kind: "claim",
        text: claim.proposition,
        summary: `[${claim.status}] ${claim.proposition}`,
        workspaceId: wsId,
        scope: claim.scope,
        sourceRefs: claim.supportingEvidence as unknown as string[],
        relatedSymbols,
        epistemicStatus: claim.status,
        validFromRevision: claim.validFromRevision,
        validToRevision: claim.validToRevision,
        observedAt: Date.now(),
        relationships,
      })
    }

    // 3. Project Rejected Claims & Failures (Failure Avoidance)
    for (const [claimId, recordOrReason] of hardState.rejectedClaims) {
      const reason =
        typeof recordOrReason === "string"
          ? recordOrReason
          : typeof recordOrReason === "object" && recordOrReason !== null && "reason" in recordOrReason
          ? String((recordOrReason as { reason: unknown }).reason)
          : String(recordOrReason)

      docs.push({
        id: createMemoryId(`fail_${wsId}_${claimId}`),
        kind: "failure",
        text: `Rejected approach: ${reason}`,
        summary: `Previous rejected approach (${claimId}): ${reason}`,
        workspaceId: wsId,
        scope: Scope.global("repo", hardState.revision),
        sourceRefs: [claimId],
        relatedSymbols: [],
        epistemicStatus: "rejected",
        validFromRevision: hardState.revision,
        observedAt: Date.now(),
        relationships: [{ targetId: claimId as unknown as MemoryId, kind: "CONTRADICTS" }],
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

    // 5. Project Evidence & Verifications
    for (const [evId, summary] of hardState.evidence) {
      const isVerification =
        typeof summary === "string" &&
        (summary.toLowerCase().includes("verification") ||
          summary.toLowerCase().includes("passed") ||
          summary.toLowerCase().includes("praxis"))
      docs.push({
        id: evId as unknown as MemoryId,
        kind: isVerification ? "procedure" : "decision",
        text: typeof summary === "string" ? summary : JSON.stringify(summary),
        summary: typeof summary === "string" ? summary : JSON.stringify(summary),
        workspaceId: wsId,
        scope: Scope.global("repo", hardState.revision),
        sourceRefs: [evId],
        relatedSymbols: [],
        epistemicStatus: "verified",
        validFromRevision: hardState.revision,
        observedAt: Date.now(),
      })
    }

    return docs
  }

  /**
   * Replays an array of NoesisEvents into a HardState and projects into RecallDocuments.
   */
  static projectFromEvents(events: readonly NoesisEvent[], workspaceId?: string): readonly RecallDocument[] {
    const state = HardState.replay(events)
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


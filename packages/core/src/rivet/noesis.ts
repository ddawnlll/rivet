import {
  type ClaimId,
  type EpistemicStatus,
  type EvidenceId,
  type ObligationId,
  type ReceiptId,
  Revision,
  type Scope,
  type SessionId,
  type TaskId,
  type WorkspaceId,
  createWorkspaceId,
} from "./types"
import type { ExecutionReceipt, VerificationReceipt } from "./accp"

export interface ClaimRecord {
  readonly id: ClaimId
  readonly proposition: string
  status: EpistemicStatus
  readonly supportingEvidence: readonly EvidenceId[]
  readonly dependsOn: readonly ClaimId[]
  readonly scope: Scope
  readonly createdAt: string
  updatedAt: string
}

export interface ContradictionRecord {
  readonly claimId: ClaimId
  readonly contradictedBy: readonly EvidenceId[]
  readonly reason: string
  readonly scope: Scope
  readonly createdAt: string
}

export interface RejectionRecord {
  readonly claimId: ClaimId
  readonly reason: string
  readonly evidence: readonly EvidenceId[]
  readonly timestamp: string
}

export interface ProcessErrorAttributionRecord {
  readonly attributionId: ReceiptId
  readonly category: string
  readonly diagnostic: string
  readonly suggestedPolicyRepair?: string | null
  readonly timestamp: string
}

export type InvocationReason =
  | "GOAL_AMBIGUITY"
  | "SEMANTIC_DIAGNOSIS"
  | "HYPOTHESIS_CONFLICT"
  | "NOVEL_ARCHITECTURE"
  | "CAPABILITY_DISCOVERY_FALLBACK"
  | "UNEXPECTED_RESULT"
  | "STATE_CONTRADICTION"
  | "LONG_HORIZON_REFRAME"
  | "REVIEW_SEMANTICS"

export interface ModelInvocationRecord {
  readonly invocationId: ReceiptId
  readonly modelId: string
  readonly reason: InvocationReason
  readonly inputTokens: number
  readonly outputTokens: number
  readonly latencyMs: number
  readonly timestamp: string
}

export type NoesisEvent =
  | {
      readonly type: "claim_asserted"
      readonly claimId: ClaimId
      readonly proposition: string
      readonly status: EpistemicStatus
      readonly evidence: readonly EvidenceId[]
      readonly dependsOn?: readonly ClaimId[]
      readonly scope: Scope
      readonly timestamp: string
    }
  | {
      readonly type: "claim_status_changed"
      readonly claimId: ClaimId
      readonly newStatus: EpistemicStatus
      readonly reason: string
      readonly timestamp: string
    }
  | {
      readonly type: "evidence_recorded"
      readonly evidenceId: EvidenceId
      readonly source: string
      readonly summary: string
      readonly timestamp: string
    }
  | {
      readonly type: "execution_recorded"
      readonly receipt: ExecutionReceipt
      readonly timestamp: string
    }
  | {
      readonly type: "obligation_created"
      readonly obligationId: ObligationId
      readonly description: string
      readonly scope: Scope
      readonly timestamp: string
    }
  | {
      readonly type: "obligation_closed"
      readonly obligationId: ObligationId
      readonly receiptId: ReceiptId
      readonly timestamp: string
    }
  | {
      readonly type: "verification_recorded"
      readonly receipt: VerificationReceipt
      readonly timestamp: string
    }
  | {
      readonly type: "obligation_reopened"
      readonly obligationId: ObligationId
      readonly reason: string
      readonly timestamp: string
    }
  | {
      readonly type: "claim_contradicted"
      readonly claimId: ClaimId
      readonly contradictedBy: readonly EvidenceId[]
      readonly reason: string
      readonly scope: Scope
      readonly timestamp: string
    }
  | {
      readonly type: "claim_rejected"
      readonly claimId: ClaimId
      readonly reason: string
      readonly evidence: readonly EvidenceId[]
      readonly timestamp: string
    }
  | {
      readonly type: "process_error_attributed"
      readonly record: ProcessErrorAttributionRecord
    }
  | {
      readonly type: "model_invocation_recorded"
      readonly record: ModelInvocationRecord
    }
  | {
      readonly type: "completion_accepted"
      readonly taskId: TaskId
      readonly finalReceipt: ReceiptId
      readonly timestamp: string
    }

export class HardState {
  revision: Revision = Revision.ZERO
  activeTaskId: TaskId | null = null
  readonly claims: Map<ClaimId, ClaimRecord> = new Map()
  readonly contradictions: Map<ClaimId, ContradictionRecord> = new Map()
  readonly rejectedClaims: Map<ClaimId, RejectionRecord> = new Map()
  readonly obligations: Map<ObligationId, string> = new Map()
  readonly obligationScopes: Map<ObligationId, Scope> = new Map()
  readonly closedObligations: Map<ObligationId, ReceiptId> = new Map()
  readonly evidence: Map<EvidenceId, string> = new Map()
  readonly executionReceipts: ExecutionReceipt[] = []
  readonly verificationReceipts: Map<ObligationId, VerificationReceipt> = new Map()
  readonly modelInvocations: ModelInvocationRecord[] = []
  readonly processErrorAttributions: ProcessErrorAttributionRecord[] = []
  readonly completedTasks: Map<TaskId, ReceiptId> = new Map()

  apply(event: NoesisEvent): void {
    this.revision = this.revision.next()

    switch (event.type) {
      case "claim_asserted": {
        this.claims.set(event.claimId, {
          id: event.claimId,
          proposition: event.proposition,
          status: event.status,
          supportingEvidence: [...event.evidence],
          dependsOn: event.dependsOn ? [...event.dependsOn] : [],
          scope: event.scope,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        })
        break
      }
      case "claim_status_changed": {
        const record = this.claims.get(event.claimId)
        if (record) {
          record.status = event.newStatus
          record.updatedAt = event.timestamp
        }
        break
      }
      case "claim_contradicted": {
        const record = this.claims.get(event.claimId)
        if (record) {
          record.status = "rejected"
          record.updatedAt = event.timestamp
        }
        this.contradictions.set(event.claimId, {
          claimId: event.claimId,
          contradictedBy: [...event.contradictedBy],
          reason: event.reason,
          scope: event.scope,
          createdAt: event.timestamp,
        })
        this.cascadeClaimInvalidation(event.claimId, event.reason)
        break
      }
      case "claim_rejected": {
        const record = this.claims.get(event.claimId)
        if (record) {
          record.status = "rejected"
          record.updatedAt = event.timestamp
        }
        this.rejectedClaims.set(event.claimId, {
          claimId: event.claimId,
          reason: event.reason,
          evidence: [...event.evidence],
          timestamp: event.timestamp,
        })
        this.cascadeClaimInvalidation(event.claimId, event.reason)
        break
      }
      case "evidence_recorded": {
        this.evidence.set(event.evidenceId, event.summary)
        break
      }
      case "execution_recorded": {
        this.executionReceipts.push(event.receipt)
        break
      }
      case "obligation_created": {
        this.obligations.set(event.obligationId, event.description)
        this.obligationScopes.set(event.obligationId, event.scope)
        break
      }
      case "obligation_closed": {
        this.obligations.delete(event.obligationId)
        this.closedObligations.set(event.obligationId, event.receiptId)
        break
      }
      case "verification_recorded": {
        this.verificationReceipts.set(event.receipt.obligationId, event.receipt)
        if (!event.receipt.passed) {
          this.completedTasks.clear()
          const prev = this.closedObligations.get(event.receipt.obligationId)
          if (prev) {
            this.closedObligations.delete(event.receipt.obligationId)
            this.obligations.set(
              event.receipt.obligationId,
              `Reopened after failed verification receipt ${event.receipt.receiptId} (previously closed by ${prev})`
            )
          }
        }
        break
      }
      case "obligation_reopened": {
        this.closedObligations.delete(event.obligationId)
        this.obligations.set(event.obligationId, event.reason)
        this.completedTasks.clear()
        break
      }
      case "process_error_attributed": {
        this.processErrorAttributions.push(event.record)
        break
      }
      case "model_invocation_recorded": {
        this.modelInvocations.push(event.record)
        break
      }
      case "completion_accepted": {
        this.completedTasks.set(event.taskId, event.finalReceipt)
        break
      }
    }
  }

  cascadeClaimInvalidation(sourceClaimId: ClaimId, reason: string): void {
    const toInvalidate: ClaimId[] = []
    for (const [id, record] of this.claims) {
      if (record.dependsOn.includes(sourceClaimId) && record.status !== "rejected") {
        toInvalidate.push(id)
      }
    }

    for (const depId of toInvalidate) {
      const depRecord = this.claims.get(depId)
      if (depRecord) {
        depRecord.status = "rejected"
        depRecord.updatedAt = new Date().toISOString()
      }
      this.rejectedClaims.set(depId, {
        claimId: depId,
        reason: `Dependency claim '${sourceClaimId}' was invalidated: ${reason}`,
        evidence: [],
        timestamp: new Date().toISOString(),
      })
      this.cascadeClaimInvalidation(depId, reason)
    }
  }

  canPromoteToSupported(evidenceIds: readonly EvidenceId[]): boolean {
    if (evidenceIds.length === 0) return false
    return evidenceIds.every((id) => this.evidence.has(id))
  }

  openObligationIds(): ObligationId[] {
    return Array.from(this.obligations.keys()).sort()
  }

  passingVerificationReceipts(): ReceiptId[] {
    const receipts: ReceiptId[] = []
    for (const receipt of this.verificationReceipts.values()) {
      if (receipt.passed) {
        receipts.push(receipt.receiptId)
      }
    }
    return receipts.sort()
  }

  static replay(events: readonly NoesisEvent[]): HardState {
    const state = new HardState()
    for (const event of events) {
      state.apply(event)
    }
    return state
  }
}

export class SoftWorkspace {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  baseHardRevision: Revision
  activeFocus: string[] = []
  hypotheses: string[] = []
  unknowns: string[] = []
  candidateActions: string[] = []
  maxCapacityItems = 32

  constructor(sessionId: SessionId, baseRevision: Revision) {
    this.workspaceId = createWorkspaceId()
    this.sessionId = sessionId
    this.baseHardRevision = baseRevision
  }

  addHypothesis(hypothesis: string): void {
    this.hypotheses.push(hypothesis)
    this.trimToCapacity()
  }

  addUnknown(unknown: string): void {
    this.unknowns.push(unknown)
    this.trimToCapacity()
  }

  addCandidateAction(action: string): void {
    this.candidateActions.push(action)
    this.trimToCapacity()
  }

  setFocus(focus: string[]): void {
    this.activeFocus = [...focus]
    this.trimToCapacity()
  }

  itemCount(): number {
    return (
      this.activeFocus.length +
      this.hypotheses.length +
      this.unknowns.length +
      this.candidateActions.length
    )
  }

  private trimToCapacity(): void {
    while (this.itemCount() > this.maxCapacityItems) {
      if (this.hypotheses.length > 0) {
        this.hypotheses.shift()
      } else if (this.unknowns.length > 0) {
        this.unknowns.shift()
      } else if (this.candidateActions.length > 0) {
        this.candidateActions.shift()
      } else if (this.activeFocus.length > 0) {
        this.activeFocus.shift()
      } else {
        break
      }
    }
  }
}

export interface CognitiveViewInit {
  hardRevision: Revision
  repositoryId?: string
  goalDescription: string
  activeClaims?: ClaimRecord[]
  contradictions?: string[]
  rejectedClaims?: string[]
  openObligations?: string[]
  recentEvidence?: string[]
  repositorySignals?: string[]
  unknowns?: string[]
  activeHypotheses?: string[]
  activeFocus?: string[]
  relevantFiles?: string[]
  tokenBudgetHint?: number
  modelInvocationCount?: number
}

export class CognitiveView {
  readonly hardRevision: Revision
  readonly repositoryId: string
  readonly goalDescription: string
  readonly activeClaims: readonly ClaimRecord[]
  readonly contradictions: readonly string[]
  readonly rejectedClaims: readonly string[]
  readonly openObligations: readonly string[]
  readonly recentEvidence: readonly string[]
  readonly repositorySignals: readonly string[]
  readonly unknowns: readonly string[]
  readonly activeHypotheses: readonly string[]
  readonly activeFocus: readonly string[]
  readonly relevantFiles: readonly string[]
  readonly tokenBudgetHint: number
  readonly modelInvocationCount: number

  constructor(init: CognitiveViewInit) {
    this.hardRevision = init.hardRevision
    this.repositoryId = init.repositoryId ?? "rivet"
    this.goalDescription = init.goalDescription
    this.activeClaims = init.activeClaims ?? []
    this.contradictions = init.contradictions ?? []
    this.rejectedClaims = init.rejectedClaims ?? []
    this.openObligations = init.openObligations ?? []
    this.recentEvidence = init.recentEvidence ?? []
    this.repositorySignals = init.repositorySignals ?? []
    this.unknowns = init.unknowns ?? []
    this.activeHypotheses = init.activeHypotheses ?? []
    this.activeFocus = init.activeFocus ?? []
    this.relevantFiles = init.relevantFiles ?? []
    this.tokenBudgetHint = init.tokenBudgetHint ?? 4096
    this.modelInvocationCount = init.modelInvocationCount ?? 0
  }

  formatPromptBlock(): string {
    const lines: string[] = []
    lines.push(`### CURRENT GOAL (Revision: ${this.hardRevision})`)
    lines.push(`Repository: ${this.repositoryId}`)
    lines.push(`${this.goalDescription}\n`)

    if (this.activeClaims.length > 0) {
      lines.push("### AUTHORITATIVE HARD CLAIMS:")
      for (const c of this.activeClaims) {
        lines.push(`- [${c.status}] ${c.id}: ${c.proposition}`)
      }
      lines.push("")
    }

    if (this.contradictions.length > 0) {
      lines.push("### DETECTED CONTRADICTIONS (Must resolve before completion):")
      for (const c of this.contradictions) {
        lines.push(`- [!] ${c}`)
      }
      lines.push("")
    }

    if (this.rejectedClaims.length > 0) {
      lines.push("### REJECTED / FALSIFIED CLAIMS (Do not re-explore):")
      for (const r of this.rejectedClaims) {
        lines.push(`- [x] ${r}`)
      }
      lines.push("")
    }

    if (this.activeHypotheses.length > 0) {
      lines.push("### ACTIVE WORKING HYPOTHESES (Soft Workspace):")
      for (const h of this.activeHypotheses) {
        lines.push(`- ${h}`)
      }
      lines.push("")
    }

    if (this.openObligations.length > 0) {
      lines.push("### OPEN OBLIGATIONS TO VERIFY (Use internal ID only when proposing verification):")
      for (const o of this.openObligations) {
        lines.push(`- [ ] ${o}`)
      }
      lines.push("")
    }

    if (this.recentEvidence.length > 0) {
      lines.push("### RECENT AUTHORITATIVE EVIDENCE:")
      for (const e of this.recentEvidence) {
        lines.push(`- ${e}`)
      }
      lines.push("")
    }

    if (this.unknowns.length > 0) {
      lines.push("### UNRESOLVED UNKNOWNS (not facts):")
      for (const u of this.unknowns) {
        lines.push(`- ${u}`)
      }
      lines.push("")
    }

    if (this.activeFocus.length > 0) {
      lines.push("### ACTIVE FOCUS:")
      for (const f of this.activeFocus) {
        lines.push(`- ${f}`)
      }
      lines.push("")
    }

    if (this.relevantFiles.length > 0) {
      lines.push("### RELEVANT ARTIFACT FRONTIER:")
      for (const p of this.relevantFiles) {
        lines.push(`- ${p}`)
      }
      lines.push("")
    }

    if (this.repositorySignals.length > 0) {
      lines.push("### REPOSITORY CENSUS SIGNALS (not semantic decisions):")
      for (const s of this.repositorySignals) {
        lines.push(`- ${s}`)
      }
      lines.push("")
    }

    lines.push(`### INVOCATION ACCOUNTING: ${this.modelInvocationCount} prior model calls`)

    let out = lines.join("\n")
    const marker = "\n[view truncated]"
    const maxBytes = Math.max(this.tokenBudgetHint * 4, marker.length)
    if (out.length > maxBytes) {
      out = out.slice(0, maxBytes - marker.length) + marker
    }
    return out
  }
}

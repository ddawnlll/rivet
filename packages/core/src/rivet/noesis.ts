import {
  type ClaimId,
  type ActionId,
  type CompletionReadiness,
  type DependencyRef,
  type EpistemicStatus,
  type EvidenceId,
  type ExecutionFocus,
  type FocusId,
  type InvocationId,
  type MemoryFrontier,
  type MemoryRef,
  type ObligationId,
  type ObligationKind,
  type ObligationViewRecord,
  type PremiseConflict,
  type Provenance,
  type ReceiptId,
  type RecoveryFrame,
  type RecoveryId,
  type RecoveryVerificationReceipt,
  Revision,
  RivetError,
  type Scope,
  type SessionId,
  type TaskId,
  type TaskAuthority,
  type TrajectoryFold,
  type ValidityPolicy,
  type WorkspaceId,
  createWorkspaceId,
} from "./types"
import type { ExecutionReceipt, InquiryReceipt, VerificationReceipt } from "./accp"
import type { ObligationPredicate } from "./goal-compiler"
import { ValidityGraph } from "./validity"
import { RepositoryFrontierCompiler, type RepositoryFrontier } from "./repository/repository-frontier"

export interface ClaimRecord {
  readonly id: ClaimId
  readonly proposition: string
  status: EpistemicStatus
  readonly supportingEvidence: readonly EvidenceId[]
  readonly dependsOn: readonly ClaimId[]
  readonly dependencies: readonly DependencyRef[]
  readonly scope: Scope
  readonly validFromRevision: Revision
  validToRevision?: Revision
  readonly learnedAtRevision: Revision
  readonly validityPolicy: ValidityPolicy
  lastValidatedAt?: Revision
  supersededBy?: ClaimId
  readonly provenance?: Provenance
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
  readonly invocationId: InvocationId
  readonly focusId: FocusId | null
  readonly modelId: string
  readonly reason: InvocationReason
  readonly inputTokens: number
  readonly outputTokens: number
  readonly latencyMs: number
  readonly timestamp: string
}

/** Mechanical output observed after an authorized action; not evidence or verification. */
export interface Observation {
  readonly observationId: string
  readonly actionId: ActionId
  readonly scope: Scope
  readonly summary: string
  readonly timestamp: string
}

export type NoesisEvent =
  | {
      readonly type: "goal_set"
      readonly goal: string
      readonly goalId?: TaskId
      readonly taskAuthority?: TaskAuthority
      readonly timestamp: string
    }
  | {
      readonly type: "claim_asserted"
      readonly claimId: ClaimId
      readonly proposition: string
      readonly status: EpistemicStatus
      readonly evidence: readonly EvidenceId[]
      readonly dependsOn?: readonly ClaimId[]
      readonly dependencies?: readonly DependencyRef[]
      readonly scope: Scope
      readonly validFromRevision?: Revision
      readonly validityPolicy?: ValidityPolicy
      readonly provenance?: Provenance
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
      readonly type: "claim_dirtied"
      readonly claimId: ClaimId
      readonly reason: string
      readonly timestamp: string
    }
  | {
      readonly type: "claim_revalidated"
      readonly claimId: ClaimId
      readonly status: EpistemicStatus
      readonly evidence?: readonly EvidenceId[]
      readonly timestamp: string
    }
  | {
      readonly type: "claim_staled"
      readonly claimId: ClaimId
      readonly reason: string
      readonly timestamp: string
    }
  | {
      readonly type: "claim_superseded"
      readonly claimId: ClaimId
      readonly supersededBy: ClaimId
      readonly reason: string
      readonly timestamp: string
    }
  | {
      readonly type: "claim_invalidated"
      readonly claimId: ClaimId
      readonly reason: string
      readonly timestamp: string
    }
  | {
      readonly type: "validity_dependency_registered"
      readonly claimId: ClaimId
      readonly dependencies: readonly DependencyRef[]
      readonly timestamp: string
    }
  | {
      readonly type: "premise_conflict_detected"
      readonly conflict: PremiseConflict
      readonly timestamp: string
    }
  | {
      readonly type: "evidence_recorded"
      readonly evidenceId: EvidenceId
      readonly source: string
      readonly summary: string
      readonly executionReceiptId?: ReceiptId
      readonly timestamp: string
    }
  | {
      readonly type: "execution_recorded"
      readonly receipt: ExecutionReceipt
      readonly timestamp: string
    }
  | {
      readonly type: "execution_claimed"
      readonly actionId: ActionId
      readonly idempotencyKey: string
      readonly actionFingerprint: string
      readonly scope: Scope
      readonly timestamp: string
    }
  | {
      readonly type: "observation_recorded"
      readonly observation: Observation
    }
  | {
      readonly type: "obligation_created"
      readonly obligationId: ObligationId
      readonly taskId?: TaskId
      readonly description: string
      readonly scope: Scope
      readonly kind?: ObligationKind
      readonly predicate?: ObligationPredicate
      readonly dependencies?: readonly ObligationId[]
      readonly timestamp: string
    }
  | {
      readonly type: "obligation_closed"
      readonly obligationId: ObligationId
      readonly receiptId: ReceiptId
      readonly timestamp: string
    }
  | {
      readonly type: "inquiry_satisfied"
      readonly obligationId: ObligationId
      readonly receiptId: ReceiptId
      readonly satisfiedAtRevision: Revision
      readonly summary: string
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
      readonly type: "obligation_invalidated"
      readonly obligationId: ObligationId
      readonly reason: string
      readonly timestamp: string
    }
  | {
      readonly type: "task_archived"
      readonly taskId: TaskId
      readonly reason: string
      readonly timestamp: string
    }
  | {
      readonly type: "focus_set"
      readonly focus: ExecutionFocus
      readonly timestamp: string
    }
  | {
      readonly type: "focus_archived"
      readonly focusId: FocusId
      readonly reason: string
      readonly timestamp: string
    }
  | {
      readonly type: "recovery_opened"
      readonly frame: RecoveryFrame
      readonly focus: ExecutionFocus
      readonly timestamp: string
    }
  | {
      readonly type: "recovery_verified"
      readonly recoveryId: RecoveryId
      readonly receiptId: ReceiptId
      readonly timestamp: string
    }
  | {
      readonly type: "recovery_verification_recorded"
      readonly receipt: RecoveryVerificationReceipt
      readonly timestamp: string
    }
  | {
      readonly type: "recovery_closed"
      readonly recoveryId: RecoveryId
      readonly resumeFocus: ExecutionFocus
      readonly timestamp: string
    }
  | {
      readonly type: "focus_folded"
      readonly fold: TrajectoryFold
      readonly timestamp: string
    }
  | {
      readonly type: "strategy_redirected"
      readonly focusId: FocusId
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
      readonly type: "claim_promoted"
      readonly claimId: ClaimId
      readonly status: EpistemicStatus
      readonly evidenceId: EvidenceId
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
  | {
      readonly type: "completion_rejected"
      readonly taskId: TaskId
      readonly blockers: readonly string[]
      readonly avoidable: boolean
      readonly timestamp: string
    }

export interface ArchitectureEpoch {
  readonly id: string
  readonly name: string
  readonly startRevision: Revision
  readonly endRevision?: Revision
  readonly primaryLanguage?: string
  readonly description?: string
}

// Telemetry events are recorded for observability but carry no epistemic
// mutation, so replaying them must not advance the canonical revision.
const RUNTIME_TELEMETRY_EVENT_TYPES: ReadonlySet<string> = new Set(["model_invocation_recorded", "execution_claimed"])

function isRuntimeTelemetryEvent(event: NoesisEvent): boolean {
  return RUNTIME_TELEMETRY_EVENT_TYPES.has(event.type)
}

export class HardState {
  revision: Revision = Revision.ZERO
  goalDescription: string | null = null
  /** Revision at which the currently active goal was admitted. */
  activeGoalRevision: Revision | null = null
  activeTaskId: TaskId | null = null
  /** Durable authority for the currently active user goal. */
  activeTaskAuthority: TaskAuthority | null = null
  readonly claims: Map<ClaimId, ClaimRecord> = new Map()
  readonly contradictions: Map<ClaimId, ContradictionRecord> = new Map()
  readonly rejectedClaims: Map<ClaimId, RejectionRecord> = new Map()
  readonly obligations: Map<ObligationId, string> = new Map()
  readonly obligationDescriptions: Map<ObligationId, string> = new Map()
  readonly obligationTaskIds: Map<ObligationId, TaskId> = new Map()
  readonly obligationDependencies: Map<ObligationId, readonly ObligationId[]> = new Map()
  readonly obligationScopes: Map<ObligationId, Scope> = new Map()
  readonly obligationKinds: Map<ObligationId, ObligationKind> = new Map()
  readonly obligationPredicates: Map<ObligationId, ObligationPredicate> = new Map()
  readonly closedObligations: Map<ObligationId, ReceiptId> = new Map()
  readonly invalidatedObligations: Map<ObligationId, string> = new Map()
  readonly suspendedObligations: Map<ObligationId, string> = new Map()
  readonly archivedTasks: Map<TaskId, string> = new Map()
  readonly focuses: Map<FocusId, ExecutionFocus> = new Map()
  readonly archivedFocuses: Map<FocusId, string> = new Map()
  readonly recoveryFrames: Map<RecoveryId, RecoveryFrame> = new Map()
  readonly recoveryVerificationReceipts: Map<RecoveryId, RecoveryVerificationReceipt> = new Map()
  readonly recoveryStack: RecoveryId[] = []
  readonly trajectoryFolds: TrajectoryFold[] = []
  readonly strategyRedirects: { readonly focusId: FocusId; readonly reason: string; readonly timestamp: string }[] = []
  readonly focusEffort: Map<FocusId, number> = new Map()
  executionFocus: ExecutionFocus | null = null
  controlProgressVersion = 0
  readonly inquiryReceipts: Map<ObligationId, InquiryReceipt> = new Map()
  readonly evidence: Map<EvidenceId, string> = new Map()
  readonly evidenceSources: Map<EvidenceId, string> = new Map()
  readonly evidenceExecutionReceipts: Map<EvidenceId, ReceiptId> = new Map()
  readonly executionReceipts: ExecutionReceipt[] = []
  readonly executionClaims: Map<
    string,
    {
      readonly actionId: ActionId
      readonly actionFingerprint: string
      readonly scope: Scope
    }
  > = new Map()
  readonly observations: Map<string, Observation> = new Map()
  readonly verificationReceipts: Map<ObligationId, VerificationReceipt> = new Map()
  readonly verificationHistory: VerificationReceipt[] = []
  readonly modelInvocations: ModelInvocationRecord[] = []
  readonly processErrorAttributions: ProcessErrorAttributionRecord[] = []
  readonly completedTasks: Map<TaskId, ReceiptId> = new Map()
  readonly validityGraph: ValidityGraph = new ValidityGraph()
  readonly premiseConflicts: PremiseConflict[] = []
  readonly epochs: Map<string, ArchitectureEpoch> = new Map()
  currentEpochId?: string
  completionAttempts: number = 0
  gateRejectionCount: number = 0
  avoidableGateRejectionCount: number = 0
  verificationRetries: number = 0
  toolCallsAfterRejection: number = 0
  firstAttemptAccepted: boolean | null = null

  getGateMetrics() {
    return {
      completionAttempts: this.completionAttempts,
      gateRejectionCount: this.gateRejectionCount,
      avoidableGateRejectionCount: this.avoidableGateRejectionCount,
      verificationRetries: this.verificationRetries,
      toolCallsAfterRejection: this.toolCallsAfterRejection,
      firstAttemptAccepted: this.firstAttemptAccepted,
      firstAttemptAcceptanceRate:
        this.completionAttempts > 0 ? (this.firstAttemptAccepted ? 1 : 0) / (this.completedTasks.size || 1) : 0,
    }
  }

  recordEpoch(epoch: ArchitectureEpoch): void {
    this.epochs.set(epoch.id, epoch)
    if (!epoch.endRevision || epoch.endRevision.value >= this.revision.value) {
      this.currentEpochId = epoch.id
    }
  }

  getEpochForRevision(rev: Revision): ArchitectureEpoch | undefined {
    for (const epoch of this.epochs.values()) {
      if (rev.value >= epoch.startRevision.value) {
        if (!epoch.endRevision || rev.value <= epoch.endRevision.value) {
          return epoch
        }
      }
    }
    return undefined
  }

  getActiveEpoch(): ArchitectureEpoch | undefined {
    if (this.currentEpochId) {
      return this.epochs.get(this.currentEpochId)
    }
    return this.getEpochForRevision(this.revision)
  }

  apply(event: NoesisEvent): void {
    // Runtime telemetry (model invocations, timings) is part of the event ledger
    // but not an epistemic world mutation: read-only turns must not advance the
    // canonical revision, otherwise validity windows and stale-base checks
    // degrade into event-sequence noise.
    if (!isRuntimeTelemetryEvent(event)) this.revision = this.revision.next()

    switch (event.type) {
      case "goal_set": {
        this.goalDescription = (event as any).goal ?? (event as any).description ?? null
        this.activeGoalRevision = this.revision
        if ((event as any).goalId) this.activeTaskId = (event as any).goalId
        this.activeTaskAuthority = (event as any).taskAuthority ?? "normal_project_task"
        break
      }
      case "claim_asserted": {
        const validFrom = event.validFromRevision ?? this.revision
        const policy = event.validityPolicy ?? "EPISTEMIC"
        const deps = event.dependencies ? [...event.dependencies] : []
        const legacyDeps = event.dependsOn ? [...event.dependsOn] : []

        this.claims.set(event.claimId, {
          id: event.claimId,
          proposition: event.proposition,
          status: event.status,
          supportingEvidence: [...event.evidence],
          dependsOn: legacyDeps,
          dependencies: deps,
          scope: event.scope,
          validFromRevision: validFrom,
          learnedAtRevision: this.revision,
          validityPolicy: policy,
          lastValidatedAt: this.revision,
          provenance: event.provenance,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        })

        // Register in validity graph
        if (deps.length > 0) {
          this.validityGraph.register(event.claimId, deps)
        } else if (legacyDeps.length > 0) {
          this.validityGraph.register(
            event.claimId,
            legacyDeps.map((d) => ({ type: "claim", claimId: d })),
          )
        }
        break
      }
      case "claim_status_changed": {
        const record = this.claims.get(event.claimId)
        if (record) {
          record.status = event.newStatus
          record.updatedAt = event.timestamp
          if (event.newStatus === "verified" || event.newStatus === "supported") {
            record.lastValidatedAt = this.revision
          }
        }
        break
      }
      case "claim_dirtied": {
        const record = this.claims.get(event.claimId)
        if (
          record &&
          record.validityPolicy !== "HISTORICAL" &&
          record.status !== "rejected" &&
          record.status !== "superseded"
        ) {
          record.status = "dirty"
          record.updatedAt = event.timestamp
        }
        break
      }
      case "claim_revalidated": {
        const record = this.claims.get(event.claimId)
        if (record) {
          this.claims.set(event.claimId, {
            ...record,
            status: event.status,
            lastValidatedAt: this.revision,
            updatedAt: event.timestamp,
            supportingEvidence: event.evidence
              ? Array.from(new Set([...record.supportingEvidence, ...event.evidence]))
              : record.supportingEvidence,
          })
        }
        break
      }
      case "claim_staled": {
        const record = this.claims.get(event.claimId)
        if (record && record.validityPolicy !== "HISTORICAL") {
          record.status = "stale"
          record.validToRevision = this.revision
          record.updatedAt = event.timestamp
        }
        break
      }
      case "claim_superseded": {
        const record = this.claims.get(event.claimId)
        if (record) {
          record.status = "superseded"
          record.validToRevision = this.revision
          record.supersededBy = event.supersededBy
          record.updatedAt = event.timestamp
        }
        break
      }
      case "claim_invalidated": {
        const record = this.claims.get(event.claimId)
        if (record) {
          record.status = "invalidated"
          record.validToRevision = this.revision
          record.updatedAt = event.timestamp
        }
        this.cascadeClaimInvalidation(event.claimId, event.reason)
        break
      }
      case "validity_dependency_registered": {
        this.validityGraph.register(event.claimId, event.dependencies)
        const record = this.claims.get(event.claimId)
        if (record) {
          this.claims.set(event.claimId, {
            ...record,
            dependencies: [...event.dependencies],
          })
        }
        break
      }
      case "premise_conflict_detected": {
        this.premiseConflicts.push(event.conflict)
        break
      }
      case "claim_contradicted": {
        const record = this.claims.get(event.claimId)
        if (record) {
          record.status = "rejected"
          record.validToRevision = this.revision
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
      case "claim_promoted": {
        if (!this.evidence.has(event.evidenceId)) {
          throw new RivetError("SemanticViolation", `Unknown evidence reference: ${event.evidenceId}`)
        }
        const record = this.claims.get(event.claimId)
        if (record) {
          this.claims.set(event.claimId, {
            ...record,
            status: event.status,
            supportingEvidence: [...record.supportingEvidence, event.evidenceId],
            lastValidatedAt: this.revision,
            updatedAt: event.timestamp,
          })
        }
        break
      }
      case "claim_rejected": {
        const record = this.claims.get(event.claimId)
        if (record) {
          record.status = "rejected"
          record.validToRevision = this.revision
          record.updatedAt = event.timestamp
        }
        this.rejectedClaims.set(event.claimId, {
          claimId: event.claimId,
          reason: event.reason,
          evidence: event.evidence ? [...event.evidence] : [],
          timestamp: event.timestamp,
        })
        this.cascadeClaimInvalidation(event.claimId, event.reason)
        break
      }
      case "evidence_recorded": {
        this.evidence.set(event.evidenceId, event.summary)
        this.evidenceSources.set(event.evidenceId, event.source)
        if (event.executionReceiptId) this.evidenceExecutionReceipts.set(event.evidenceId, event.executionReceiptId)
        break
      }
      case "execution_recorded": {
        this.executionReceipts.push(event.receipt)
        if (this.executionFocus) {
          this.focusEffort.set(this.executionFocus.id, (this.focusEffort.get(this.executionFocus.id) ?? 0) + 1)
        }
        break
      }
      case "execution_claimed": {
        this.executionClaims.set(event.idempotencyKey, {
          actionId: event.actionId,
          actionFingerprint: event.actionFingerprint,
          scope: event.scope,
        })
        break
      }
      case "observation_recorded": {
        this.observations.set(event.observation.observationId, event.observation)
        break
      }
      case "obligation_created": {
        this.obligations.set(event.obligationId, event.description)
        this.obligationDescriptions.set(event.obligationId, event.description)
        if (event.taskId ?? this.activeTaskId)
          this.obligationTaskIds.set(event.obligationId, (event.taskId ?? this.activeTaskId)!)
        this.obligationDependencies.set(event.obligationId, [...(event.dependencies ?? [])])
        this.obligationScopes.set(event.obligationId, event.scope)
        // Legacy events carry no kind; they were closed via Praxis execution
        // verification, which stays the default closure semantics.
        this.obligationKinds.set(event.obligationId, event.kind ?? "execution")
        if (event.predicate) this.obligationPredicates.set(event.obligationId, event.predicate)
        break
      }
      case "obligation_closed": {
        this.obligations.delete(event.obligationId)
        this.closedObligations.set(event.obligationId, event.receiptId)
        this.controlProgressVersion++
        break
      }
      case "inquiry_satisfied": {
        this.obligations.delete(event.obligationId)
        this.closedObligations.set(event.obligationId, event.receiptId)
        this.inquiryReceipts.set(event.obligationId, {
          receiptId: event.receiptId,
          obligationId: event.obligationId,
          satisfiedAtRevision: event.satisfiedAtRevision,
          summary: event.summary,
          timestamp: event.timestamp,
        })
        this.controlProgressVersion++
        break
      }
      case "verification_recorded": {
        this.verificationHistory.push(event.receipt)
        this.verificationReceipts.set(event.receipt.obligationId, event.receipt)
        if (event.receipt.passed) this.controlProgressVersion++
        if (!event.receipt.passed) {
          this.completedTasks.clear()
          const prev = this.closedObligations.get(event.receipt.obligationId)
          if (prev) {
            this.closedObligations.delete(event.receipt.obligationId)
            this.obligations.set(
              event.receipt.obligationId,
              `Reopened after failed verification receipt ${event.receipt.receiptId} (previously closed by ${prev})`,
            )
          }
        }
        break
      }
      case "obligation_reopened": {
        this.closedObligations.delete(event.obligationId)
        this.obligations.set(event.obligationId, event.reason)
        this.completedTasks.clear()
        this.controlProgressVersion++
        break
      }
      case "obligation_invalidated": {
        this.obligations.delete(event.obligationId)
        this.invalidatedObligations.set(event.obligationId, event.reason)
        this.controlProgressVersion++
        break
      }
      case "task_archived": {
        this.archivedTasks.set(event.taskId, event.reason)
        for (const [obligationId, taskId] of this.obligationTaskIds) {
          if (taskId !== event.taskId) continue
          const description = this.obligations.get(obligationId)
          if (description) {
            this.obligations.delete(obligationId)
            this.suspendedObligations.set(obligationId, description)
          }
        }
        for (const [focusId, focus] of this.focuses) {
          if (focus.taskId === event.taskId) this.archivedFocuses.set(focusId, event.reason)
        }
        for (const [recoveryId, frame] of this.recoveryFrames) {
          if (frame.taskId === event.taskId && frame.status !== "closed") {
            this.recoveryFrames.set(recoveryId, { ...frame, status: "closed", closedAt: event.timestamp })
          }
        }
        this.recoveryStack.splice(
          0,
          this.recoveryStack.length,
          ...this.recoveryStack.filter((id) => this.recoveryFrames.get(id)?.taskId !== event.taskId),
        )
        if (this.executionFocus?.taskId === event.taskId) this.executionFocus = null
        this.controlProgressVersion++
        break
      }
      case "focus_set": {
        this.focuses.set(event.focus.id, event.focus)
        this.executionFocus = event.focus
        this.controlProgressVersion++
        break
      }
      case "focus_archived": {
        this.archivedFocuses.set(event.focusId, event.reason)
        if (this.executionFocus?.id === event.focusId) this.executionFocus = null
        this.controlProgressVersion++
        break
      }
      case "recovery_opened": {
        this.recoveryFrames.set(event.frame.id, event.frame)
        this.recoveryStack.push(event.frame.id)
        this.focuses.set(event.focus.id, event.focus)
        this.executionFocus = event.focus
        this.controlProgressVersion++
        break
      }
      case "recovery_verified": {
        const frame = this.recoveryFrames.get(event.recoveryId)
        if (frame) {
          this.recoveryFrames.set(event.recoveryId, {
            ...frame,
            status: "verified",
            verificationReceiptId: event.receiptId,
          })
        }
        this.controlProgressVersion++
        break
      }
      case "recovery_verification_recorded": {
        this.recoveryVerificationReceipts.set(event.receipt.recoveryId, event.receipt)
        break
      }
      case "recovery_closed": {
        const frame = this.recoveryFrames.get(event.recoveryId)
        if (frame) {
          this.recoveryFrames.set(event.recoveryId, { ...frame, status: "closed", closedAt: event.timestamp })
        }
        const stackIndex = this.recoveryStack.lastIndexOf(event.recoveryId)
        if (stackIndex >= 0) this.recoveryStack.splice(stackIndex, 1)
        this.focuses.set(event.resumeFocus.id, event.resumeFocus)
        this.executionFocus = event.resumeFocus
        this.controlProgressVersion++
        break
      }
      case "focus_folded": {
        this.trajectoryFolds.push(event.fold)
        break
      }
      case "strategy_redirected": {
        this.strategyRedirects.push({
          focusId: event.focusId,
          reason: event.reason,
          timestamp: event.timestamp,
        })
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
        if (this.activeTaskId === event.taskId) {
          this.activeTaskAuthority = null
          if (this.executionFocus?.taskId === event.taskId) {
            this.archivedFocuses.set(this.executionFocus.id, `Task completed by ${event.finalReceipt}`)
            this.executionFocus = null
          }
        }
        this.controlProgressVersion++
        this.completionAttempts++
        if (this.firstAttemptAccepted === null) {
          this.firstAttemptAccepted = true
        }
        break
      }
      case "completion_rejected": {
        this.completionAttempts++
        this.gateRejectionCount++
        if (event.avoidable) {
          this.avoidableGateRejectionCount++
        }
        if (this.firstAttemptAccepted === null) {
          this.firstAttemptAccepted = false
        }
        break
      }
    }
  }

  cascadeClaimInvalidation(sourceClaimId: ClaimId, reason: string): void {
    const toInvalidate: ClaimId[] = []
    for (const [id, record] of this.claims) {
      if (
        (record.dependsOn.includes(sourceClaimId) ||
          record.dependencies.some((d) => d.type === "claim" && d.claimId === sourceClaimId)) &&
        record.status !== "rejected" &&
        record.status !== "invalidated"
      ) {
        toInvalidate.push(id)
      }
    }

    for (const depId of toInvalidate) {
      const depRecord = this.claims.get(depId)
      if (depRecord) {
        depRecord.status = "rejected"
        depRecord.validToRevision = this.revision
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

  obligationKind(obligationId: ObligationId): ObligationKind {
    return this.obligationKinds.get(obligationId) ?? "execution"
  }

  openObligationIds(taskId: TaskId | null = this.activeTaskId): ObligationId[] {
    return Array.from(this.obligations.keys())
      .filter((id) => taskId === null || this.obligationTaskIds.get(id) === taskId)
      .sort()
  }

  readyObligationIds(taskId: TaskId | null = this.activeTaskId): ObligationId[] {
    return this.openObligationIds(taskId).filter((id) =>
      (this.obligationDependencies.get(id) ?? []).every((dependency) => this.closedObligations.has(dependency)),
    )
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

  /**
   * All obligation closure proofs regardless of proof-object family: Praxis
   * verification receipts for execution obligations and authoritative Noesis
   * inquiry receipts for epistemic inquiries. Completion authority counts
   * kind-appropriate closure proofs, not Praxis receipts alone.
   */
  closureReceiptIds(): ReceiptId[] {
    const receipts: ReceiptId[] = []
    for (const receipt of this.verificationReceipts.values()) {
      if (
        receipt.passed &&
        (this.activeTaskId === null || this.obligationTaskIds.get(receipt.obligationId) === this.activeTaskId) &&
        this.isCurrentGoalReceipt(receipt.verifiedScope.revision) &&
        this.verificationReceiptMatchesPredicate(receipt)
      ) {
        receipts.push(receipt.receiptId)
      }
    }
    for (const receipt of this.inquiryReceipts.values()) {
      if (
        (this.activeTaskId === null || this.obligationTaskIds.get(receipt.obligationId) === this.activeTaskId) &&
        this.isCurrentGoalReceipt(receipt.satisfiedAtRevision)
      )
        receipts.push(receipt.receiptId)
    }
    return receipts.sort()
  }

  private isCurrentGoalReceipt(revision: Revision): boolean {
    return this.activeGoalRevision === null || revision.value >= this.activeGoalRevision.value
  }

  private verificationReceiptMatchesPredicate(receipt: VerificationReceipt): boolean {
    const predicate = this.obligationPredicates.get(receipt.obligationId)
    if (!predicate) return true
    if (!receipt.predicate) return false
    switch (predicate.type) {
      case "command_pass":
        return receipt.predicate === `command_pass: "${predicate.command}" exit=${predicate.expectedExitCode}`
      case "file_constraint":
        return (
          receipt.predicate ===
          `file_constraint: path "${predicate.path}" mustExist=${predicate.mustExist}${predicate.contentPattern ? ` content~"${predicate.contentPattern}"` : ""}`
        )
      case "claims_verified":
        return receipt.predicate === `claims_verified: ${predicate.claimPropositions.join("; ")}`
      case "human_approval":
        return receipt.predicate === "human_approval: explicit user approval required"
    }
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
    return this.activeFocus.length + this.hypotheses.length + this.unknowns.length + this.candidateActions.length
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
  activeClaims?: readonly ClaimRecord[]
  contradictions?: readonly string[]
  rejectedClaims?: readonly string[]
  openObligations?: readonly string[]
  obligations?: readonly ObligationViewRecord[]
  completionReadiness?: CompletionReadiness
  recentEvidence?: readonly string[]
  repositorySignals?: readonly string[]
  unknowns?: readonly string[]
  activeHypotheses?: readonly string[]
  activeFocus?: readonly string[]
  executionFocus?: ExecutionFocus | null
  recoveryFrames?: readonly RecoveryFrame[]
  trajectoryFolds?: readonly TrajectoryFold[]
  relevantFiles?: readonly string[]
  premiseConflicts?: readonly PremiseConflict[]
  memoryFrontier?: MemoryFrontier
  repositoryFrontier?: RepositoryFrontier
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
  readonly obligations: readonly ObligationViewRecord[]
  readonly completionReadiness: CompletionReadiness
  readonly recentEvidence: readonly string[]
  readonly repositorySignals: readonly string[]
  readonly unknowns: readonly string[]
  readonly activeHypotheses: readonly string[]
  readonly activeFocus: readonly string[]
  readonly executionFocus: ExecutionFocus | null
  readonly recoveryFrames: readonly RecoveryFrame[]
  readonly trajectoryFolds: readonly TrajectoryFold[]
  readonly relevantFiles: readonly string[]
  readonly premiseConflicts: readonly PremiseConflict[]
  readonly memoryFrontier?: MemoryFrontier
  readonly repositoryFrontier?: RepositoryFrontier
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
    this.obligations = init.obligations ?? []
    this.completionReadiness = init.completionReadiness ?? {
      status: (init.openObligations ?? []).length === 0 ? "READY" : "BLOCKED",
      blockers: (init.openObligations ?? []).map((o) => `Open obligation: ${o}`),
      structuredBlockers: [],
    }
    this.recentEvidence = init.recentEvidence ?? []
    this.repositorySignals = init.repositorySignals ?? []
    this.unknowns = init.unknowns ?? []
    this.activeHypotheses = init.activeHypotheses ?? []
    this.activeFocus = init.activeFocus ?? []
    this.executionFocus = init.executionFocus ?? null
    this.recoveryFrames = init.recoveryFrames ?? []
    this.trajectoryFolds = init.trajectoryFolds ?? []
    this.relevantFiles = init.relevantFiles ?? []
    this.premiseConflicts = init.premiseConflicts ?? []
    this.memoryFrontier = init.memoryFrontier
    this.repositoryFrontier = init.repositoryFrontier
    this.tokenBudgetHint = init.tokenBudgetHint ?? 4096
    this.modelInvocationCount = init.modelInvocationCount ?? 0
  }

  formatPromptBlock(): string {
    const lines: string[] = []
    lines.push("================================================================================")
    lines.push("RIVET COGNITIVE VIEW (Authoritative Epistemic State & Runtime Invariants)")
    lines.push("================================================================================")
    lines.push("CRITICAL HARNESS DIRECTIVES:")
    lines.push("1. Epistemic state & project memory are internal Harness runtime structures, NOT disk files.")
    lines.push(
      "   - NEVER run bash ('git status', 'ls', 'find'), glob ('**/*state*'), or grep ('*memory*') to look for state or memory.",
    )
    lines.push("   - There are NO '.rivet/state' or 'hardstate' files on disk.")
    lines.push("2. MANDATORY TOOL SELECTION:")
    lines.push(
      "   - To inspect project knowledge, hard state status, or verified claims: CALL `query_epistemic_state`.",
    )
    lines.push("   - To recall associative memories, past decisions, or conventions: CALL `retrieve_memory`.")
    lines.push(
      "   - DO NOT make a planning list (todowrite) or execute bash commands when asked about state or memory.",
    )
    if (this.completionReadiness.status !== "NOT_REQUIRED" && this.goalDescription) {
      lines.push("3. OBLIGATION CONTRACTS & COMPLETION READINESS:")
      lines.push(
        "   - Inspect the active obligation's closure contract and completion readiness BEFORE attempting completion.",
      )
      lines.push(
        "   - An authoritative Noesis projection (`query_epistemic_state`) satisfies epistemic inquiries. Praxis is NOT required.",
      )
      lines.push(
        "   - Do NOT call `request_verification` (Praxis) unless the obligation explicitly requires Praxis verification.",
      )
      lines.push(
        "   - Only call `request_completion` when COMPLETION READINESS is READY. If BLOCKED, address ONLY the listed blockers.",
      )
      lines.push(
        "   - If rejected, address ONLY the reported blocker. Do NOT run unrelated shell commands or invent verification work.",
      )
    } else {
      lines.push("3. CONVERSATIONAL / CHAT PROJECTION MODE:")
      lines.push("   - You are in conversational mode. Respond directly, politely, and helpfully in natural prose.")
      lines.push(
        "   - Do NOT recite internal state tables, obligations, or completion blockers unless the user specifically asks for status.",
      )
      lines.push("   - Do NOT call `request_completion` or `request_verification`.")
    }
    lines.push("================================================================================\n")
    if (this.goalDescription) {
      lines.push("### CURRENT GOAL")
      lines.push(`Repository: ${this.repositoryId}`)
      lines.push(`${this.goalDescription}\n`)
    }

    if (this.executionFocus) {
      lines.push("### CURRENT FOCUS (AUTHORITATIVE)")
      lines.push(`Focus ID: ${this.executionFocus.id}`)
      lines.push(`Task ID: ${this.executionFocus.taskId}`)
      lines.push(`Kind: ${this.executionFocus.kind.toUpperCase()}`)
      lines.push(`Objective: ${this.executionFocus.objective}`)
      lines.push(`Acceptance: ${this.executionFocus.contract.acceptanceCriteria.join("; ")}`)
      lines.push(`Allowed scope: ${this.executionFocus.contract.allowedScope.join("; ")}`)
      lines.push(`Required evidence: ${this.executionFocus.contract.requiredEvidence.join(", ") || "verifier-defined"}`)
      lines.push(`Effort budget: ${this.executionFocus.contract.effortBudget ?? "default"}`)
      if (this.executionFocus.resumeTarget) lines.push(`Resume target: ${this.executionFocus.resumeTarget}`)
      lines.push("")
    }

    if (this.recoveryFrames.length > 0) {
      lines.push("### RECOVERY STACK")
      for (const frame of this.recoveryFrames) {
        lines.push(`- [${frame.id}] ${frame.failureClass}: ${frame.objective} -> resume ${frame.resumeTarget}`)
      }
      lines.push("")
    }

    if (this.trajectoryFolds.length > 0) {
      lines.push("### RESOLVED FOCUS / RECOVERY FOLDS")
      for (const fold of this.trajectoryFolds.slice(-5)) {
        lines.push(`- ${fold.summary}`)
        lines.push(`  Evidence: ${fold.evidenceRefs.join(", ") || "none"}`)
      }
      lines.push("")
    }

    if (this.completionReadiness.status === "NOT_REQUIRED" || !this.goalDescription) {
      lines.push("### CONVERSATIONAL MODE (No Active Autonomous Goal)")
      lines.push("Harness gate: NOT_REQUIRED. Respond directly to the user in natural prose.")
      lines.push(
        "Do NOT invoke 'request_completion' or 'request_verification' for conversational turns or general questions.\n",
      )
    } else if (this.completionReadiness.status === "READY") {
      lines.push(`### COMPLETION READINESS: READY`)
      lines.push("All required obligations are closed and verified by authoritative receipts.")
      lines.push("Harness gate allows completion: you may call 'request_completion' when ready.\n")
    } else {
      lines.push(`### COMPLETION READINESS: BLOCKED`)
      lines.push("Completion is currently BLOCKED by Harness runtime gates.")
      lines.push("Do NOT call 'request_completion' until all blockers below are resolved:")
      for (const blocker of this.completionReadiness.blockers) {
        lines.push(`- [BLOCKER] ${blocker}`)
      }
      lines.push(
        "Directives: Address ONLY the blockers listed above. Do not invent verification work or run unrelated commands. For questions and inquiries, answer the user directly in prose.\n",
      )
    }

    if (this.completionReadiness.status !== "NOT_REQUIRED" && Boolean(this.goalDescription)) {
      if (this.obligations.length > 0) {
        lines.push("### OBLIGATION CONTRACTS & CLOSURE REQUIREMENTS:")
        for (const o of this.obligations) {
          lines.push(`- [OBLIGATION: ${o.id}]`)
          lines.push(`  Type: ${o.type.toUpperCase()}`)
          lines.push(`  Objective: ${o.objective}`)
          lines.push(`  Status: ${o.status.toUpperCase()}`)
          lines.push(`  Closure:`)
          lines.push(`    Required Proof: ${o.closure.requiredProofKind}`)
          lines.push(`    Verifier: ${o.closure.verifier}`)
          lines.push(`    Praxis: ${o.closure.praxisRequired ? "REQUIRED" : "NOT REQUIRED"}`)
          if (o.predicateSummary) lines.push(`    Predicate: ${o.predicateSummary}`)
          if (o.legalTransitions && o.legalTransitions.length > 0) {
            lines.push(`    Legal Transitions: ${o.legalTransitions.join(" | ")}`)
          }
          lines.push(
            `    Accepted Proof Refs: ${o.closure.acceptedProofRefs.length > 0 ? o.closure.acceptedProofRefs.join(", ") : "(None yet)"}`,
          )
          if (o.blockers.length > 0) {
            lines.push(`  Blockers:`)
            for (const b of o.blockers) {
              lines.push(`    - ${b}`)
            }
          } else {
            lines.push(`  Blockers: (None - satisfied)`)
          }
        }
        lines.push("")
      } else if (this.openObligations.length > 0) {
        lines.push("### OPEN OBLIGATIONS TO VERIFY (Use internal ID only when proposing verification):")
        for (const o of this.openObligations) {
          lines.push(`- [ ] ${o}`)
        }
        lines.push("")
      }
    } else {
      lines.push("### OPEN OBLIGATIONS TO VERIFY:")
      lines.push("- (None open)")
      lines.push("")
    }

    if (this.premiseConflicts.length > 0) {
      lines.push("### DETECTED PREMISE CONFLICTS (User premise contradicts verified state):")
      for (const pc of this.premiseConflicts) {
        lines.push(`- [PREMISE CONFLICT] User assumes: "${pc.userPremise}"`)
        lines.push(`  Current Validated Truth: "${pc.currentValidState}"`)
        if (pc.conflictingClaimId) {
          lines.push(`  (Previous claim ${pc.conflictingClaimId} superseded/invalidated at ${pc.supersededAtRevision})`)
        }
      }
      lines.push("")
    }

    if (this.activeClaims.length > 0) {
      lines.push("### AUTHORITATIVE HARD CLAIMS:")
      for (const c of this.activeClaims) {
        const policyTag = c.validityPolicy !== "EPISTEMIC" ? ` [${c.validityPolicy}]` : ""
        lines.push(
          `- [${c.status}] ${c.id}: ${c.proposition}${policyTag} (valid: ${c.validFromRevision}..${c.validToRevision ?? "now"})`,
        )
      }
      lines.push("")
    } else {
      lines.push("### AUTHORITATIVE HARD CLAIMS:")
      lines.push(
        "- (None currently admitted in Hard State. Use `propose_claim` or `query_epistemic_state` to inspect/assert claims)",
      )
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
      lines.push("### REJECTED / SUPERSEDED / FALSIFIED CLAIMS (Do not re-explore):")
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

    if (this.recentEvidence.length > 0) {
      lines.push("### RECENT AUTHORITATIVE EVIDENCE:")
      for (const e of this.recentEvidence) {
        lines.push(`- ${e}`)
      }
      lines.push("")
    }

    if (this.memoryFrontier) {
      const activeMem = this.memoryFrontier.active
      const episodicMem = this.memoryFrontier.episodic
      const rejectedMem = this.memoryFrontier.rejected
      const proceduralMem = this.memoryFrontier.procedural ?? []

      if (activeMem.length > 0 || episodicMem.length > 0 || rejectedMem.length > 0 || proceduralMem.length > 0) {
        lines.push("### HARNESS MEMORY FRONTIER (Associative Context):")
        for (const m of activeMem) {
          lines.push(`- [active:${m.type}] ${m.summary}`)
        }
        for (const m of proceduralMem) {
          lines.push(`- [procedure:${m.type}] ${m.summary}`)
        }
        for (const m of episodicMem) {
          lines.push(`- [history:${m.type}] ${m.summary}`)
        }
        for (const m of rejectedMem) {
          lines.push(`- [failure-avoidance:${m.type}] ${m.summary}`)
        }
        lines.push("")
      }
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
      lines.push("### DERIVED ENVIRONMENT PROJECTIONS (Recomputed live, not fossilized):")
      for (const s of this.repositorySignals) {
        lines.push(`- ${s}`)
      }
      lines.push("")
    }

    if (this.repositoryFrontier) {
      lines.push(RepositoryFrontierCompiler.render(this.repositoryFrontier))
      lines.push("")
    }

    lines.push(
      `### RUNTIME STATE METADATA: HardState Revision ${this.hardRevision} · ${this.modelInvocationCount} prior model calls`,
    )

    let out = lines.join("\n")
    const marker = "\n[view truncated]"
    const maxBytes = Math.max(this.tokenBudgetHint * 4, marker.length)
    if (out.length > maxBytes) {
      out = out.slice(0, maxBytes - marker.length) + marker
    }
    return out
  }
}

export type MemoryHorizon = "H0_IMMEDIATE" | "H1_RECENT" | "H2_LONG_TERM" | "H3_ARCHIVE"

export type TaskPhase = "orientation" | "diagnosis" | "planning" | "implementation" | "verification" | "brainstorming"

export type EpistemicRole = "authoritative" | "episodic" | "procedural" | "provisional" | "rejected" | "superseded"

export interface NoesisAdmissionCandidate {
  readonly id: string
  readonly content: string
  readonly score: number
  readonly sourceRefs?: readonly string[]
  readonly proposedKind?: string
  readonly revision?: Revision
  readonly scope?: Scope
  readonly relatedSymbols?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

export interface CognitiveAdmissionContext {
  readonly hardState: HardState
  readonly taskPhase: TaskPhase
  readonly currentRevision: Revision
  readonly scope: Scope
  readonly activeSymbols?: readonly string[]
  readonly userPrompt?: string
  readonly goalDescription?: string
}

export type MemoryAdmissionDecision =
  | { readonly kind: "ADMIT_CURRENT"; readonly ref: MemoryRef; readonly horizon: MemoryHorizon }
  | { readonly kind: "ADMIT_PROCEDURAL"; readonly ref: MemoryRef; readonly horizon: MemoryHorizon }
  | { readonly kind: "ADMIT_FAILURE_AVOIDANCE"; readonly ref: MemoryRef; readonly horizon: MemoryHorizon }
  | { readonly kind: "ADMIT_HISTORICAL"; readonly ref: MemoryRef; readonly horizon: MemoryHorizon }
  | { readonly kind: "QUARANTINE"; readonly reason: string; readonly horizon: MemoryHorizon }
  | { readonly kind: "SUPPRESS"; readonly reason: string; readonly horizon: MemoryHorizon }

export class Noesis {
  /**
   * Evaluates an associative memory candidate against canonical HardState,
   * architecture epoch, temporal horizon, task phase, and epistemic risk policy.
   *
   * Invariants:
   * 1. Retrievable != Admissible
   * 2. Memory engine cannot report authority; authority is derived exclusively via canonical sourceRefs in HardState.
   * 3. Memory candidates never mint "verified" status out of thin air.
   * 4. SoftWorkspace provisional hypotheses are SUPPRESSED during orientation, planning, diagnosis, and implementation.
   * 5. Long-term memory (H2/H3 or cross-epoch) requires stronger evidence or explicit symbol match.
   */
  static admitMemory(candidate: NoesisAdmissionCandidate, context: CognitiveAdmissionContext): MemoryAdmissionDecision {
    // 1. Calculate Horizon: Architecture Epoch + Revision Distance
    let horizon: MemoryHorizon = "H2_LONG_TERM"
    const currentRev = context.currentRevision
    const candRev = candidate.revision

    if (candRev && currentRev) {
      const candidateEpoch = context.hardState.getEpochForRevision(candRev)
      const currentEpoch = context.hardState.getActiveEpoch() ?? context.hardState.getEpochForRevision(currentRev)

      if (candidateEpoch && currentEpoch && candidateEpoch.id !== currentEpoch.id) {
        // CROSS-EPOCH MEMORY: Crossing an architecture epoch boundary forces historical archive status!
        // Even if commit distance is small, crossing an epoch is a deep epistemic gulf.
        horizon = "H2_LONG_TERM"
      } else {
        // Same epoch: evaluate revision delta
        const deltaRev = Number(currentRev.value - candRev.value)
        if (deltaRev <= 1) {
          horizon = "H0_IMMEDIATE"
        } else if (deltaRev <= 15) {
          horizon = "H1_RECENT"
        } else if (deltaRev <= 60) {
          horizon = "H2_LONG_TERM"
        } else {
          horizon = "H3_ARCHIVE"
        }
      }
    }

    // 2. Canonical HardState Lookup via mandatory sourceRefs (NO candidate.id fallback!)
    const sourceRefs = candidate.sourceRefs ?? []
    const canonicalClaimId = sourceRefs[0]
    const canonicalClaim = canonicalClaimId ? context.hardState.claims.get(canonicalClaimId as any) : undefined

    let role: EpistemicRole = "episodic"
    if (canonicalClaim) {
      if (canonicalClaim.status === "verified") {
        if (
          canonicalClaim.supersededBy ||
          (canonicalClaim.validToRevision && canonicalClaim.validToRevision.value <= context.currentRevision.value)
        ) {
          role = "superseded"
        } else {
          role = "authoritative"
        }
      } else if (canonicalClaim.status === "rejected") {
        role = "rejected"
      } else if (
        canonicalClaim.status === "stale" ||
        canonicalClaim.status === "dirty" ||
        canonicalClaim.status === "superseded"
      ) {
        role = "superseded"
      } else {
        role = "episodic"
      }
    } else {
      // Non-claim metadata classification
      // CRITICAL INVARIANT: A candidate without canonical sourceRefs resolving to a verified claim
      // CAN NEVER BE ADMITTED AS AUTHORITATIVE, even if candidate metadata claims authority === "authoritative"!
      if (
        candidate.proposedKind === "soft_hypothesis" ||
        candidate.proposedKind === "soft_unknown" ||
        candidate.metadata?.epistemicClass === "soft_hypothesis" ||
        candidate.metadata?.authority === "provisional" ||
        candidate.metadata?.isSoftWorkspace === true ||
        candidate.content.toLowerCase().includes("provisional hypothesis")
      ) {
        role = "provisional"
      } else if (
        candidate.proposedKind === "procedure" ||
        candidate.metadata?.epistemicClass === "procedure" ||
        candidate.metadata?.kind === "procedure"
      ) {
        role = "procedural"
      } else if (
        candidate.proposedKind === "rejected_approach" ||
        candidate.metadata?.epistemicClass === "rejected_approach" ||
        candidate.metadata?.authority === "rejected"
      ) {
        role = "rejected"
      } else if (
        candidate.metadata?.epistemicStatus === "superseded" ||
        candidate.metadata?.authority === "historical"
      ) {
        role = "superseded"
      } else {
        role = "episodic"
      }
    }

    // 3. Epistemic Admission Rules by Task Phase and Role

    // RULE 1: Provisional SoftWorkspace Hypotheses
    if (role === "provisional") {
      if (
        context.taskPhase === "diagnosis" ||
        context.taskPhase === "implementation" ||
        context.taskPhase === "verification" ||
        context.taskPhase === "orientation" ||
        context.taskPhase === "planning"
      ) {
        return {
          kind: "SUPPRESS",
          reason: `Provisional SoftWorkspace hypotheses are strictly suppressed during ${context.taskPhase} to prevent cognitive anchoring.`,
          horizon,
        }
      }
      // Allowed only in brainstorming phase
      return {
        kind: "ADMIT_HISTORICAL",
        ref: {
          id: candidate.id as any,
          type: "claim",
          summary: `[PROVISIONAL HYPOTHESIS] ${candidate.content}`,
          status: "supported",
          revision: candidate.revision ?? context.currentRevision,
        },
        horizon,
      }
    }

    // RULE 2: Rejected Approaches (Failure Avoidance)
    if (role === "rejected") {
      return {
        kind: "ADMIT_FAILURE_AVOIDANCE",
        ref: {
          id: candidate.id as any,
          type: "failure",
          summary: `[FAILURE AVOIDANCE] ${candidate.content}`,
          status: "rejected",
          revision: candidate.revision ?? context.currentRevision,
        },
        horizon,
      }
    }

    // RULE 3: Superseded / Historical Only
    if (role === "superseded") {
      if (
        context.taskPhase === "implementation" ||
        context.taskPhase === "verification" ||
        context.taskPhase === "orientation"
      ) {
        return {
          kind: "SUPPRESS",
          reason: `Superseded architectural facts are suppressed during ${context.taskPhase} to prevent regressions.`,
          horizon,
        }
      }
      return {
        kind: "ADMIT_HISTORICAL",
        ref: {
          id: candidate.id as any,
          type: "observation",
          summary: `[HISTORICAL ARCHIVE - SUPERSEDED] ${candidate.content}`,
          status: "superseded",
          revision: candidate.revision ?? context.currentRevision,
        },
        horizon,
      }
    }

    // RULE 4: Long-Horizon Evidence Gating (H2 / H3)
    if (horizon === "H2_LONG_TERM" || horizon === "H3_ARCHIVE") {
      const activeSyms = context.activeSymbols ?? []
      const docSyms = candidate.relatedSymbols ?? []
      const hasSharedSymbol = activeSyms.length > 0 && docSyms.some((s) => activeSyms.includes(s))
      const hasStrongScore = candidate.score >= 0.65

      if (!hasSharedSymbol && !hasStrongScore) {
        return {
          kind: "SUPPRESS",
          reason: `Long-horizon historical memory requires strong relevance score (>=0.65) or matching active symbols. (score=${candidate.score.toFixed(2)})`,
          horizon,
        }
      }
    }

    // RULE 5: Procedural Memories
    if (role === "procedural") {
      return {
        kind: "ADMIT_PROCEDURAL",
        ref: {
          id: candidate.id as any,
          type: "claim",
          summary: candidate.content,
          status: "supported",
          revision: candidate.revision ?? context.currentRevision,
        },
        horizon,
      }
    }

    // RULE 6: Authoritative Claims (Derived via canonical HardState)
    if (role === "authoritative") {
      return {
        kind: "ADMIT_CURRENT",
        ref: {
          id: candidate.id as any,
          type: canonicalClaim ? "claim" : "observation",
          summary: candidate.content,
          status: canonicalClaim ? canonicalClaim.status : "supported",
          revision: candidate.revision ?? context.currentRevision,
        },
        horizon,
      }
    }

    // Default Episodic Memory
    return {
      kind: "ADMIT_HISTORICAL",
      ref: {
        id: candidate.id as any,
        type: "observation",
        summary: candidate.content,
        status: "supported",
        revision: candidate.revision ?? context.currentRevision,
      },
      horizon,
    }
  }
}

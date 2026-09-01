import {
  type ActionId,
  type ClaimId,
  type EpistemicStatus,
  type EvidenceId,
  type ObligationId,
  type ReceiptId,
  Revision,
  RivetError,
  Scope,
  type TaskId,
  createActionId,
  createReceiptId,
  isSafeRelativePath,
} from "./types"

export const ACCP_VERSION = "3.0"

export type ActorRole = "COGNITIVE_CONTROLLER" | "HARNESS"

export type MessageFamily = "VIEW" | "QUERY" | "PROPOSAL" | "DECISION" | "RECEIPT" | "SIGNAL"

export type ActionRisk = "inspect" | "material" | "destructive"

export type ActionDecisionVerdict = "allow" | "block" | "require_human_approval"

export interface ActionProposal {
  readonly actionId: ActionId
  readonly capability: string
  readonly target: string
  readonly parameters: Record<string, unknown>
  readonly estimatedRisk: ActionRisk
  readonly intent: string
  readonly scope: Scope
  readonly idempotencyKey?: string
  readonly timestamp: string
}

export function createActionProposal(init: {
  actionId?: ActionId
  capability: string
  target: string
  parameters?: Record<string, unknown>
  estimatedRisk?: ActionRisk
  intent: string
  scope: Scope
  idempotencyKey?: string
}): ActionProposal {
  return {
    actionId: init.actionId ?? createActionId(),
    capability: init.capability,
    target: init.target,
    parameters: init.parameters ?? {},
    estimatedRisk: init.estimatedRisk ?? "inspect",
    intent: init.intent,
    scope: init.scope,
    idempotencyKey: init.idempotencyKey,
    timestamp: new Date().toISOString(),
  }
}

export interface ActionDecision {
  readonly actionId: ActionId
  readonly verdict: ActionDecisionVerdict
  readonly reason: string
  readonly authorizedScope: Scope
  readonly timestamp: string
}

export interface AuthorizedAction {
  readonly proposal: ActionProposal
  readonly decision: ActionDecision
  readonly revision: Revision
  readonly scope: Scope
}

export interface ExecutionReceipt {
  readonly receiptId: ReceiptId
  readonly actionId: ActionId
  readonly idempotencyKey: string
  readonly actionFingerprint: string
  readonly capability: string
  readonly success: boolean
  readonly exitCode?: number | null
  readonly scope: Scope
  readonly risk: ActionRisk
  readonly humanApproved: boolean
  readonly outputSummary: string
  readonly observations?: unknown
  readonly evidenceId: EvidenceId
  readonly executionDurationMs: number
  readonly timestamp: string
}

export interface ClaimProposal {
  readonly claimId: ClaimId
  readonly proposition: string
  readonly proposedStatus: EpistemicStatus
  readonly supportingEvidence: EvidenceId[]
  readonly scope: Scope
  readonly timestamp: string
}

export interface VerificationRequest {
  readonly obligationId: ObligationId
  readonly predicate: string
  readonly targetScope: Scope
  readonly timeoutSeconds: number
  readonly timestamp: string
}

export interface VerificationReceipt {
  readonly receiptId: ReceiptId
  readonly obligationId: ObligationId
  readonly passed: boolean
  readonly evidenceId: EvidenceId
  readonly verifiedScope: Scope
  readonly diagnostics?: string | null
  readonly timestamp: string
}

export interface StateTransitionProposal {
  readonly baseRevision: Revision
  readonly claimsToAssert: ClaimProposal[]
  readonly claimsToReject: ClaimId[]
  readonly obligationsToCreate: string[]
  readonly timestamp: string
}

export interface CompletionProposal {
  readonly taskId: TaskId
  readonly summary: string
  readonly claimsAddressed: ClaimId[]
  readonly baseRevision: Revision
  readonly timestamp: string
}

export interface CompletionDecision {
  readonly taskId: TaskId
  readonly completed: boolean
  readonly requiredObligationsSatisfied: boolean
  readonly unclosedObligations: ObligationId[]
  readonly finalReceipt?: ReceiptId | null
  readonly timestamp: string
}

export interface ViewMessage {
  readonly kind: string
  readonly payload: unknown
}

export interface QueryMessage {
  readonly kind: string
  readonly selector: Record<string, unknown>
  readonly purpose: string
  readonly scope: Scope
}

export interface SignalMessage {
  readonly kind: string
  readonly subjectRef?: string | null
  readonly reason: string
  readonly scope?: Scope | null
}

export type AccpMessage =
  | { readonly class: "view"; readonly payload: ViewMessage }
  | { readonly class: "query"; readonly payload: QueryMessage }
  | { readonly class: "action_proposal"; readonly payload: ActionProposal }
  | { readonly class: "action_decision"; readonly payload: ActionDecision }
  | { readonly class: "execution_receipt"; readonly payload: ExecutionReceipt }
  | { readonly class: "claim_proposal"; readonly payload: ClaimProposal }
  | { readonly class: "verification_request"; readonly payload: VerificationRequest }
  | { readonly class: "verification_receipt"; readonly payload: VerificationReceipt }
  | { readonly class: "state_transition_proposal"; readonly payload: StateTransitionProposal }
  | { readonly class: "completion_proposal"; readonly payload: CompletionProposal }
  | { readonly class: "completion_decision"; readonly payload: CompletionDecision }
  | { readonly class: "signal"; readonly payload: SignalMessage }

export interface AccpEnvelope {
  readonly accpVersion: string
  readonly messageId: string
  readonly sender: ActorRole
  readonly family: MessageFamily
  readonly kind: string
  readonly payload: Record<string, unknown>
  readonly correlationId?: string | null
  readonly scope?: Scope | null
  readonly revision?: Revision | null
}

const CORE_KINDS_BY_FAMILY: Record<MessageFamily, readonly string[]> = {
  VIEW: ["COGNITIVE", "STATE", "CAPABILITY", "CONSTRAINT"],
  QUERY: ["STATE", "EVIDENCE", "ARTIFACT", "CAPABILITY"],
  PROPOSAL: ["CLAIM", "ACTION", "WORKSPACE_DELTA", "STATE_TRANSITION", "VERIFICATION", "COMPLETION"],
  DECISION: ["ACTION", "STATE_TRANSITION", "COMPLETION"],
  RECEIPT: ["EXECUTION", "OBSERVATION", "EVIDENCE", "VERIFICATION", "STATE_TRANSITION"],
  SIGNAL: ["STALE_STATE", "CONTRADICTION", "REPLAN_REQUIRED", "BUDGET", "CANCELLATION", "LIFECYCLE"],
}

export function isKindValidForFamily(family: MessageFamily, kind: string): boolean {
  const allowed = CORE_KINDS_BY_FAMILY[family]
  return allowed?.includes(kind) || kind.startsWith("EXT_")
}

export function validateEnvelopeDirection(envelope: AccpEnvelope): void {
  if (envelope.accpVersion !== ACCP_VERSION) {
    throw new RivetError(
      "SemanticViolation",
      `Unsupported ACCP version '${envelope.accpVersion}', expected ${ACCP_VERSION}`
    )
  }

  if (!envelope.messageId?.trim() || !envelope.kind?.trim()) {
    throw new RivetError("SemanticViolation", "ACCP envelope requires messageId and kind")
  }

  if (typeof envelope.payload !== "object" || envelope.payload === null) {
    throw new RivetError("SemanticViolation", "ACCP envelope payload must be an object")
  }

  if (!isKindValidForFamily(envelope.family, envelope.kind)) {
    throw new RivetError(
      "SemanticViolation",
      `ACCP kind '${envelope.kind}' is not valid for family ${envelope.family}`
    )
  }

  const controllerAllowed = envelope.family === "QUERY" || envelope.family === "PROPOSAL"
  const harnessAllowed =
    envelope.family === "VIEW" ||
    envelope.family === "DECISION" ||
    envelope.family === "RECEIPT" ||
    envelope.family === "SIGNAL"

  const isAllowed =
    envelope.sender === "COGNITIVE_CONTROLLER" ? controllerAllowed : harnessAllowed

  if (!isAllowed) {
    throw new RivetError(
      "SemanticViolation",
      `${envelope.sender} cannot emit ${envelope.family} message`
    )
  }
}

export interface ActionAuthorizationPolicy {
  readonly repository: string
  readonly currentRevision: Revision
  readonly allowedScope: Scope
  readonly allowedCapabilities: readonly string[]
  readonly allowMaterial: boolean
  readonly humanApproved: boolean
}

export class AccpSemanticGate {
  static validateMessage(envelope: AccpEnvelope): void {
    validateEnvelopeDirection(envelope)
  }

  static validateClaimProposal(proposal: ClaimProposal): void {
    if (!proposal.proposition.trim()) {
      throw new RivetError("SemanticViolation", "Claim proposal proposition must not be empty")
    }
    if (proposal.proposedStatus === "verified") {
      throw new RivetError("SemanticViolation", "Controller cannot mint VERIFIED claim status")
    }
  }

  static authorize(
    proposal: ActionProposal,
    policy: ActionAuthorizationPolicy
  ): { readonly authorizedAction: AuthorizedAction | null; readonly decision: ActionDecision } {
    const decision = this.authorizeAction(proposal, policy)
    if (decision.verdict === "allow") {
      return {
        authorizedAction: {
          proposal,
          decision,
          revision: policy.currentRevision,
          scope: decision.authorizedScope,
        },
        decision,
      }
    }
    return { authorizedAction: null, decision }
  }

  static authorizeAction(
    proposal: ActionProposal,
    policy: ActionAuthorizationPolicy
  ): ActionDecision {
    const blocked = (verdict: ActionDecisionVerdict, reason: string): ActionDecision => ({
      actionId: proposal.actionId,
      verdict,
      reason,
      authorizedScope: policy.allowedScope,
      timestamp: new Date().toISOString(),
    })

    if (!proposal.scope.revision.equals(policy.currentRevision)) {
      return blocked("block", "Action proposal is stale for the current state revision")
    }

    if (
      proposal.scope.repository !== policy.repository ||
      !policy.allowedScope.containsScope(proposal.scope) ||
      !policy.allowedScope.allowsPath(
        policy.repository,
        proposal.target,
        policy.currentRevision
      ) ||
      !isSafeRelativePath(proposal.target)
    ) {
      return blocked("block", "Action target or declared scope is outside Harness authority")
    }

    const capabilityAllowed = policy.allowedCapabilities.some((cap) => {
      if (cap === proposal.capability) return true
      if (cap.endsWith(".*")) {
        const prefix = cap.slice(0, -1)
        return proposal.capability.startsWith(prefix)
      }
      if (cap === "mcp.*" && proposal.capability.startsWith("mcp.")) return true
      return false
    })

    if (!capabilityAllowed) {
      return blocked("block", "Requested capability is not exposed for this task")
    }

    if (proposal.estimatedRisk === "inspect") {
      return {
        actionId: proposal.actionId,
        verdict: "allow",
        reason: "Read-only capability allowed within declared scope",
        authorizedScope: policy.allowedScope,
        timestamp: new Date().toISOString(),
      }
    }

    if (proposal.estimatedRisk === "material") {
      if (policy.allowMaterial) {
        return {
          actionId: proposal.actionId,
          verdict: "allow",
          reason: "Material capability allowed within Harness policy",
          authorizedScope: policy.allowedScope,
          timestamp: new Date().toISOString(),
        }
      }
      return blocked("block", "Material modification is not permitted by current policy")
    }

    if (proposal.estimatedRisk === "destructive") {
      if (!policy.humanApproved) {
        return blocked("require_human_approval", "Destructive action requires explicit human approval")
      }
      return {
        actionId: proposal.actionId,
        verdict: "allow",
        reason: "Destructive action approved by human authority",
        authorizedScope: policy.allowedScope,
        timestamp: new Date().toISOString(),
      }
    }

    return blocked("block", "Action risk is not authorized")
  }

  static ensureExecutionAuthorized(decision: ActionDecision): void {
    if (decision.verdict === "allow") return
    if (decision.verdict === "block") {
      throw new RivetError("AuthorityDenied", `Action blocked by policy: ${decision.reason}`)
    }
    if (decision.verdict === "require_human_approval") {
      throw new RivetError("AuthorityDenied", "Action requires explicit human approval")
    }
  }

  static checkCompletionAuthority(unclosedObligations: readonly ObligationId[]): void {
    if (unclosedObligations.length > 0) {
      throw new RivetError(
        "SemanticViolation",
        `Cannot complete task: ${unclosedObligations.length} obligations remain unverified`
      )
    }
  }

  static evaluateCompletion(
    proposal: CompletionProposal,
    currentRevision: Revision,
    unclosedObligations: readonly ObligationId[],
    passingReceipts: readonly ReceiptId[]
  ): CompletionDecision {
    const obligationsSatisfied = unclosedObligations.length === 0
    const revisionMatches = proposal.baseRevision.equals(currentRevision)
    const completed = obligationsSatisfied && revisionMatches && passingReceipts.length > 0

    return {
      taskId: proposal.taskId,
      completed,
      requiredObligationsSatisfied: obligationsSatisfied && revisionMatches,
      unclosedObligations: [...unclosedObligations],
      finalReceipt: completed ? passingReceipts[passingReceipts.length - 1] ?? null : null,
      timestamp: new Date().toISOString(),
    }
  }
}

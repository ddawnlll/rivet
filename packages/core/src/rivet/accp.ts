import {
  type ActionId,
  type ClaimId,
  type CompletionBlocker,
  type CompletionReadiness,
  type EpistemicStatus,
  type EvidenceId,
  type ObligationId,
  type ObligationKind,
  type ObligationVerifier,
  type ReceiptId,
  Revision,
  RivetError,
  Scope,
  canonicalRepositoryPath,
  type TaskId,
  createActionId,
  createReceiptId,
} from "./types"
import { isValidFilePathCandidate, type ObligationPredicate } from "./goal-compiler"

export const ACCP_VERSION = "3.0"

/**
 * Compile the non-normative Reference System Prompt from the normative profile.
 * Monograph principle: system prompt = role + boundary, not runtime constitution.
 * Law is enforced in Rust/TS types / ACCP gate / Harness / Noesis / Praxis — not in the prompt.
 * If removing a prompt rule can violate authority/epistemic/completion correctness,
 * that rule is implemented at the wrong layer.
 */
export function compileReferencePrompt(): string {
  return [
    "You are Rivet, an expert software engineering AI pair-programmer.",
    "You propose; Harness owns authoritative reality (execution, observation, verification, persistence, completion).",
    "",
    "Tone & Rules:",
    "1. Language Match: Reply 100% in user's language (Türkçe ise Türkçe konuş).",
    "2. Natural Markdown: Answer audits/questions in Markdown. Do not dump internal IDs (oblg_..., rN).",
    "3. AccpEnvelope: For actions, emit typed AccpEnvelope JSON in ```accp block:",
    '{"accp_version":"3.0","sender":"COGNITIVE_CONTROLLER","family":"PROPOSAL","kind":"ACTION","revision":<view.hard_revision>,"payload":{"capability":"file.read|code.search|dir.list|file.write","target":"...","parameters":{...},"intent":"..."}}',
    "",
    "Allowed: QUERY/*; PROPOSAL/CLAIM,ACTION,WORKSPACE_DELTA,STATE_TRANSITION,VERIFICATION,COMPLETION.",
    "Forbidden: VIEW/*, DECISION/*, RECEIPT/*, SIGNAL/* — never emit receipts.",
    "Rules: Use revision == view.hard_revision. Retrieved view state is context, not new evidence.",
    "Payloads: ACTION{capability,target,parameters,intent}, WORKSPACE_DELTA{add[],remove[]}, VERIFICATION{obligation_id,predicate,target_scope}, CLAIM{proposition}, COMPLETION{summary}.",
    "",
    "Obligation & Completion Rules:",
    "- Inspect obligation closure requirements before attempting completion. Epistemic inquiries close via authoritative Noesis projection (query_epistemic_state); Praxis is NOT required.",
    "- Only propose completion when COMPLETION READINESS is READY. On rejection, target only the reported blockers.",
  ].join("\n")
}

export type ActorRole = "COGNITIVE_CONTROLLER" | "HARNESS"

export type MessageFamily = "VIEW" | "QUERY" | "PROPOSAL" | "DECISION" | "RECEIPT" | "SIGNAL"

export type ActionRisk = "inspect" | "material" | "destructive"

export type ActionDecisionVerdict = "allow" | "block" | "require_human_approval"

export interface ActionProposal {
  readonly actionId: ActionId
  /** Provider tool name is transport identity, never execution authority. */
  readonly providerName: string
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
  providerName?: string
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
    providerName: init.providerName ?? init.capability,
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

const AuthorizedActionTypeId: unique symbol = Symbol("Rivet.AuthorizedAction")

export interface AuthorizedAction {
  readonly [AuthorizedActionTypeId]: true
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
  /** The authoritative action target, used to bind verification to execution. */
  readonly target?: string
  readonly success: boolean
  /** True when the harness cannot establish whether an external side effect settled. */
  readonly uncertain?: boolean
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
  /** Canonical predicate description that this receipt actually evaluated. */
  readonly predicate?: string
  /** The concrete execution receipt used by execution-backed verification. */
  readonly executionReceiptId?: ReceiptId
  readonly diagnostics?: string | null
  readonly reasonCodes?: readonly string[]
  readonly timestamp: string
}

/**
 * Closure proof for epistemic inquiry obligations. The authoritative Noesis
 * projection itself is the evidence: the receipt binds the obligation to the
 * canonical revision the answer was grounded in. Praxis execution verification
 * is neither required nor meaningful for read-only inquiries.
 */
export interface InquiryReceipt {
  readonly receiptId: ReceiptId
  readonly obligationId: ObligationId
  readonly satisfiedAtRevision: Revision
  readonly summary: string
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
  /** Internal obligation/receipt closure is distinct from user-facing delivery. */
  readonly internalClosureReady: boolean
  readonly responseDelivered: boolean
  readonly requiredObligationsSatisfied: boolean
  readonly unclosedObligations: ObligationId[]
  readonly finalReceipt?: ReceiptId | null
  readonly timestamp: string
  readonly blockers: readonly string[]
  readonly structuredBlockers: readonly CompletionBlocker[]
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
      `Unsupported ACCP version '${envelope.accpVersion}', expected ${ACCP_VERSION}`,
    )
  }

  if (!envelope.messageId?.trim() || !envelope.kind?.trim()) {
    throw new RivetError("SemanticViolation", "ACCP envelope requires messageId and kind")
  }

  if (typeof envelope.payload !== "object" || envelope.payload === null) {
    throw new RivetError("SemanticViolation", "ACCP envelope payload must be an object")
  }

  if (!isKindValidForFamily(envelope.family, envelope.kind)) {
    throw new RivetError("SemanticViolation", `ACCP kind '${envelope.kind}' is not valid for family ${envelope.family}`)
  }

  const controllerAllowed = envelope.family === "QUERY" || envelope.family === "PROPOSAL"
  const harnessAllowed =
    envelope.family === "VIEW" ||
    envelope.family === "DECISION" ||
    envelope.family === "RECEIPT" ||
    envelope.family === "SIGNAL"

  const isAllowed = envelope.sender === "COGNITIVE_CONTROLLER" ? controllerAllowed : harnessAllowed

  if (!isAllowed) {
    throw new RivetError("SemanticViolation", `${envelope.sender} cannot emit ${envelope.family} message`)
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
    policy: ActionAuthorizationPolicy,
  ): { readonly authorizedAction: AuthorizedAction | null; readonly decision: ActionDecision } {
    const decision = this.authorizeAction(proposal, policy)
    if (decision.verdict === "allow") {
      return {
        authorizedAction: {
          [AuthorizedActionTypeId]: true,
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

  static authorizeAction(proposal: ActionProposal, policy: ActionAuthorizationPolicy): ActionDecision {
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

    const violation = authorityViolation(proposal, policy)
    if (violation) {
      return blocked("block", `Action target or declared scope is outside Harness authority (${violation})`)
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

  static getClosureRequirement(kind: ObligationKind): {
    readonly requiredProofKind: string
    readonly verifier: ObligationVerifier
    readonly praxisRequired: boolean
    readonly actionableGuidance: string
  } {
    switch (kind) {
      case "epistemic_inquiry":
        return {
          requiredProofKind: "AUTHORITATIVE_STATE_PROJECTION",
          verifier: "NOESIS",
          praxisRequired: false,
          actionableGuidance: "Call query_epistemic_state to ground state. Praxis verification is NOT required.",
        }
      case "execution":
        return {
          requiredProofKind: "EXECUTION_RECEIPT + PRAXIS_VERIFICATION_RECEIPT",
          verifier: "PRAXIS",
          praxisRequired: true,
          actionableGuidance: "Execute required command or edits, then call request_verification for Praxis receipt.",
        }
      case "verification":
        return {
          requiredProofKind: "PRAXIS_VERIFICATION_RECEIPT",
          verifier: "PRAXIS",
          praxisRequired: true,
          actionableGuidance: "Call request_verification against bounded predicate.",
        }
      case "user_input":
        return {
          requiredProofKind: "USER_INPUT_RECORD",
          verifier: "HARNESS",
          praxisRequired: false,
          actionableGuidance: "Wait for or request user input.",
        }
      case "artifact":
        return {
          requiredProofKind: "ARTIFACT_RECORD",
          verifier: "HARNESS",
          praxisRequired: false,
          actionableGuidance: "Produce and save the required artifact.",
        }
      case "state_mutation":
        return {
          requiredProofKind: "STATE_TRANSITION_RECEIPT",
          verifier: "HARNESS",
          praxisRequired: false,
          actionableGuidance: "Perform authorized state transition and advance revision.",
        }
    }
  }

  static checkCompletionReadiness(input: {
    readonly unclosedObligations: readonly ObligationId[]
    readonly passingReceipts: readonly ReceiptId[]
    readonly hasContradictions?: boolean
    readonly getKind?: (id: ObligationId) => ObligationKind
    readonly getDescription?: (id: ObligationId) => string
    readonly totalObligations?: number
    readonly hasActiveGoal?: boolean
  }): CompletionReadiness {
    if (input.hasActiveGoal === false) {
      return {
        status: "NOT_REQUIRED",
        blockers: [],
        structuredBlockers: [],
      }
    }

    const blockers: string[] = []
    const structuredBlockers: CompletionBlocker[] = []

    if (input.hasContradictions) {
      const reason = "Active premise contradictions detected in HardState"
      blockers.push(reason)
      structuredBlockers.push({
        reason,
        actionableGuidance: "Resolve contradiction before requesting completion.",
      })
    }

    for (const id of input.unclosedObligations) {
      const kind = input.getKind?.(id) ?? "execution"
      const desc = input.getDescription?.(id) ?? id
      const closure = AccpSemanticGate.getClosureRequirement(kind)
      const reason = `Obligation [${id}] "${desc}" requires ${closure.requiredProofKind} (${closure.verifier})`
      blockers.push(reason)
      structuredBlockers.push({
        obligationId: id,
        kind,
        reason,
        verifier: closure.verifier,
        requiredProofKind: closure.requiredProofKind,
        actionableGuidance: closure.actionableGuidance,
      })
    }

    const totalObligations =
      input.totalObligations ??
      (input.hasActiveGoal ? 1 : input.unclosedObligations.length + input.passingReceipts.length)

    if (totalObligations > 0 && input.unclosedObligations.length === 0 && input.passingReceipts.length === 0) {
      const reason = "No passing closure receipts admitted for task"
      blockers.push(reason)
      structuredBlockers.push({
        reason,
        actionableGuidance: "Execute required action or epistemic query to admit closure receipt.",
      })
    }

    return {
      status: blockers.length === 0 ? "READY" : "BLOCKED",
      blockers,
      structuredBlockers,
    }
  }

  /**
   * Authority for model-proposed obligation invalidation.
   *
   * Fail-closed: only mechanically malformed file constraints (compiler
   * artifacts whose path token is not a well-formed workspace path) may be
   * invalidated. Substantive obligations keep their declared verifier; the
   * model may not mint its own closure by waiving them.
   */
  static checkInvalidationAuthority(predicate: ObligationPredicate | undefined): {
    readonly allowed: boolean
    readonly reason: string
  } {
    if (predicate === undefined) {
      return {
        allowed: false,
        reason:
          "no machine-decidable predicate is attached to this obligation; close it through its declared verifier or ask the user to revise the goal",
      }
    }
    if (predicate.type === "file_constraint" && !isValidFilePathCandidate(predicate.path)) {
      return {
        allowed: true,
        reason: `path constraint '${predicate.path}' is not a well-formed workspace path (compiler artifact); invalidation is auditable`,
      }
    }
    return {
      allowed: false,
      reason: `predicate '${predicate.type}' is a substantive contract; it must be closed through its declared verifier (Praxis receipt or authoritative projection), never waived by the model`,
    }
  }

  static checkCompletionAuthority(unclosedObligations: readonly ObligationId[]): void {
    if (unclosedObligations.length > 0) {
      throw new RivetError(
        "SemanticViolation",
        `Cannot complete task: ${unclosedObligations.length} obligations remain unverified`,
      )
    }
  }

  static evaluateCompletion(
    proposal: CompletionProposal,
    currentRevision: Revision,
    unclosedObligations: readonly ObligationId[],
    passingReceipts: readonly ReceiptId[],
    obligationContext?: {
      readonly getKind?: (id: ObligationId) => ObligationKind
      readonly getDescription?: (id: ObligationId) => string
    },
    responseDelivered = true,
    expectedTaskId?: TaskId | null,
  ): CompletionDecision {
    const obligationsSatisfied = unclosedObligations.length === 0
    const revisionMatches = proposal.baseRevision.equals(currentRevision)
    const hasPassingReceipts = passingReceipts.length > 0
    const taskMatches = expectedTaskId === undefined || expectedTaskId === null || proposal.taskId === expectedTaskId
    const internalClosureReady = obligationsSatisfied && revisionMatches && hasPassingReceipts && taskMatches
    const completed = internalClosureReady && responseDelivered

    const blockers: string[] = []
    const structuredBlockers: CompletionBlocker[] = []

    if (!revisionMatches) {
      const reason = `Base revision ${proposal.baseRevision} does not match current state revision ${currentRevision}`
      blockers.push(reason)
      structuredBlockers.push({
        reason,
        actionableGuidance: "Refresh cognitive view to align with current state revision.",
      })
    }

    if (!taskMatches) {
      const reason = `Completion task ${proposal.taskId} does not match the active task ${expectedTaskId}`
      blockers.push(reason)
      structuredBlockers.push({
        reason,
        actionableGuidance: "Use completion evidence from the active task only.",
      })
    }

    if (!obligationsSatisfied) {
      for (const id of unclosedObligations) {
        const kind = obligationContext?.getKind?.(id) ?? "execution"
        const desc = obligationContext?.getDescription?.(id) ?? id
        const closure = AccpSemanticGate.getClosureRequirement(kind)
        const reason = `Obligation [${id}] "${desc}" remains open (${kind})`
        blockers.push(`${reason}. Requires ${closure.requiredProofKind} via ${closure.verifier}.`)
        structuredBlockers.push({
          obligationId: id,
          kind,
          reason,
          verifier: closure.verifier,
          requiredProofKind: closure.requiredProofKind,
          actionableGuidance: closure.actionableGuidance,
        })
      }
    }

    if (obligationsSatisfied && revisionMatches && !hasPassingReceipts) {
      const reason = "No passing closure receipts recorded for task completion"
      blockers.push(reason)
      structuredBlockers.push({
        reason,
        actionableGuidance: "Ensure required verification or epistemic query is recorded before completion.",
      })
    }

    if (internalClosureReady && !responseDelivered) {
      const reason = "User-facing response has not been delivered"
      blockers.push(reason)
      structuredBlockers.push({
        reason,
        actionableGuidance: "Emit the requested answer before accepting internal completion.",
      })
    }

    return {
      taskId: proposal.taskId,
      completed,
      internalClosureReady,
      responseDelivered,
      requiredObligationsSatisfied: obligationsSatisfied && revisionMatches,
      unclosedObligations: [...unclosedObligations],
      finalReceipt: completed ? (passingReceipts[passingReceipts.length - 1] ?? null) : null,
      timestamp: new Date().toISOString(),
      blockers,
      structuredBlockers,
    }
  }
}

/**
 * Which authority predicate failed, reported without echoing target or root
 * strings back into the decision reason. Fails closed: any target that cannot
 * be canonicalized to a repository-relative identity is a violation.
 */
function authorityViolation(proposal: ActionProposal, policy: ActionAuthorizationPolicy): string | undefined {
  if (proposal.scope.repository !== policy.repository) {
    return "declared scope repository does not match Harness repository"
  }
  if (!policy.allowedScope.containsScope(proposal.scope)) {
    return "declared scope is not contained in Harness allowed scope"
  }
  const canonicalTarget = canonicalRepositoryPath(policy.repository, proposal.target)
  if (canonicalTarget === undefined) {
    return "target cannot be established as repository-local under the Harness repository root"
  }
  if (!policy.allowedScope.allowsPath(policy.repository, canonicalTarget, policy.currentRevision)) {
    return "canonicalized target is outside Harness allowed scope"
  }
  return undefined
}

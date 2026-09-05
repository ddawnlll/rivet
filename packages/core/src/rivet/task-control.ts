import type { VerificationReceipt } from "./accp"
import type { ObligationPredicate } from "./goal-compiler"
import {
  createFocusId,
  createRecoveryId,
  type EvidenceId,
  type ExecutionFocus,
  type FailureClass,
  type FocusContract,
  type FocusId,
  type ObligationId,
  type RecoveryFrame,
  type RecoveryVerificationReceipt,
  type TaskId,
} from "./types"

const DEFAULT_EFFORT_BUDGET = 5

export class TaskControlController {
  static compileContract(input: {
    readonly objective: string
    readonly predicate?: ObligationPredicate
    readonly allowedScope: readonly string[]
    readonly requiredEvidence?: readonly EvidenceId[]
    readonly relevantEvidence?: readonly EvidenceId[]
    readonly effortBudget?: number
  }): FocusContract {
    const requiredEvidence = input.requiredEvidence?.map(String) ?? [
      input.predicate ? `evidence:${input.predicate.type}` : "evidence:verifier-decision",
    ]
    return {
      objective: input.objective,
      acceptanceCriteria: input.predicate
        ? [describeContractPredicate(input.predicate)]
        : ["The stated objective is mechanically verified"],
      allowedScope: [...input.allowedScope],
      requiredEvidence,
      relevantEvidence: input.relevantEvidence?.map(String),
      effortBudget: input.effortBudget ?? DEFAULT_EFFORT_BUDGET,
      verificationPolicy: {
        minimumEvidence: Math.max(1, requiredEvidence.length),
        sufficientWhen: input.predicate
          ? `Praxis passes ${describeContractPredicate(input.predicate)}`
          : "The declared verifier passes the focus acceptance criteria",
        escalationConditions: [
          "Evidence conflicts with the active Hard State revision",
          "The verifier reports a new failure class",
        ],
      },
    }
  }

  static obligationFocus(input: {
    readonly taskId: TaskId
    readonly obligationId: ObligationId
    readonly objective: string
    readonly predicate?: ObligationPredicate
    readonly repository: string
    readonly pathPattern?: string | null
    readonly reason?: string
  }): ExecutionFocus {
    const allowedScope = [
      input.pathPattern ? `${input.repository}:${input.pathPattern}` : input.repository,
      "ACCP-authorized capabilities only",
    ]
    const contract = this.compileContract({
      objective: input.objective,
      predicate: input.predicate,
      allowedScope,
    })
    return {
      id: createFocusId(),
      taskId: input.taskId,
      kind: "obligation",
      targetObligationId: input.obligationId,
      objective: input.objective,
      reason: input.reason ?? "Selected from the active task ready frontier",
      acceptanceCriteria: contract.acceptanceCriteria,
      boundary: contract.allowedScope,
      requiredEvidence: contract.requiredEvidence,
      effortBudget: contract.effortBudget,
      contract,
      createdAt: new Date().toISOString(),
    }
  }

  static recoveryFocus(input: {
    readonly taskId: TaskId
    readonly parentFocusId: FocusId
    readonly targetObligationId: ObligationId
    readonly resumeTarget: FocusId
    readonly failureClass: FailureClass
    readonly objective: string
    readonly acceptanceCriteria: readonly string[]
    readonly allowedScope: readonly string[]
    readonly budget?: number
  }): { readonly frame: RecoveryFrame; readonly focus: ExecutionFocus } {
    const frame: RecoveryFrame = {
      id: createRecoveryId(),
      taskId: input.taskId,
      failureClass: input.failureClass,
      parentFocusId: input.parentFocusId,
      targetObligationId: input.targetObligationId,
      objective: input.objective,
      acceptanceCriteria: [...input.acceptanceCriteria],
      resumeTarget: input.resumeTarget,
      admittedInterventions: admittedInterventions(input.failureClass),
      budget: input.budget ?? DEFAULT_EFFORT_BUDGET,
      status: "open",
      createdAt: new Date().toISOString(),
    }
    const contract = this.compileContract({
      objective: input.objective,
      allowedScope: input.allowedScope,
      effortBudget: frame.budget,
    })
    return {
      frame,
      focus: {
        id: createFocusId(),
        taskId: input.taskId,
        kind: "recovery",
        targetObligationId: input.targetObligationId,
        parentFocusId: input.parentFocusId,
        objective: input.objective,
        reason: `Selective recovery for ${input.failureClass}`,
        acceptanceCriteria: [...input.acceptanceCriteria],
        boundary: [...input.allowedScope],
        effortBudget: frame.budget,
        resumeTarget: input.resumeTarget,
        contract: { ...contract, acceptanceCriteria: [...input.acceptanceCriteria] },
        createdAt: frame.createdAt,
      },
    }
  }

  static requirePassingVerification(receipt: VerificationReceipt, obligationId: ObligationId) {
    if (!receipt.passed || receipt.obligationId !== obligationId) {
      throw new Error(`Task-control transition requires passing verification for ${obligationId}`)
    }
    return receipt
  }

  static requirePassingRecoveryVerification(receipt: RecoveryVerificationReceipt, recoveryId: RecoveryFrame["id"]) {
    if (!receipt.passed || receipt.recoveryId !== recoveryId || receipt.verifier !== "PRAXIS") {
      throw new Error(`Recovery transition requires a passing Praxis decision for ${recoveryId}`)
    }
    return receipt
  }
}

export function admittedInterventions(failureClass: FailureClass): readonly string[] {
  return {
    transient_tool: ["retry_once", "repair_tool_arguments"],
    execution_error: ["inspect_diagnostics", "correct_command_or_inputs"],
    verification_gap: ["collect_required_evidence", "run_declared_verifier"],
    environment_blocker: ["correct_working_directory", "restore_declared_dependencies"],
    procedure_gap: ["add_missing_fixture", "repair_documented_procedure"],
    authorization_blocker: ["request_required_authorization", "narrow_scope"],
    stagnation: ["strategy_redirect", "choose_different_admitted_intervention"],
    user_input_required: ["request_specific_user_decision"],
  }[failureClass]
}

export function diagnoseFailure(reasonCodes: readonly string[], diagnostics?: string | null): FailureClass {
  const text = `${reasonCodes.join(" ")} ${diagnostics ?? ""}`.toUpperCase()
  if (text.includes("AUTH") || text.includes("PERMISSION")) return "authorization_blocker"
  if (text.includes("PATH_ESCAPES") || text.includes("CWD") || text.includes("DEPENDENCY")) {
    return "environment_blocker"
  }
  if (text.includes("TIMEOUT") || text.includes("RATE_LIMIT") || text.includes("TEMPORAR")) return "transient_tool"
  if (text.includes("CLAIM_NOT_ADMITTED") || text.includes("EVIDENCE")) return "verification_gap"
  if (text.includes("FIXTURE") || text.includes("PROCEDURE")) return "procedure_gap"
  if (text.includes("USER_INPUT") || text.includes("DECISION REQUIRED")) return "user_input_required"
  if (text.includes("STAGN")) return "stagnation"
  return "execution_error"
}

export function evidenceIsSufficient(focus: ExecutionFocus, evidenceRefs: readonly string[]) {
  const uniqueEvidence = new Set(evidenceRefs)
  return {
    sufficient: uniqueEvidence.size >= focus.contract.verificationPolicy.minimumEvidence,
    observed: uniqueEvidence.size,
    required: focus.contract.verificationPolicy.minimumEvidence,
  }
}

function describeContractPredicate(predicate: ObligationPredicate) {
  switch (predicate.type) {
    case "command_pass":
      return `command_pass: ${predicate.command} exits ${predicate.expectedExitCode}`
    case "file_constraint":
      return `file_constraint: ${predicate.path} mustExist=${predicate.mustExist}`
    case "claims_verified":
      return `claims_verified: ${predicate.claimPropositions.join("; ")}`
    case "human_approval":
      return "human_approval: explicit user approval required"
  }
}

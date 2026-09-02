import {
  type ActionProposal,
  type ActionRisk,
  type ClaimProposal,
  type CompletionProposal,
  type StateTransitionProposal,
  type VerificationRequest,
  createActionProposal,
} from "../rivet/accp"
import {
  type ClaimId,
  type EvidenceId,
  type ObligationId,
  Revision,
  Scope,
  createActionId,
  createClaimId,
  createObligationId,
  createTaskId,
} from "../rivet/types"

/** Provider output is transport input and may not cross the executor boundary. */
export interface ProviderToolFrame {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

export type CognitiveCommitment =
  | { readonly type: "thought"; readonly thought: string }
  | { readonly type: "action_proposal"; readonly proposal: ActionProposal }
  | { readonly type: "claim_proposal"; readonly proposal: ClaimProposal }
  | { readonly type: "verification_request"; readonly request: VerificationRequest }
  | { readonly type: "state_transition_proposal"; readonly proposal: StateTransitionProposal }
  | { readonly type: "completion_proposal"; readonly proposal: CompletionProposal }
  | { readonly type: "epistemic_query"; readonly includeFrontier: boolean }

/**
 * Decode provider-native tool frames into Rivet commitments. This is the
 * transport boundary: callers receive a proposal/commitment, never a raw
 * provider tool call that could be passed to an executor.
 */
export function parseProviderToolFrame(frame: ProviderToolFrame, scope: Scope): CognitiveCommitment {
  const args = isRecord(frame.input) ? frame.input : {}
  switch (frame.name) {
    case "thought":
    case "think":
      return { type: "thought", thought: stringValue(args.thought) ?? JSON.stringify(args) }
    case "propose_claim":
    case "claim":
      return {
        type: "claim_proposal",
        proposal: {
          claimId: createClaimId(),
          proposition: stringValue(args.proposition) ?? "",
          proposedStatus: "supported",
          supportingEvidence: evidenceIds(args.supporting_evidence),
          scope,
          timestamp: new Date().toISOString(),
        },
      }
    case "request_verification":
    case "verify":
      return {
        type: "verification_request",
        request: {
          obligationId: obligationId(args),
          predicate: stringValue(args.predicate) ?? "bun test",
          targetScope: scope,
          timeoutSeconds: numberValue(args.timeout_seconds) ?? 30,
          timestamp: new Date().toISOString(),
        },
      }
    case "request_completion":
    case "complete":
      return {
        type: "completion_proposal",
        proposal: {
          taskId: createTaskId(),
          summary: stringValue(args.summary) ?? "Completed task",
          claimsAddressed: claimIds(args.claims_addressed),
          baseRevision: scope.revision,
          timestamp: new Date().toISOString(),
        },
      }
    case "query_epistemic_state":
    case "query_state":
      return {
        type: "epistemic_query",
        includeFrontier: Boolean(args.include_frontier),
      }
    default:
      return {
        type: "action_proposal",
        proposal: createActionProposal({
          actionId: createActionId(frame.id),
          providerName: frame.name,
          capability: capabilityFor(frame.name),
          target: targetFor(frame.name, args),
          parameters: args,
          estimatedRisk: riskFor(frame.name, args),
          intent: intentFor(frame.name, args),
          scope,
          idempotencyKey: frame.id,
        }),
      }
  }
}

function capabilityFor(name: string) {
  if (["read", "view_file", "grep", "find"].includes(name)) return "file.read"
  if (["edit", "write", "replace_file_content", "write_to_file"].includes(name)) return "file.write"
  if (["bash", "run_command", "exec"].includes(name)) return "process.exec"
  return `tool.${name}`
}

function targetFor(name: string, args: Record<string, unknown>) {
  if (["bash", "run_command", "exec"].includes(name)) return stringValue(args.command) ?? "command"
  return (
    stringValue(args.path) ??
    stringValue(args.filePath) ??
    stringValue(args.target) ??
    stringValue(args.file) ??
    "src"
  )
}

function riskFor(name: string, args: Record<string, unknown>): ActionRisk {
  if (["read", "view_file", "grep", "find"].includes(name)) return "inspect"
  if (!["bash", "run_command", "exec"].includes(name)) return "material"
  const command = stringValue(args.command) ?? ""
  if (/git\s+reset\s+--hard|rm\s+-rf\s+\//.test(command)) return "destructive"
  if (/^(bun|cargo)\s+test\b|^(ls|cat)\b/.test(command)) return "inspect"
  return "material"
}

function intentFor(name: string, args: Record<string, unknown>) {
  const target = targetFor(name, args)
  return name === "edit" || name === "write" ? `Modify ${target}` : `Execute ${name}`
}

function obligationId(args: Record<string, unknown>): ObligationId {
  const value = stringValue(args.obligation_id) ?? stringValue(args.obligationId)
  return value ? (value as ObligationId) : createObligationId()
}

function evidenceIds(value: unknown): EvidenceId[] {
  return Array.isArray(value) ? value.filter(isString).map((item) => item as EvidenceId) : []
}

function claimIds(value: unknown): ClaimId[] {
  return Array.isArray(value) ? value.filter(isString).map((item) => item as ClaimId) : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

export type { CognitiveCommitment as CognitiveAction }
export { Revision }

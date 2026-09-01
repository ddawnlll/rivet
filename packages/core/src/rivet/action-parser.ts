import {
  type ActionProposal,
  type ClaimProposal,
  type CompletionProposal,
  type StateTransitionProposal,
  type VerificationRequest,
  type ActionRisk,
  createActionProposal,
} from "./accp"
import {
  Revision,
  Scope,
  createActionId,
  createClaimId,
  createObligationId,
  createTaskId,
} from "./types"

export type CognitiveAction =
  | { readonly type: "thought"; readonly thought: string }
  | { readonly type: "action_proposal"; readonly proposal: ActionProposal }
  | { readonly type: "claim_proposal"; readonly proposal: ClaimProposal }
  | { readonly type: "verification_request"; readonly request: VerificationRequest }
  | { readonly type: "state_transition_proposal"; readonly proposal: StateTransitionProposal }
  | { readonly type: "completion_proposal"; readonly proposal: CompletionProposal }

export class CognitiveActionParser {
  static parseFromToolCall(
    toolName: string,
    args: Record<string, unknown>,
    scope: Scope
  ): CognitiveAction {
    switch (toolName) {
      case "thought":
      case "think": {
        const thought = typeof args.thought === "string" ? args.thought : JSON.stringify(args)
        return { type: "thought", thought }
      }
      case "propose_claim":
      case "claim": {
        const proposition = typeof args.proposition === "string" ? args.proposition : ""
        const supportingEvidence = Array.isArray(args.supporting_evidence)
          ? (args.supporting_evidence as any[])
          : []
        return {
          type: "claim_proposal",
          proposal: {
            claimId: createClaimId(),
            proposition,
            proposedStatus: "supported",
            supportingEvidence,
            scope,
            timestamp: new Date().toISOString(),
          },
        }
      }
      case "request_verification":
      case "verify": {
        const predicate = typeof args.predicate === "string" ? args.predicate : "bun test"
        const obligationId =
          typeof args.obligation_id === "string" || typeof args.obligationId === "string"
            ? ((args.obligation_id || args.obligationId) as any)
            : createObligationId()
        const timeoutSeconds =
          typeof args.timeout_seconds === "number" ? args.timeout_seconds : 30
        return {
          type: "verification_request",
          request: {
            obligationId,
            predicate,
            targetScope: scope,
            timeoutSeconds,
            timestamp: new Date().toISOString(),
          },
        }
      }
      case "request_completion":
      case "complete": {
        const summary = typeof args.summary === "string" ? args.summary : "Completed task"
        const claimsAddressed = Array.isArray(args.claims_addressed)
          ? (args.claims_addressed as any[])
          : []
        return {
          type: "completion_proposal",
          proposal: {
            taskId: createTaskId(),
            summary,
            claimsAddressed,
            baseRevision: scope.revision,
            timestamp: new Date().toISOString(),
          },
        }
      }
      default: {
        // Map commodity OpenCode / standard tools into ACCP ActionProposal
        let capability = `tool.${toolName}`
        let target = (args.path || args.filePath || args.target || args.file || "src") as string
        let risk: ActionRisk = "inspect"
        let intent = `Execute ${toolName}`

        if (toolName === "read" || toolName === "view_file" || toolName === "grep" || toolName === "find") {
          capability = "file.read"
          risk = "inspect"
        } else if (toolName === "edit" || toolName === "write" || toolName === "replace_file_content" || toolName === "write_to_file") {
          capability = "file.write"
          risk = "material"
          intent = `Modify ${target}`
        } else if (toolName === "bash" || toolName === "run_command" || toolName === "exec") {
          capability = "process.exec"
          const cmd = (args.command || args.CommandLine || "") as string
          target = cmd || "command"
          if (cmd.includes("git reset --hard") || cmd.includes("rm -rf /")) {
            risk = "destructive"
          } else if (cmd.startsWith("bun test") || cmd.startsWith("cargo test") || cmd.startsWith("ls") || cmd.startsWith("cat")) {
            risk = "inspect"
          } else {
            risk = "material"
          }
          intent = `Run command: ${cmd}`
        }

        return {
          type: "action_proposal",
          proposal: createActionProposal({
            capability,
            target: typeof target === "string" ? target : JSON.stringify(target),
            parameters: args,
            estimatedRisk: risk,
            intent,
            scope,
          }),
        }
      }
    }
  }
}

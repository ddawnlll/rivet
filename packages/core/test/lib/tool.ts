import { AgentV2 } from "@opencode-ai/core/agent"
import { AccpSemanticGate } from "@opencode-ai/core/rivet/accp"
import { Revision, Scope, createActionId } from "@opencode-ai/core/rivet/types"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { type ToolCall } from "@opencode-ai/llm"
import { Effect } from "effect"

export const toolIdentity = {
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_tool_test"),
}

export const toolDefinitions = (
  registry: ToolRegistry.Interface,
  permissions?: Parameters<typeof registry.materialize>[0],
) => registry.materialize(permissions).pipe(Effect.map((materialized) => materialized.definitions))

type LegacyToolInput = Omit<ToolRegistry.AuthorizedExecution, "action"> & { readonly call: ToolCall }

export const authorizedExecution = (input: LegacyToolInput): ToolRegistry.AuthorizedExecution => {
  const scope = Scope.global("repo", Revision.ZERO)
  const proposal = {
    actionId: createActionId(`test-${input.call.id}`),
    providerName: input.call.name,
    capability: `tool.${input.call.name}`,
    target: "test",
    parameters:
      typeof input.call.input === "object" && input.call.input !== null
        ? (input.call.input as Record<string, unknown>)
        : {},
    estimatedRisk: "inspect" as const,
    intent: `Test ${input.call.name}`,
    scope,
    idempotencyKey: input.call.id,
    timestamp: new Date().toISOString(),
  }
  const authorization = AccpSemanticGate.authorize(proposal, {
    repository: "repo",
    currentRevision: Revision.ZERO,
    allowedScope: scope,
    allowedCapabilities: ["file.read", "file.write", "process.exec", "tool.*"],
    allowMaterial: true,
    humanApproved: true,
  })
  if (!authorization.authorizedAction) throw new Error(authorization.decision.reason)
  return { ...input, action: authorization.authorizedAction }
}

type ToolInput = LegacyToolInput | ToolRegistry.AuthorizedExecution

const asAuthorizedExecution = (input: ToolInput) =>
  "action" in input ? input : authorizedExecution(input)

export const settleTool = (registry: ToolRegistry.Interface, input: ToolInput) =>
  registry.materialize().pipe(
    Effect.flatMap((materialized) => materialized.settle(asAuthorizedExecution(input))),
    // Existing tool behavior tests assert the substrate-facing settlement shape.
    // Receipt assertions belong to the semantic architecture tests.
    Effect.map(({ receipt: _receipt, ...settlement }) => settlement),
  )

export const executeTool = (registry: ToolRegistry.Interface, input: ToolInput) =>
  settleTool(registry, input).pipe(Effect.map((settlement) => settlement.result))

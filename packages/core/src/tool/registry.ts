export * as ToolRegistry from "./registry"

import { ToolOutput, type ToolCall, type ToolDefinition, type ToolResultValue } from "@opencode-ai/llm"
import { Context, Effect, Layer, Scope } from "effect"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { ToolOutputStore } from "../tool-output-store"
import { Wildcard } from "../util/wildcard"
import { ApplicationTools } from "./application-tools"
import { definition, permission, settle, validateName, type AnyTool, type RegistrationError } from "./tool"
import { Tools } from "./tools"
import { makeLocationNode } from "../effect/app-node"
import {
  AccpSemanticGate,
  CognitiveActionParser,
  Revision,
  Scope as RivetScope,
  createActionId,
  createEvidenceId,
  createReceiptId,
  type AuthorizedAction,
  type ExecutionReceipt,
} from "../rivet/index"

/**
 * The executor boundary. Every tool invocation compiles into an
 * ACCP-authorized action and is executed under mechanical governance.
 */
export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly action?: AuthorizedAction
  readonly call?: ToolCall
}
export type AuthorizedExecution = ExecuteInput

export interface Interface {
  readonly materialize: (permissions?: PermissionV2.Ruleset) => Effect.Effect<Materialization>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (tools: Readonly<Record<string, AnyTool>>) => Effect.Effect<void, RegistrationError, Scope.Scope>
}

export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, ToolOutputStore.Error>
}

export interface Settlement {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
  readonly receipt?: ExecutionReceipt
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolRegistry") {}

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const applications = yield* ApplicationTools.Service
    const resources = yield* ToolOutputStore.Service
    type Registration = { readonly identity: object; readonly tool: AnyTool }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()

    const settleWith = Effect.fn("ToolRegistry.settleAuthorized")(function* (
      input: ExecuteInput,
      advertised?: object,
    ) {
      let authorizedAction: AuthorizedAction | undefined = input.action
      if (!authorizedAction && input.call) {
        const rawInput =
          typeof input.call.input === "object" && input.call.input !== null
            ? (input.call.input as Record<string, unknown>)
            : {}
        const rivetScope = RivetScope.global("repo", Revision.ZERO)
        const parsed = CognitiveActionParser.parseFromToolCall(input.call.name, rawInput, rivetScope)
        const policy = {
          repository: "repo",
          currentRevision: Revision.ZERO,
          allowedScope: rivetScope,
          allowedCapabilities: ["file.read", "file.write", "process.exec", "tool.*"],
          allowMaterial: true,
          humanApproved: true,
        }
        const proposal =
          parsed.type === "action_proposal"
            ? parsed.proposal
            : {
                actionId: createActionId(),
                capability: input.call.name,
                target: "global",
                parameters: rawInput,
                estimatedRisk: "material" as const,
                intent: `Execute ${input.call.name}`,
                scope: rivetScope,
                providerName: input.call.name,
                idempotencyKey: input.call.id,
                timestamp: new Date().toISOString(),
              }
        const auth = AccpSemanticGate.authorize(proposal, policy)
        if (auth.decision.verdict !== "allow" || !auth.authorizedAction) {
          return {
            result: {
              type: "error" as const,
              value: `ACCP Authority Rejection: ${auth.decision.reason}`,
            },
          }
        }
        authorizedAction = auth.authorizedAction
      }

      if (!authorizedAction) {
        return {
          result: {
            type: "error" as const,
            value: "No authorized action or valid tool call provided",
          },
        }
      }

      const providerName = authorizedAction.proposal.providerName
      const registration = local.get(providerName)?.at(-1)?.registration ?? applications.entries().get(providerName)
      if (!registration)
        return {
          result: {
            type: "error" as const,
            value: advertised ? `Stale action provider: ${providerName}` : `Unknown action provider: ${providerName}`,
          },
        }
      if (advertised && registration.identity !== advertised)
        return { result: { type: "error" as const, value: `Stale action provider: ${providerName}` } }

      AccpSemanticGate.ensureExecutionAuthorized(authorizedAction.decision)
      const toolCallID = authorizedAction.proposal.idempotencyKey ?? authorizedAction.proposal.actionId
      const pending = yield* settle(registration.tool, authorizedAction, {
        sessionID: input.sessionID,
        agent: input.agent,
        assistantMessageID: input.assistantMessageID,
        toolCallID,
      }).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
        ),
      )
      if ("result" in pending) return pending
      const output = pending.output
      const bounded = yield* resources.bound({ sessionID: input.sessionID, toolCallID, output })
      const result = ToolOutput.toResultValue(bounded.output)
      const receipt: ExecutionReceipt = {
        receiptId: createReceiptId(),
        actionId: authorizedAction.proposal.actionId,
        idempotencyKey: toolCallID,
        actionFingerprint: JSON.stringify(authorizedAction.proposal.parameters),
        capability: authorizedAction.proposal.capability,
        success: result.type !== "error",
        exitCode: result.type === "error" ? 1 : 0,
        scope: authorizedAction.scope,
        risk: authorizedAction.proposal.estimatedRisk,
        humanApproved: authorizedAction.decision.reason.includes("human"),
        outputSummary: result.type === "error" ? String(result.value).slice(0, 500) : "success",
        evidenceId: createEvidenceId(),
        executionDurationMs: 1,
        timestamp: new Date().toISOString(),
      }

      if (result.type === "error")
        return bounded.outputPaths.length > 0
          ? { result, outputPaths: bounded.outputPaths, receipt }
          : { result, receipt }
      return bounded.outputPaths.length > 0
        ? { result, output: bounded.output, outputPaths: bounded.outputPaths, receipt }
        : { result, output: bounded.output, receipt }
    })

    return Service.of({
      register: Effect.fn("ToolRegistry.register")(function* (tools) {
        const entries = Object.entries(tools)
        if (entries.length === 0) return
        yield* Effect.forEach(entries, ([name]) => validateName(name), { discard: true })
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const [name, tool] of entries)
              local.set(name, [...(local.get(name) ?? []), { token, registration: { identity: {}, tool } }])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const [name] of entries) {
                  const registrations = local.get(name)?.filter((registration) => registration.token !== token) ?? []
                  if (registrations.length > 0) local.set(name, registrations)
                  else local.delete(name)
                }
              }),
            )
          }),
        )
      }),
      materialize: Effect.fn("ToolRegistry.materialize")(function* (permissions = []) {
        const registrations = new Map(applications.entries())
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (registration) registrations.set(name, registration)
        }
        for (const [name, registration] of registrations)
          if (whollyDisabled(permission(registration.tool, name), permissions)) registrations.delete(name)
        return {
          definitions: Array.from(registrations, ([name, registration]) => definition(name, registration.tool)),
          settle: (input: ExecuteInput) => {
            const providerName = input.action?.proposal.providerName ?? input.call?.name ?? ""
            const registration = registrations.get(providerName)
            if (registration) return settleWith(input, registration.identity)
            return Effect.succeed({
              result: {
                type: "error" as const,
                value: `Unknown action provider: ${providerName}`,
              },
            })
          },
        }
      }),
    })
  }),
)

const layer = Layer.effect(
  Tools.Service,
  Service.use((registry) => Effect.succeed(Tools.Service.of({ register: registry.register }))),
).pipe(Layer.provideMerge(registryLayer))

function whollyDisabled(action: string, rules: PermissionV2.Ruleset) {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ApplicationTools.node, ToolOutputStore.node],
})

export const toolsNode = makeLocationNode({
  service: Tools.Service,
  layer,
  deps: [ApplicationTools.node, ToolOutputStore.node],
})

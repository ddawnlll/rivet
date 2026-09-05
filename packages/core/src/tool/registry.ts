export * as ToolRegistry from "./registry"

import { ToolOutput, type ToolDefinition, type ToolResultValue } from "@opencode-ai/llm"
import { Context, Duration, Effect, Layer, Scope } from "effect"
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
  createEvidenceId,
  createReceiptId,
  type AuthorizedAction,
  type ExecutionReceipt,
} from "../rivet/index"

/**
 * The executor boundary. Every tool invocation compiles into an
 * ACCP-authorized action and is executed under mechanical governance.
 */
export type AuthorizedExecution = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly action: AuthorizedAction
}
export interface Interface {
  readonly materialize: (permissions?: PermissionV2.Ruleset) => Effect.Effect<Materialization>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (tools: Readonly<Record<string, AnyTool>>) => Effect.Effect<void, RegistrationError, Scope.Scope>
}

export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: AuthorizedExecution) => Effect.Effect<Settlement, ToolOutputStore.Error>
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
      input: AuthorizedExecution,
      advertised?: object,
    ) {
      AccpSemanticGate.ensureExecutionAuthorized(input.action.decision)
      const providerName = input.action.proposal.providerName
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

      const toolCallID = input.action.proposal.idempotencyKey ?? input.action.proposal.actionId
      const failureReceipt = (message: string): ExecutionReceipt => ({
        receiptId: createReceiptId(),
        actionId: input.action.proposal.actionId,
        idempotencyKey: toolCallID,
        actionFingerprint: JSON.stringify(input.action.proposal.parameters),
        capability: input.action.proposal.capability,
        target: input.action.proposal.target,
        success: false,
        exitCode: 1,
        scope: input.action.scope,
        risk: input.action.proposal.estimatedRisk,
        humanApproved: false,
        outputSummary: message.slice(0, 500),
        evidenceId: createEvidenceId(),
        executionDurationMs: 1,
        timestamp: new Date().toISOString(),
      })
      const pending = yield* settle(registration.tool, input.action, {
        sessionID: input.sessionID,
        agent: input.agent,
        assistantMessageID: input.assistantMessageID,
        toolCallID,
      }).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) => {
          return Effect.succeed({
            result: { type: "error" as const, value: failure.message },
            receipt: failureReceipt(failure.message),
          })
        }),
        Effect.timeoutOrElse({
          duration: Duration.minutes(2),
          orElse: () => {
            const message = "Tool execution exceeded the two-minute limit; retry only after reconciling side effects"
            return Effect.succeed({
              result: { type: "error" as const, value: message },
              receipt: { ...failureReceipt(message), uncertain: true },
            })
          },
        }),
      )
      if ("result" in pending) return pending
      const output = pending.output
      const bounded = yield* resources.bound({ sessionID: input.sessionID, toolCallID, output })
      const result = ToolOutput.toResultValue(bounded.output)
      const receipt: ExecutionReceipt = {
        receiptId: createReceiptId(),
        actionId: input.action.proposal.actionId,
        idempotencyKey: toolCallID,
        actionFingerprint: JSON.stringify(input.action.proposal.parameters),
        capability: input.action.proposal.capability,
        target: input.action.proposal.target,
        success: result.type !== "error",
        exitCode: result.type === "error" ? 1 : 0,
        scope: input.action.scope,
        risk: input.action.proposal.estimatedRisk,
        humanApproved: false,
        outputSummary: result.type === "error" ? String(result.value).slice(0, 500) : "success",
        observations: result,
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
          settle: (input: AuthorizedExecution) => {
            const providerName = input.action.proposal.providerName
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

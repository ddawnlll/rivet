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

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly call: ToolCall
}

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

    const settleWith = Effect.fn("ToolRegistry.settle")(function* (input: ExecuteInput, advertised?: object) {
      const registration =
        local.get(input.call.name)?.at(-1)?.registration ?? applications.entries().get(input.call.name)
      if (!registration)
        return {
          result: {
            type: "error" as const,
            value: advertised ? `Stale tool call: ${input.call.name}` : `Unknown tool: ${input.call.name}`,
          },
        }
      if (advertised && registration.identity !== advertised)
        return { result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` } }

      // Enforce Rivet ACCP 3.0 Authority Layer
      const rawInput =
        typeof input.call.input === "object" && input.call.input !== null
          ? (input.call.input as Record<string, unknown>)
          : {}
      const rivetScope = RivetScope.global("repo", Revision.ZERO)
      const action = CognitiveActionParser.parseFromToolCall(input.call.name, rawInput, rivetScope)
      let authorizedAction: AuthorizedAction | null = null

      if (action.type === "action_proposal") {
        const policy = {
          repository: "repo",
          currentRevision: Revision.ZERO,
          allowedScope: rivetScope,
          allowedCapabilities: ["file.read", "file.write", "process.exec", "tool.*"],
          allowMaterial: true,
          humanApproved: true,
        }
        const auth = AccpSemanticGate.authorize(action.proposal, policy)
        authorizedAction = auth.authorizedAction
        if (!authorizedAction || auth.decision.verdict !== "allow") {
          return {
            result: {
              type: "error" as const,
              value: `ACCP Authority Rejection: ${auth.decision.reason}`,
            },
          }
        }
      } else if (action.type === "claim_proposal") {
        try {
          AccpSemanticGate.validateClaimProposal(action.proposal)
        } catch (err: any) {
          return {
            result: {
              type: "error" as const,
              value: `ACCP Claim Rejection: ${err.message}`,
            },
          }
        }
      }

      const pending = yield* settle(registration.tool, input.call, {
        sessionID: input.sessionID,
        agent: input.agent,
        assistantMessageID: input.assistantMessageID,
        toolCallID: input.call.id,
      }).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
        ),
      )
      if ("result" in pending) return pending
      const output = pending.output
      const bounded = yield* resources.bound({ sessionID: input.sessionID, toolCallID: input.call.id, output })
      const result = ToolOutput.toResultValue(bounded.output)
      const receipt: ExecutionReceipt = {
        receiptId: createReceiptId(),
        actionId: authorizedAction?.proposal.actionId ?? createActionId(),
        idempotencyKey: input.call.id,
        actionFingerprint: JSON.stringify(rawInput),
        capability: input.call.name,
        success: result.type !== "error",
        exitCode: result.type === "error" ? 1 : 0,
        scope: authorizedAction?.scope ?? rivetScope,
        risk: authorizedAction?.proposal.estimatedRisk ?? "material",
        humanApproved: true,
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
          settle: (input) => {
            const registration = registrations.get(input.call.name)
            if (registration) return settleWith(input, registration.identity)
            return Effect.succeed({ result: { type: "error", value: `Unknown tool: ${input.call.name}` } })
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

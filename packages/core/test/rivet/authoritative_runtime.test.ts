import { describe, expect } from "bun:test"
import {
  LLMClient,
  LLMEvent,
  Model,
  type LLMClientShape,
  type LLMRequest,
} from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { SessionSemantics } from "@opencode-ai/core/session/semantics"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { QuestionV2 } from "@opencode-ai/core/question"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Schema, Stream } from "effect"
import { testEffect } from "../lib/effect"

const requests: LLMRequest[] = []
let responseQueue: LLMEvent[][] = []

function makeTextResponse(id: string, text: string): LLMEvent[] {
  return [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.textStart({ id }),
    LLMEvent.textDelta({ id, text }),
    LLMEvent.textEnd({ id }),
    LLMEvent.stepFinish({ index: 0, reason: "stop" }),
    LLMEvent.finish({ reason: "stop" }),
  ]
}

function makeToolResponse(callId: string, toolName: string, input: Record<string, unknown>): LLMEvent[] {
  return [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.toolCall({ id: callId, name: toolName, input }),
    LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
    LLMEvent.finish({ reason: "tool-calls" }),
  ]
}

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      const nextResponse = responseQueue.shift() ?? makeTextResponse("t_default", "Acknowledged.")
      return Stream.fromIterable(nextResponse)
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const systemContextKey = SystemContext.Key.make("test/context")
const systemBaseline = "Initial context"
const systemContext = Layer.effect(
  SystemContextRegistry.Service,
  Effect.gen(function* () {
    const registry = yield* SystemContextRegistry.Service
    yield* registry.register({
      key: systemContextKey,
      load: Effect.succeed(
        SystemContext.make({
          key: systemContextKey,
          codec: Schema.toCodecJson(Schema.String),
          load: Effect.succeed(systemBaseline),
          baseline: String,
          update: (_previous, current) => current,
        }),
      ),
    })
    return registry
  }),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))

const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))

const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/repo") })],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [PermissionV2.node, permission],
  [Config.node, config],
])

const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(runnerLayer))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      QuestionV2.node,
      SessionProjector.node,
      SessionStore.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [SessionRunnerModel.node, models],
      [SystemContextRegistry.node, systemContext],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/repo") })],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

describe("Rivet Authoritative Runtime & Cognitive Continuation Invariants", () => {
  it.effect("Invariant 1: /goal sets task identity; follow-up question preserves identity and obligations", () =>
    Effect.gen(function* () {
      requests.length = 0
      responseQueue = []
      const session = yield* SessionV2.Service
      const db = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_auth_runtime_goal_preservation")

      yield* session.create({
        id: sessionID,
        location: { directory: AbsolutePath.make("/repo") },
      })

      // Turn 1: /goal command
      responseQueue = [
        makeTextResponse("t1", "I have started working on auth tokens."),
      ]

      yield* session.prompt({
        sessionID,
        prompt: { text: "/goal Implement secure auth tokens" },
      })
      yield* session.resume(sessionID)

      const semanticsAfterGoal = yield* SessionSemantics.load(db.db, sessionID)
      expect(semanticsAfterGoal.hardState.goalDescription).toBe("Implement secure auth tokens")
      const initialTaskId = semanticsAfterGoal.hardState.activeTaskId
      expect(initialTaskId).toBeDefined()
      const initialObligations = semanticsAfterGoal.hardState.openObligationIds()
      expect(initialObligations.length).toBeGreaterThan(0)

      // Turn 2: Follow-up question "ne kaldı?" must NOT recompile a new goal or change activeTaskId
      responseQueue = [
        makeTextResponse("t2", "Auth tokens remain to be implemented."),
      ]

      yield* session.prompt({
        sessionID,
        prompt: { text: "ne kaldı?" },
      })
      yield* session.resume(sessionID)

      const semanticsAfterFollowup = yield* SessionSemantics.load(db.db, sessionID)
      expect(semanticsAfterFollowup.hardState.goalDescription).toBe("Implement secure auth tokens")
      expect(semanticsAfterFollowup.hardState.activeTaskId).toBe(initialTaskId)
      expect(semanticsAfterFollowup.hardState.openObligationIds()).toEqual(initialObligations)

      // Turn 3: Explicit new /goal command updates goal and activeTaskId
      responseQueue = [
        makeTextResponse("t3", "Switched to database pool refactor."),
      ]

      yield* session.prompt({
        sessionID,
        prompt: { text: "/goal Refactor database connection pool" },
      })
      yield* session.resume(sessionID)

      const semanticsAfterNewGoal = yield* SessionSemantics.load(db.db, sessionID)
      expect(semanticsAfterNewGoal.hardState.goalDescription).toBe("Refactor database connection pool")
      expect(semanticsAfterNewGoal.hardState.activeTaskId).not.toBe(initialTaskId)
    }),
  )

  it.effect("Invariant 2, 3: Model saying 'done' while obligations remain causes completion rejection and continuation", () =>
    Effect.gen(function* () {
      requests.length = 0
      responseQueue = []
      const session = yield* SessionV2.Service
      const sessionID = SessionV2.ID.make("ses_auth_runtime_completion_rejection")

      yield* session.create({
        id: sessionID,
        location: { directory: AbsolutePath.make("/repo") },
      })

      // Set up a session where model falsely claims "done" on step 1 without fulfilling obligations
      responseQueue = [
        // Turn 1: Model claims done without tool calls
        makeTextResponse("t1", "I have finished everything. All requirements are done."),
        // Turn 2: Model receives synthetic rejection directive and acknowledges
        makeTextResponse("t2", "Understood, obligations remain open. Let me continue."),
      ]

      yield* session.prompt({
        sessionID,
        prompt: { text: "/goal Build feature with obligations" },
      })
      yield* session.resume(sessionID)

      const messages = yield* session.messages({ sessionID })
      const syntheticMsg = messages.find((m) => m.type === "synthetic")
      expect(syntheticMsg).toBeDefined()
      expect(syntheticMsg?.type === "synthetic" && syntheticMsg.text).toContain("[RIVET COGNITIVE DIRECTIVE] Completion rejected")

      expect(requests.length).toBeGreaterThanOrEqual(2)
      const secondRequestMessages = requests[1].messages
      const hasDirective = secondRequestMessages.some((m) =>
        m.content.some((part) => part.type === "text" && part.text.includes("[RIVET COGNITIVE DIRECTIVE] Completion rejected")),
      )
      expect(hasDirective).toBe(true)
    }),
  )

  it.effect("Epistemic inquiry goal closes via query_epistemic_state without requiring Praxis execution", () =>
    Effect.gen(function* () {
      requests.length = 0
      responseQueue = []
      const session = yield* SessionV2.Service
      const db = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_auth_runtime_epistemic_inquiry")

      yield* session.create({
        id: sessionID,
        location: { directory: AbsolutePath.make("/repo") },
      })

      // Turn 1: User asks epistemic question -> Model calls query_epistemic_state
      responseQueue = [
        makeToolResponse("call_epistemic_1", "query_epistemic_state", { include_frontier: true }),
        // Turn 2: Model receives epistemic state and summarizes to user
        makeTextResponse("t_epi", "Hard state revision is 0 and no contradictions exist."),
      ]

      yield* session.prompt({
        sessionID,
        prompt: { text: "/inquiry hard state ne durumda?" },
      })
      yield* session.resume(sessionID)

      const semantics = yield* SessionSemantics.load(db.db, sessionID)
      // Epistemic inquiry obligation should be closed automatically by query_epistemic_state
      const openObligations = semantics.hardState.openObligationIds()
      expect(openObligations.length).toBe(0)
      expect(semantics.hardState.inquiryReceipts.size).toBeGreaterThanOrEqual(1)
    }),
  )

  it.effect("Invariant 4: request_completion with open obligations is rejected and continuation enforced", () =>
    Effect.gen(function* () {
      requests.length = 0
      responseQueue = []
      const session = yield* SessionV2.Service
      const db = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_auth_runtime_request_completion_rejection")

      yield* session.create({
        id: sessionID,
        location: { directory: AbsolutePath.make("/repo") },
      })

      // Turn 1: Model prematurely calls request_completion while obligations are open
      // Turn 2: Model receives rejection with BLOCKER, then acknowledges
      responseQueue = [
        makeToolResponse("call_complete_1", "request_completion", { summary: "Premature completion claim" }),
        makeTextResponse("t_after_rejection", "I see completion is blocked by unverified obligations."),
      ]

      yield* session.prompt({
        sessionID,
        prompt: { text: "/goal Build feature with obligations" },
      })
      yield* session.resume(sessionID)

      const semantics = yield* SessionSemantics.load(db.db, sessionID)
      expect(semantics.hardState.openObligationIds().length).toBeGreaterThan(0)
      expect(semantics.hardState.gateRejectionCount).toBeGreaterThan(0)

      // Verify that tool result returned to LLM contains rejection and BLOCKER
      expect(requests.length).toBeGreaterThanOrEqual(2)
      const secondRequestMessages = requests[1].messages
      const hasBlocker = secondRequestMessages.some((m) =>
        m.content.some(
          (part) =>
            part.type === "tool-result" &&
            JSON.stringify(part).includes("Rivet completion rejected") &&
            JSON.stringify(part).includes("Status: BLOCKED"),
        ),
      )
      expect(hasBlocker).toBe(true)
    }),
  )
})

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
import { Prompt } from "@opencode-ai/core/session/prompt"
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
import { testEffect } from "../../lib/effect"
import { createClaimId, createEvidenceId } from "../../../src/rivet/types"
import { CognitiveView } from "../../../src/rivet/noesis"
import { InMemoryRecallStore } from "../../../src/rivet/recall"

const requests: LLMRequest[] = []
let response: LLMEvent[] = []

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(response)
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

// Global shared recall store across sessions
const globalRecallStore = new InMemoryRecallStore()

describe("Associative Recall Killer E2E: Cross-Session Automatic Recall on Turn 1", () => {
  it.effect("Session 1 learns auth bug -> Session 5 automatically receives prior episode, rejected hypothesis & decision on Turn 1 without tool queries", () =>
    Effect.gen(function* () {
      SessionSemantics.workspaceRecallStore = globalRecallStore
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service

      // ==========================================
      // PHASE 1: SESSION 1 (Auth bug learned & fixed)
      // ==========================================
      const session1ID = SessionV2.ID.make("ses_auth_session_1")
      yield* session.create({
        id: session1ID,
        location: { directory: AbsolutePath.make("/repo") },
      })
      const semantics1 = yield* SessionSemantics.load(db, session1ID, globalRecallStore)

      // 1. Goal set: Auth token refresh race
      yield* semantics1.append(events, {
        type: "goal_set",
        goal: "Investigate auth token refresh concurrency race condition",
        timestamp: new Date().toISOString(),
      })

      // 2. Reject cache hypothesis
      const rejectedClaimId = createClaimId("c_cache_hypothesis")
      yield* semantics1.append(events, {
        type: "claim_asserted",
        claimId: rejectedClaimId,
        proposition: "Cache invalidation on refresh prevents race condition",
        status: "rejected",
        evidence: [],
        validityPolicy: "CURRENT_STATE",
        scope: semantics1.scope("/repo"),
        timestamp: new Date().toISOString(),
      })
      yield* semantics1.append(events, {
        type: "claim_rejected",
        claimId: rejectedClaimId,
        reason: "Cache invalidation causes stale read locks and throughput collapse",
        evidence: [],
        timestamp: new Date().toISOString(),
      })

      // 3. Adopt serialized refresh fix & verify
      const fixClaimId = createClaimId("c_serialized_refresh")
      const evFix = createEvidenceId("ev_auth_regression")
      yield* semantics1.append(events, {
        type: "evidence_recorded",
        evidenceId: evFix,
        source: "verification_suite",
        summary: "Auth token concurrency regression suite passed 100/100 tests at revision r5",
        timestamp: new Date().toISOString(),
      })
      yield* semantics1.append(events, {
        type: "claim_asserted",
        claimId: fixClaimId,
        proposition: "Serialize auth refresh requests with concurrency mutex lock",
        status: "verified",
        evidence: [evFix],
        dependencies: [{ type: "symbol", symbol: "refreshToken" }],
        validityPolicy: "CURRENT_STATE",
        scope: semantics1.scope("/repo"),
        timestamp: new Date().toISOString(),
      })

      // Rebuild global recall store from session 1
      yield* globalRecallStore.rebuild({ hardState: semantics1.hardState })

      // ==========================================
      // PHASE 2: INTERMEDIATE SESSIONS 2..4 (Unrelated tasks)
      // ==========================================
      for (let i = 2; i <= 4; i++) {
        const sesId = SessionV2.ID.make(`ses_unrelated_${i}`)
        yield* session.create({
          id: sesId,
          location: { directory: AbsolutePath.make("/repo") },
        })
        const semUnrelated = yield* SessionSemantics.load(db, sesId, globalRecallStore)
        yield* semUnrelated.append(events, {
          type: "goal_set",
          goal: `Unrelated task ${i}: UI layout styling`,
          timestamp: new Date().toISOString(),
        })
      }

      // ==========================================
      // PHASE 3: FRESH SESSION 5 (User asks about returning timeout)
      // ==========================================
      const session5ID = SessionV2.ID.make("ses_auth_session_5")
      yield* session.create({
        id: session5ID,
        location: { directory: AbsolutePath.make("/repo") },
      })
      const semantics5 = yield* SessionSemantics.load(db, session5ID, globalRecallStore)

      requests.length = 0
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-1" }),
        LLMEvent.textDelta({ id: "text-1", text: "Checking memory of previous auth race condition." }),
        LLMEvent.textEnd({ id: "text-1" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]

      // Submit user prompt to Session 5
      yield* session.prompt({
        sessionID: session5ID,
        prompt: Prompt.make({ text: "Auth tarafında gene timeout almaya başladık, eski race condition sorununa benziyor olabilir mi?" }),
        resume: false,
      })
      yield* session.resume(session5ID)

      expect(requests).toHaveLength(1)
      const outgoingRequest = requests[0]!

      // 1. First-class CognitiveView passed to Harness
      expect(outgoingRequest.cognitiveView).toBeDefined()
      const cognitiveView = outgoingRequest.cognitiveView as CognitiveView
      const frontier = cognitiveView.memoryFrontier

      // 2. Proactive recall received prior episode without tool calls!
      expect(frontier).toBeDefined()
      if (!frontier) throw new Error("MemoryFrontier must be defined")
      expect(frontier.episodic.length + frontier.procedural.length + frontier.rejected.length).toBeGreaterThan(0)

      // Prior episode identified
      expect(frontier.episodic.some((m) => m.summary.toLowerCase().includes("auth token refresh"))).toBe(true)

      // Previous rejected approach surfaced for failure avoidance
      expect(frontier.rejected.some((m) => m.summary.toLowerCase().includes("cache invalidation"))).toBe(true)

      // Previous successful decision surfaced
      expect(
        frontier.procedural.some((m) => m.summary.toLowerCase().includes("serialize") || m.summary.toLowerCase().includes("mutex")) ||
        frontier.active.some((m) => m.summary.toLowerCase().includes("serialize") || m.summary.toLowerCase().includes("mutex"))
      ).toBe(true)

      // 3. System prompt contains ### HARNESS MEMORY FRONTIER (Associative Context)
      const systemPrompts = outgoingRequest.system.map((s) => s.text).join("\n")
      expect(systemPrompts).toContain("### HARNESS MEMORY FRONTIER (Associative Context):")
      expect(systemPrompts.toLowerCase()).toContain("auth token refresh")
      expect(systemPrompts.toLowerCase()).toContain("cache invalidation")

      SessionSemantics.workspaceRecallStore = null
    }),
  )
})

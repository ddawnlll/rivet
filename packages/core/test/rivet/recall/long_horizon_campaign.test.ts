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
import {
  createClaimId,
  createEvidenceId,
  Revision,
  Scope,
} from "../../../src/rivet/types"
import { SqliteRecallStore } from "../../../src/rivet/recall/sqlite-store"
import { DeterministicHashEmbeddingProvider } from "../../../src/rivet/recall/embedding"
import { NoesisRecallProjector } from "../../../src/rivet/recall/projector"
import type { CognitiveView } from "../../../src/rivet/noesis"

const requests: LLMRequest[] = []
let response: LLMEvent[] = [
  LLMEvent.textStart({ id: "text-1" }),
  LLMEvent.textDelta({
    id: "text-1",
    text: "Understood. I have reviewed the prior episode, the rejected cache approach, and the serialized distributed lock fix.",
  }),
  LLMEvent.textEnd({ id: "text-1" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

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

describe("Production-Grade Long-Horizon Multi-Session Campaign (5 Sessions + Refactor + Restart)", () => {
  it.effect("executes complete 5-session campaign with refactor and state transition recovery", () =>
    Effect.gen(function* () {
      requests.length = 0
      const recallStore = new SqliteRecallStore(":memory:", new DeterministicHashEmbeddingProvider(128))
      SessionSemantics.workspaceRecallStore = recallStore

      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service

      // ==========================================
      // SESSION 1: Bug A investigation, rejection of X, fix Y, verification at r5
      // ==========================================
      const session1ID = SessionV2.ID.make("ses_horizon_1")
      yield* session.create({
        id: session1ID,
        location: { directory: AbsolutePath.make("/repo") },
      })
      const sem1 = yield* SessionSemantics.load(db, session1ID, recallStore)

      yield* sem1.append(events, {
        type: "goal_set",
        goal: "Investigate auth token refresh concurrency race condition bug A",
        timestamp: new Date().toISOString(),
      })

      // Reject Approach X (Cache Invalidation)
      const claimX = createClaimId("c_approach_x_cache")
      yield* sem1.append(events, {
        type: "claim_asserted",
        claimId: claimX,
        proposition: "Cache invalidation on token refresh prevents race condition",
        status: "rejected",
        evidence: [],
        validityPolicy: "CURRENT_STATE",
        scope: sem1.scope("/repo"),
        timestamp: new Date().toISOString(),
      })
      yield* sem1.append(events, {
        type: "claim_rejected",
        claimId: claimX,
        reason: "Cache invalidation causes stampede locks and stale token reads",
        evidence: [],
        timestamp: new Date().toISOString(),
      })

      // Adopt Solution Y (In-memory Mutex Serialization) & Verify at r5
      const claimY = createClaimId("c_solution_y_mutex")
      const evY = createEvidenceId("ev_regression_r5")
      yield* sem1.append(events, {
        type: "evidence_recorded",
        evidenceId: evY,
        source: "regression_suite",
        summary: "Auth token concurrency test suite passed 50/50 tests at revision r5",
        timestamp: new Date().toISOString(),
      })
      yield* sem1.append(events, {
        type: "claim_asserted",
        claimId: claimY,
        proposition: "Serialize auth refresh requests using in-memory mutex lock",
        status: "verified",
        evidence: [evY],
        dependencies: [{ type: "symbol", symbol: "authMutex" }],
        validityPolicy: "CURRENT_STATE",
        scope: sem1.scope("/repo"),
        timestamp: new Date().toISOString(),
      })

      // ==========================================
      // SESSION 2: Unrelated UI feature
      // ==========================================
      const session2ID = SessionV2.ID.make("ses_horizon_2")
      yield* session.create({
        id: session2ID,
        location: { directory: AbsolutePath.make("/repo") },
      })
      const sem2 = yield* SessionSemantics.load(db, session2ID, recallStore)
      yield* sem2.append(events, {
        type: "goal_set",
        goal: "Design dark mode navigation bar styling",
        timestamp: new Date().toISOString(),
      })

      // ==========================================
      // SESSION 3: Repository Refactor (In-memory mutex superseded by Distributed Redis Lock)
      // ==========================================
      const session3ID = SessionV2.ID.make("ses_horizon_3")
      yield* session.create({
        id: session3ID,
        location: { directory: AbsolutePath.make("/repo") },
      })
      const sem3 = yield* SessionSemantics.load(db, session3ID, recallStore)

      yield* sem3.append(events, {
        type: "goal_set",
        goal: "Cluster refactor: migrate in-memory mutex to distributed Redis lock",
        timestamp: new Date().toISOString(),
      })

      const claimDistributed = createClaimId("c_solution_redis_lock")
      const evDist = createEvidenceId("ev_redis_lock_test")
      yield* sem3.append(events, {
        type: "evidence_recorded",
        evidenceId: evDist,
        source: "cluster_test",
        summary: "Redis distributed lock verified across 3 nodes at revision r20",
        timestamp: new Date().toISOString(),
      })
      yield* sem1.append(events, {
        type: "claim_superseded",
        claimId: claimY,
        supersededBy: claimDistributed,
        reason: "In-memory mutex cannot coordinate across multi-node cluster; migrated to Redis lock",
        timestamp: new Date().toISOString(),
      })
      yield* sem3.append(events, {
        type: "claim_superseded",
        claimId: claimY,
        supersededBy: claimDistributed,
        reason: "In-memory mutex cannot coordinate across multi-node cluster; migrated to Redis lock",
        timestamp: new Date().toISOString(),
      })
      yield* sem3.append(events, {
        type: "claim_asserted",
        claimId: claimDistributed,
        proposition: "Serialize auth refresh requests using distributed Redis lock",
        status: "verified",
        evidence: [evDist],
        dependencies: [{ type: "symbol", symbol: "redisLock" }],
        validityPolicy: "CURRENT_STATE",
        scope: sem3.scope("/repo"),
        timestamp: new Date().toISOString(),
      })

      // ==========================================
      // SIMULATE PROCESS RESTART: Rebuild recall store from persistent canonical state
      // ==========================================
      yield* recallStore.rebuild({
        documents: [
          ...NoesisRecallProjector.projectFromHardState(sem1.hardState, "ses_horizon_1"),
          ...NoesisRecallProjector.projectFromHardState(sem3.hardState, "ses_horizon_3"),
        ],
      })

      // ==========================================
      // SESSION 4: Unrelated Billing task
      // ==========================================
      const session4ID = SessionV2.ID.make("ses_horizon_4")
      yield* session.create({
        id: session4ID,
        location: { directory: AbsolutePath.make("/repo") },
      })
      const sem4 = yield* SessionSemantics.load(db, session4ID, recallStore)
      yield* sem4.append(events, {
        type: "goal_set",
        goal: "Export monthly billing invoice CSV reports",
        timestamp: new Date().toISOString(),
      })

      // ==========================================
      // SESSION 5: Recurring auth failure with similar symptom
      // ==========================================
      const session5ID = SessionV2.ID.make("ses_horizon_5")
      yield* session.create({
        id: session5ID,
        location: { directory: AbsolutePath.make("/repo") },
      })

      yield* session.prompt({
        sessionID: session5ID,
        prompt: Prompt.make({ text: "Auth token refresh timed out again under cluster traffic. Is this the old bug?" }),
        resume: false,
      })

      yield* session.resume(session5ID)

      expect(requests).toHaveLength(1)
      const outgoing = requests[0]!
      const cognitiveView = outgoing.cognitiveView as CognitiveView
      const frontier = cognitiveView.memoryFrontier
      expect(frontier).toBeDefined()
      if (!frontier) throw new Error("Frontier required")

      // 1. Recalls the old episode
      expect(
        frontier.episodic.some((m) => m.summary.toLowerCase().includes("auth token refresh concurrency race condition"))
      ).toBe(true)

      // 2. Recalls rejected approach X for failure avoidance
      expect(
        frontier.rejected.some((m) => m.summary.toLowerCase().includes("cache invalidation"))
      ).toBe(true)

      // 3. The superseded in-memory mutex claim is NOT in active claims
      expect(
        frontier.active.some((m) => m.summary.toLowerCase().includes("in-memory mutex"))
      ).toBe(false)

      // 4. The superseding distributed Redis lock claim IS in active or procedural decisions
      expect(
        frontier.active.some((m) => m.summary.toLowerCase().includes("distributed redis lock")) ||
        frontier.procedural.some((m) => m.summary.toLowerCase().includes("distributed redis lock"))
      ).toBe(true)

      // 5. System prompt formats frontier with clear distinctions
      const systemText = outgoing.system.map((s) => s.text).join("\n")
      expect(systemText).toContain("### HARNESS MEMORY FRONTIER (Associative Context):")
      expect(systemText.toLowerCase()).toContain("cache invalidation")
      expect(systemText.toLowerCase()).toContain("distributed redis lock")

      SessionSemantics.workspaceRecallStore = null
      recallStore.close()
    }),
  )
})

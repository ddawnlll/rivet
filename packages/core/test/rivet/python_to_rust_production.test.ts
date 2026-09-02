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
import { testEffect } from "../lib/effect"
import { createClaimId, createEvidenceId } from "../../src/rivet/types"
import { CognitiveView } from "../../src/rivet/noesis"

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

const sessionID = SessionV2.ID.make("ses_python_to_rust_prod")

describe("Canonical Python -> Rust Migration: Full Production Lifecycle Audit (Items 11 & 12)", () => {
  it.effect("Harness automatically delivers Rust active state and structured PremiseConflict without requiring query_epistemic_state", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service

      requests.length = 0
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-1" }),
        LLMEvent.textDelta({ id: "text-1", text: "Acknowledging migration to Rust." }),
        LLMEvent.textEnd({ id: "text-1" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]

      // 1. Initialize session and record initial Python state via SessionSemantics
      yield* session.create({
        id: sessionID,
        location: { directory: AbsolutePath.make("/repo") },
      })
      const semantics = yield* SessionSemantics.load(db, sessionID)

      const pythonClaimId = createClaimId("claim_py")
      const rustClaimId = createClaimId("claim_rs")
      const pyEv = createEvidenceId("ev_py")

      yield* semantics.append(events, {
        type: "evidence_recorded",
        evidenceId: pyEv,
        source: "manifest_census",
        summary: "Discovered pyproject.toml",
        timestamp: new Date().toISOString(),
      })

      yield* semantics.append(events, {
        type: "claim_asserted",
        claimId: pythonClaimId,
        proposition: "Primary implementation language is Python",
        status: "supported",
        evidence: [pyEv],
        dependencies: [{ type: "manifest", name: "pyproject.toml" }],
        validityPolicy: "CURRENT_STATE",
        scope: semantics.scope("/repo"),
        timestamp: new Date().toISOString(),
      })

      // 2. Repository mutates into Rust: pyproject.toml deleted, Cargo.toml added
      const impact = yield* semantics.handleEnvironmentChanges(events, [
        { type: "file_deleted", path: "pyproject.toml" },
        { type: "manifest_changed", name: "Cargo.toml" },
        { type: "file_created", path: "src/main.rs" },
      ])

      expect(impact.allDirtyClaimIds).toContain(pythonClaimId)

      // 3. Write-time barrier: Propose Rust claim with new evidence
      const rsEv = createEvidenceId("ev_rs")
      yield* semantics.append(events, {
        type: "evidence_recorded",
        evidenceId: rsEv,
        source: "manifest_census",
        summary: "Discovered Cargo.toml and src/main.rs",
        timestamp: new Date().toISOString(),
      })

      yield* semantics.proposeClaim(events, {
        repository: "/repo",
        proposition: "Primary implementation language is Rust",
        supportingEvidence: [rsEv],
        validityPolicy: "CURRENT_STATE",
        dependencies: [
          { type: "manifest", name: "Cargo.toml" },
          { type: "file", path: "src/main.rs" },
        ],
      })

      // 4. Submit user prompt with FALSE PREMISE without calling query_epistemic_state
      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Please fix the auth bug in our Python project" }),
        resume: false,
      })
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      const outgoingRequest = requests[0]!

      // PROVE ITEM 3 & 4: CognitiveView is owned as first-class Harness input
      expect(outgoingRequest.cognitiveView).toBeDefined()
      const cognitiveView = outgoingRequest.cognitiveView as CognitiveView

      // PROVE ITEM 11: Active claims contain ONLY Rust
      expect(cognitiveView.activeClaims.some((c) => c.proposition === "Primary implementation language is Rust")).toBe(true)
      expect(cognitiveView.activeClaims.map((c) => c.id)).not.toContain(pythonClaimId)

      // PROVE ITEM 12: Premise conflict is automatically detected and formatted
      expect(cognitiveView.premiseConflicts.length).toBeGreaterThan(0)
      const conflict = cognitiveView.premiseConflicts[0]!
      expect(conflict.userPremise).toContain("Python")
      expect(conflict.currentValidState).toContain("Rust")
      expect(conflict.conflictingClaimId).toBe(pythonClaimId)

      // PROVE: Formatted system prompt contains the structured conflict and Rust claim
      const systemPrompts = outgoingRequest.system.map((s) => s.text).join("\n")
      expect(systemPrompts).toContain("### DETECTED PREMISE CONFLICTS")
      expect(systemPrompts).toContain("User assumes: \"User refers to Python codebase/environment\"")
      expect(systemPrompts).toContain("Primary implementation language is Rust")
    }),
  )
})

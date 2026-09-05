import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "../../src/format"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { RivetSessionExecution } from "../../src/session/rivet-execution"
import { SessionSemantics } from "@opencode-ai/core/session/semantics"
import { Revision } from "@opencode-ai/core/rivet/types"
import { InstanceBootstrap } from "@/project/bootstrap"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })

const root = LayerNode.group([
  RivetSessionExecution.node,
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  InstanceBootstrap.node,
])

const testLayer = LayerNode.compile(root, [
  [SessionSummary.node, summary],
  [LSP.node, lsp],
  [MCP.node, mcp],
  [RuntimeFlags.node, runtimeFlags],
  [
    InstanceBootstrap.node,
    Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
  ],
])

const it = testEffect(testLayer)

describe("RivetSessionExecution Strangler Cutover Characterization", () => {
  it.instance("RivetSessionExecution provides active/wake/resume/interrupt single owner interface", () =>
    Effect.gen(function* () {
      const execution = yield* SessionExecution.Service
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Cutover Test" })

      expect(typeof execution.wake).toBe("function")
      expect(typeof execution.resume).toBe("function")
      expect(typeof execution.interrupt).toBe("function")

      // active is an Effect returning ReadonlySet<SessionSchema.ID>
      const activeSessions = yield* execution.active
      expect(activeSessions.has(session.id)).toBe(false)
    }),
  )

  it.instance("Failed tool execution produces ExecutionReceipt with success: false in semantic hard state", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const session = yield* sessions.create({ title: "Receipt Test" })
      const semantics = yield* SessionSemantics.load(database.db, session.id)

      expect(semantics.hardState.executionReceipts.length).toBe(0)

      // Record a failed execution receipt
      const receipt = {
        receiptId: "rcpt_fail_1" as any,
        actionId: "act_1" as any,
        idempotencyKey: "call_fail_1",
        actionFingerprint: "{}",
        capability: "tool.test",
        target: "test",
        success: false,
        exitCode: 1,
        scope: semantics.scope(session.directory),
        risk: "inspect" as const,
        humanApproved: false,
        outputSummary: "Simulated tool crash",
        evidenceId: "ev_fail_1" as any,
        executionDurationMs: 12,
        timestamp: new Date().toISOString(),
      }

      yield* semantics.recordExecution(yield* EventV2Bridge.Service, receipt)
      expect(semantics.hardState.executionReceipts.length).toBe(1)
      const stored = semantics.hardState.executionReceipts[0]
      expect(stored?.success).toBe(false)
      expect(stored?.exitCode).toBe(1)
      expect(stored?.humanApproved).toBe(false)
      expect(stored?.receiptId).toBe("rcpt_fail_1" as any)
    }),
  )

  it.instance("Tool execution fails fast when authorized action revision becomes stale", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const session = yield* sessions.create({ title: "Revision Staleness Test" })
      const semantics = yield* SessionSemantics.load(database.db, session.id)

      const scope = semantics.scope(session.directory)

      // Admit an action at current revision
      const admission = semantics.admitProviderCommitment(
        { id: "call_stale", name: "read", input: { path: "test.txt" } },
        scope,
        {
          repository: session.directory,
          currentRevision: semantics.hardState.revision,
          allowedScope: scope,
          allowedCapabilities: ["file.read"],
          allowMaterial: true,
          humanApproved: false,
        },
      )

      expect(admission.authorizedAction).toBeDefined()
      const action = admission.authorizedAction!

      // Mutate state to advance revision
      yield* semantics.ensureGoal(yield* EventV2Bridge.Service, "A new goal", session.directory)
      expect(action.revision.equals(semantics.hardState.revision)).toBe(false)

      // Executing authorized action with stale revision must reject
      const exit = yield* semantics
        .executeAuthorizedAction(
          action,
          () => Effect.succeed({ output: "done" }),
          (v) => v.output,
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})

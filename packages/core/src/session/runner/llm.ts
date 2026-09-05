import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  SystemPart,
  TransportReason,
  ToolDefinition,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@opencode-ai/llm"
import { Cause, DateTime, Duration, Effect, Exit, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
import { AgentV2 } from "../../agent"
import { AgentPlugin } from "../../plugin/agent"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { ToolRegistry } from "../../tool/registry"
import { ToolOutputStore } from "../../tool-output-store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionInput } from "../input"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionSemantics } from "../semantics"
import { type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { TokenLedger } from "../../rivet/token-ledger"
import { createInvocationId } from "../../rivet/types"
import type { CompletionProposal } from "../../rivet/accp"
import { TurnAdmissionGate } from "../../rivet/turn-admission"
import { AutomaticRecallAdmissionHook } from "../../rivet/recall"
import { type ModelInvocation, ModelInvocationGate, type ModelInvocationReceipt } from "../invocation"
import { FlightRecorder, ExecutionEconomics, type ActiveSpanContext } from "../../rivet/flight-recorder"
import { SessionTable } from "../sql"
import { eq } from "drizzle-orm"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"

const PROVIDER_INACTIVITY_TIMEOUT = Duration.seconds(30)
const PROVIDER_TURN_TIMEOUT = Duration.minutes(15)
const TOOL_SETTLEMENT_TIMEOUT = Duration.minutes(2)

function stableToolFingerprint(name: string, input: unknown): string {
  return `${name}:${JSON.stringify(stableToolValue(input))}`
}

function stableToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableToolValue)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableToolValue(child)]),
  )
}

/**
 * Runs one durable Rivet Session until its Harness-owned continuation settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor optional agent step limits.
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opencode-ai/llm` messages.
 *   - [x] Resolve policy-filtered built-in, MCP, plugin, and structured-output action definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute provider commitments through the Rivet-owned action boundary.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Action schemas are advertised, authorized actions are settled durably, and an
 * explicit loop starts the next provider turn after settlement. Configured agent step limits bound the loop.
 */

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const publishStatus = Effect.fn("SessionRunner.publishStatus")(function* (
      session: SessionSchema.Info,
      status: SessionStatusEvent.Info,
    ) {
      yield* events.publish(
        SessionStatusEvent.Status,
        { sessionID: session.id, status },
        { location: session.location },
      )
      if (status.type === "idle" && status.outcome !== undefined) {
        yield* events.publish(
          SessionEvent.Run.Status,
          { sessionID: session.id, timestamp: yield* DateTime.now, status },
          { location: session.location },
        )
        // Preserve the legacy wake-up edge for consumers that still await the
        // deprecated Idle event; the richer status carries the actual outcome.
        yield* events.publish(SessionStatusEvent.Idle, { sessionID: session.id }, { location: session.location })
      }
    })
    // Process-lifetime fiber set so the background deep induction outlives the
    // drain that started it without being joined by tool settlement.
    const inductionFibers = yield* FiberSet.makeRuntime<never, void, never>()
    const compaction = SessionCompaction.make({ events, llm, config: yield* config.entries() })
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.timeoutOrElse(Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers)), {
        duration: TOOL_SETTLEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new ToolOutputStore.StorageError({
              operation: "write",
              cause: new Error("Tool settlement exceeded the two-minute limit"),
            }),
          ),
      })

    // Match V1: declining a user prompt halts the loop instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionV2.RejectedError),
      )

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    const loadSystemContext = (agent: AgentV2.Selection) =>
      Effect.all([systemContext.load(), skillGuidance.load(agent), referenceGuidance.load()], {
        concurrency: "unbounded",
      }).pipe(Effect.map(SystemContext.combine))

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
      completionResponse?: CompletionProposal,
      responseRequired = completionResponse !== undefined,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      let lastCompletedActivity: SessionStatusEvent.CompletedActivity | undefined
      const activityLabel = (operation: string) =>
        ({
          "turn.admission": "Understanding request",
          "goal.compile": "Compiling goal",
          "hardstate.load": "Loading Hard State",
          "recall.query": "Searching memory",
          "recall.index_delta": "Indexing memory",
          "cognitive_view.compile": "Compiling context",
          "prompt.assemble": "Preparing model request",
          "provider.request": "Preparing model request",
          "provider.wait_first_token": "Waiting for model",
          "provider.stream": "Generating",
          "tool.dispatch": "Checking authorization",
          "tool.execute": "Executing tool",
          "tool.result_process": "Processing tool result",
          "praxis.evaluate": "Verifying evidence",
          "completion.evaluate": "Checking completion",
          "provider.finalize": "Delivering response",
        })[operation] ?? operation
      const publishActivity = (span: ActiveSpanContext) =>
        publishStatus(session, {
          type: "busy",
          activity: {
            operation: span.operation,
            label: activityLabel(span.operation),
            spanId: span.spanId,
            startedAt: Date.parse(span.wallStart),
          },
          ...(lastCompletedActivity ? { lastCompleted: lastCompletedActivity } : {}),
        })
      const publishCompletedActivity = (span: ReturnType<typeof FlightRecorder.endSpan>) => {
        lastCompletedActivity = {
          operation: span.operation,
          label: activityLabel(span.operation),
          spanId: span.spanId,
          durationMs: Math.max(0, Math.round(span.duration)),
        }
      }
      const withActivity = <A, E, R>(
        category: Parameters<typeof FlightRecorder.startSpan>[0],
        operation: Parameters<typeof FlightRecorder.startSpan>[1],
        effect: Effect.Effect<A, E, R>,
        options?: Parameters<typeof FlightRecorder.startSpan>[2],
      ) =>
        Effect.gen(function* () {
          const span = FlightRecorder.startSpan(category, operation, options)
          yield* publishActivity(span)
          const exit = yield* effect.pipe(Effect.exit)
          const completed = FlightRecorder.endSpan(span, {
            status: Exit.isSuccess(exit) ? "ok" : Cause.hasInterrupts(exit.cause) ? "cancelled" : "error",
          })
          publishCompletedActivity(completed)
          yield* publishStatus(session, {
            type: "busy",
            ...(lastCompletedActivity ? { lastCompleted: lastCompletedActivity } : {}),
          })
          if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
          return exit.value
        })
      const semantics = yield* SessionSemantics.load(db, session.id)
      yield* semantics.ensureColdStart(events, session.location.directory)
      // Fork the deep repository induction in the background: the first drain
      // on a new project triggers the hard scan while the turn proceeds. Later
      // sessions replay cached claims from .rivet/induction.json instantly.
      inductionFibers(semantics.ensureDeepInduction(events, session.location.directory))
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let completionAccepted = false
      let pendingCompletion = completionResponse
      let requireResponse = responseRequired
      let currentStep = step
      let toolCallsInTurn = 0
      let lastSettledTool: { readonly fingerprint: string; readonly summary: string } | undefined
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) currentStep = 1
      }
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.id))
      const model = yield* models.resolve(session)
      const turnSpan = FlightRecorder.startSpan("turn", "turn.total", {
        sessionId: session.id,
        turnId: currentStep,
        model: model.id,
        provider: model.provider,
      })
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const initialUserGoal = context.find((message) => message.type === "user")?.text
      const latestUserMessage = context.findLast((message) => message.type === "user")?.text
      const latestAdmission = latestUserMessage
        ? FlightRecorder.withSpan(
            "turn",
            "turn.admission",
            () => TurnAdmissionGate.classify(latestUserMessage, semantics.hardState.goalDescription),
            { sessionId: session.id, turnId: currentStep },
          )
        : undefined

      // Active goal preservation: A persistent goal in HardState survives conversational follow-ups.
      // A turn only erases/lacks a goal if HardState has NO active goal AND the current prompt creates no goal.
      let effectiveGoal = semantics.hardState.goalDescription
      if (latestAdmission?.shouldCreateGoal && latestAdmission.goalText && latestAdmission.goalText.length > 0) {
        if (semantics.hardState.goalDescription !== latestAdmission.goalText) {
          yield* withActivity(
            "turn",
            "goal.compile",
            semantics.ensureGoal(
              events,
              latestAdmission.goalText,
              session.location.directory,
              latestAdmission.obligationKind,
            ),
            { sessionId: session.id, turnId: currentStep },
          )
        }
        effectiveGoal = latestAdmission.goalText
      } else if (!effectiveGoal && initialUserGoal) {
        const initialAdmission = TurnAdmissionGate.classify(initialUserGoal)
        if (initialAdmission.shouldCreateGoal && initialAdmission.goalText && initialAdmission.goalText.length > 0) {
          effectiveGoal = initialAdmission.goalText
          if (!semantics.hardState.goalDescription) {
            yield* withActivity(
              "turn",
              "goal.compile",
              semantics.ensureGoal(events, effectiveGoal, session.location.directory, initialAdmission.obligationKind),
              { sessionId: session.id, turnId: currentStep },
            )
          }
        }
      }

      // Explicit non-goal turn only when neither HardState nor the current prompt has a goal
      const isExplicitNonGoalTurn = !effectiveGoal && Boolean(latestAdmission && !latestAdmission.shouldCreateGoal)

      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const responseOnly = responseRequired
      const toolMaterialization =
        responseOnly || isLastStep ? undefined : yield* tools.materialize(agent.info?.permissions)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const hasAutonomousGoal = Boolean(effectiveGoal || (latestAdmission && latestAdmission.shouldCreateGoal))
      const availableActions =
        isLastStep || !toolMaterialization || toolMaterialization.definitions.length === 0
          ? []
          : [
              ...toolMaterialization.definitions,
              ...(hasAutonomousGoal
                ? [
                    new ToolDefinition({
                      name: "request_completion",
                      description:
                        "Propose completion only for active autonomous goals when COMPLETION READINESS is READY and all required obligations are closed and verified. Do NOT call when BLOCKED or for conversational inquiries.",
                      inputSchema: {
                        type: "object",
                        properties: { summary: { type: "string" } },
                        required: ["summary"],
                        additionalProperties: false,
                      },
                    }),
                    new ToolDefinition({
                      name: "request_verification",
                      description:
                        "Ask Praxis to verify an observed execution (e.g. test run). Do NOT call this for epistemic inquiries; only call this when an execution obligation requires Praxis verification.",
                      inputSchema: {
                        type: "object",
                        properties: {
                          predicate: { type: "string" },
                          obligation_id: { type: "string" },
                        },
                        required: ["predicate"],
                        additionalProperties: false,
                      },
                    }),
                    new ToolDefinition({
                      name: "invalidate_obligation",
                      description:
                        "Invalidate or waive an inapplicable or malformed obligation (e.g. created from conversational text or an impossible predicate). Provide the obligation ID and clear rationale.",
                      inputSchema: {
                        type: "object",
                        properties: {
                          obligation_id: { type: "string", description: "The obligation ID to invalidate" },
                          reason: {
                            type: "string",
                            description: "Clear explanation of why this obligation is invalid or inapplicable",
                          },
                        },
                        required: ["obligation_id", "reason"],
                        additionalProperties: false,
                      },
                    }),
                  ]
                : []),
              new ToolDefinition({
                name: "propose_claim",
                description: "Propose a supported claim backed by already admitted evidence.",
                inputSchema: {
                  type: "object",
                  properties: {
                    proposition: { type: "string" },
                    supporting_evidence: { type: "array", items: { type: "string" } },
                  },
                  required: ["proposition"],
                  additionalProperties: false,
                },
              }),
              new ToolDefinition({
                name: "query_epistemic_state",
                description:
                  "Query Rivet's authoritative epistemic state (Noesis HardState revision, active validated claims, open obligations, premise conflicts, and memory frontier). NOTE: Hard State is an internal runtime state, NOT files on disk. Do NOT use glob/grep to look for state files; call this tool instead.",
                inputSchema: {
                  type: "object",
                  properties: {
                    include_frontier: { type: "boolean", description: "Include associative memory frontier" },
                  },
                  additionalProperties: false,
                },
              }),
              new ToolDefinition({
                name: "retrieve_memory",
                description:
                  "Search and retrieve associative project memory, past session decisions, architectural conventions, and failure-avoidance patterns from Rivet's memory store. NOTE: Memory records are stored internally in Rivet's recall store, NOT in workspace files. Do NOT use glob/grep to search for memory files; call this tool instead.",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "Search query or topic to recall from memory" },
                    symbols: {
                      type: "array",
                      items: { type: "string" },
                      description: "Specific code symbols to recall related memories for",
                    },
                  },
                  additionalProperties: false,
                },
              }),
            ]
      const invocationID = createInvocationId(`${session.id}:${currentStep}`)
      yield* semantics.recordInvocation(events, invocationID, model.id)
      const cognitiveView = yield* withActivity(
        "cognitive_view",
        "cognitive_view.compile",
        semantics.cognitiveView({
          repositoryId: session.location.directory,
          goalDescription: hasAutonomousGoal
            ? (semantics.hardState.goalDescription ?? effectiveGoal ?? undefined)
            : isExplicitNonGoalTurn
              ? ""
              : undefined,
          userPrompt: latestUserMessage ?? effectiveGoal ?? undefined,
        }),
        { sessionId: session.id, turnId: currentStep },
      )
      const invocation: ModelInvocation = {
        systemContract: { name: "Rivet Harness", version: "1", authority: "Harness" },
        cognitiveView,
        availableActions,
        budget: { outputTokens: agent.info?.steps },
        invocation: invocationID,
      }
      const gateEvaluation = ModelInvocationGate.evaluate(invocation)
      const baseRivetSystem = cognitiveView.formatPromptBlock()
      const rivetStateSystem =
        agent.info?.system === undefined ? `${AgentPlugin.BUILD_SYSTEM}\n\n${baseRivetSystem}` : baseRivetSystem
      const toolChoice = responseOnly || isLastStep ? "none" : undefined
      const request = yield* withActivity(
        "cognitive_view",
        "prompt.assemble",
        Effect.sync(() =>
          LLM.request({
            model,
            http: {
              headers: {
                "x-session-affinity": session.id,
                "X-Session-Id": session.id,
                ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
              },
            },
            providerOptions: { openai: { promptCacheKey } },
            system: [agent.info?.system, system.baseline, rivetStateSystem]
              .filter((part): part is string => part !== undefined && part.length > 0)
              .map(SystemPart.make),
            cognitiveView,
            invocation,
            metadata: {
              rivet: {
                invocation: invocation.invocation,
                hardRevision: cognitiveView.hardRevision.toJSON(),
                goal: cognitiveView.goalDescription,
                receipt: gateEvaluation.receipt,
              },
            },
            messages: [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])],
            tools: availableActions,
            toolChoice,
          }),
        ),
        { sessionId: session.id, turnId: currentStep },
      )
      TokenLedger.record({
        sessionID: session.id,
        step: currentStep,
        invocationID,
        model: model.id,
        provider: model.provider,
        request,
      })
      if (yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request }))
        return yield* Effect.die(continueAfterCompaction(currentStep))
      const startSnapshot = yield* snapshots.capture()
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
        snapshot: startSnapshot,
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const withSemanticCommit = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))
      let overflowFailure: ProviderErrorEvent | undefined
      const providerReqSpan = FlightRecorder.startSpan("provider", "provider.request", {
        sessionId: session.id,
        turnId: currentStep,
        parentSpanId: turnSpan.spanId,
        provider: model.provider,
        model: model.id,
      })
      yield* publishActivity(providerReqSpan)
      let ttftSpan: ActiveSpanContext | undefined = FlightRecorder.startSpan("provider", "provider.wait_first_token", {
        sessionId: session.id,
        turnId: currentStep,
        parentSpanId: providerReqSpan.spanId,
        provider: model.provider,
        model: model.id,
      })
      yield* publishActivity(ttftSpan)
      let streamSpan: ActiveSpanContext | undefined = undefined
      let firstTokenSeen = false

      const providerStream = llm.stream(request).pipe(
        Stream.timeoutOrElse({
          duration: PROVIDER_INACTIVITY_TIMEOUT,
          orElse: () =>
            Stream.fail(
              new LLMError({
                module: "SessionRunner",
                method: "stream",
                reason: new TransportReason({
                  message: "Provider response stalled before the next chunk",
                  kind: "timeout",
                }),
              }),
            ),
        }),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (
              !firstTokenSeen &&
              (event.type === "text-start" ||
                event.type === "text-delta" ||
                event.type === "reasoning-start" ||
                event.type === "reasoning-delta" ||
                event.type === "tool-call")
            ) {
              firstTokenSeen = true
              if (ttftSpan) {
                const completed = FlightRecorder.endSpan(ttftSpan, { status: "ok" })
                publishCompletedActivity(completed)
                ttftSpan = undefined
              }
              streamSpan = FlightRecorder.startSpan("provider", "provider.stream", {
                sessionId: session.id,
                turnId: currentStep,
                parentSpanId: providerReqSpan.spanId,
                provider: model.provider,
                model: model.id,
              })
              yield* publishActivity(streamSpan)
            }
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (event.type !== "tool-call") return
            toolCallsInTurn += 1
            if (semantics.hardState.gateRejectionCount > 0) {
              semantics.hardState.toolCallsAfterRejection++
            }
            // Provider-hosted calls remain transport history. They do not
            // become local execution authority without a Rivet decision.
            if (event.providerExecuted) return
            if (!toolMaterialization) {
              yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            const rivetScope = semantics.scope(session.location.directory)
            const commitment = FlightRecorder.withSpan(
              "governance",
              "accp.evaluate",
              () =>
                semantics.admitProviderCommitment({ id: event.id, name: event.name, input: event.input }, rivetScope, {
                  repository: session.location.directory,
                  currentRevision: semantics.hardState.revision,
                  allowedScope: rivetScope,
                  allowedCapabilities: ["file.read", "file.write", "process.exec", "tool.*"],
                  allowMaterial: true,
                  humanApproved: false,
                }),
              { sessionId: session.id, turnId: currentStep, tool: event.name },
            )
            if (commitment.commitment.type === "completion_proposal") {
              const proposal = commitment.commitment.proposal
              const decision = yield* semantics.proposeCompletion(events, {
                summary: proposal.summary,
                taskId: proposal.taskId,
                baseRevision: proposal.baseRevision,
                responseDelivered: false,
              })
              if (decision.internalClosureReady) {
                pendingCompletion = proposal
                requireResponse = true
              }
              const rejectionMessage = decision.internalClosureReady
                ? "Rivet internal completion checks passed. The requested answer has not been delivered yet; respond to the user with the answer before completion."
                : !decision.completed
                  ? [
                      "Rivet completion rejected: The proposed transition did not satisfy the contract.",
                      "Status: BLOCKED",
                      ...(decision.blockers.length > 0
                        ? ["Blockers:", ...decision.blockers.map((b) => `- [BLOCKER] ${b}`)]
                        : ["Blockers: Open obligations remain unverified."]),
                      "Directive: Target ONLY the reported blockers above. Do NOT perform unrelated work, invent additional verification, or run unprompted shell commands.",
                    ].join("\n")
                  : "Rivet completion accepted: All obligations satisfied and verified."

              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: {
                    type: decision.internalClosureReady ? "text" : "error",
                    value: rejectionMessage,
                  },
                }),
              )
              return
            }
            if (commitment.commitment.type === "verification_request") {
              const verification = yield* FlightRecorder.withSpanEffect(
                "governance",
                "praxis.evaluate",
                semantics.verifyLastExecution(events, commitment.commitment.request),
                { sessionId: session.id, turnId: currentStep },
              ).pipe(Effect.exit)
              if (Exit.isFailure(verification)) {
                semantics.hardState.gateRejectionCount++
                needsContinuation = false
                requireResponse = true
                yield* publish(
                  LLMEvent.toolResult({
                    id: event.id,
                    name: event.name,
                    result: {
                      type: "error",
                      value: `Praxis verification rejected: ${String(Cause.squash(verification.cause))}\nDirective: Non-actionable verifier rejection. State remains unresolved. Answer the user with available evidence. Do NOT search or debug Rivet harness source code.`,
                    },
                  }),
                )
                return
              }
              if (verification.value.type === "inquiry") {
                yield* publish(
                  LLMEvent.toolResult({
                    id: event.id,
                    name: event.name,
                    result: {
                      type: "text",
                      value:
                        "Praxis inquiry verification passed: Epistemic inquiry satisfied by authoritative projection.",
                    },
                  }),
                )
                return
              }
              const receipt = verification.value.receipt
              const isPassed = receipt.passed
              const diagnosticsMsg = receipt.diagnostics ? `\nDiagnostics: ${receipt.diagnostics}` : ""
              const reasonCodesMsg = receipt.reasonCodes?.length
                ? `\nReason Codes: ${receipt.reasonCodes.join(", ")}`
                : ""

              const isFileNotFound = receipt.reasonCodes?.includes("FILE_NOT_FOUND")
              const isPathEscapes = receipt.reasonCodes?.includes("PATH_ESCAPES_REPOSITORY")
              const isClaimNotAdmitted = receipt.reasonCodes?.includes("CLAIM_NOT_ADMITTED")
              const isTestFailure =
                receipt.reasonCodes?.includes("TEST_FAILED") || receipt.reasonCodes?.includes("TESTS_FAILED")

              const gateRejections = semantics.hardState.gateRejectionCount
              const maxGateRetries = 3
              const canRetry = Boolean(hasAutonomousGoal && gateRejections < maxGateRetries)

              let directiveMsg = "Inspect and fix the failed check. Do NOT run unrelated commands."
              let retryAllowed = canRetry

              if (isFileNotFound) {
                directiveMsg = hasAutonomousGoal
                  ? "The requested file or target was not found on disk. Create or generate the required file using tools before requesting verification again. Do NOT fabricate fake files to satisfy constraints."
                  : "The requested file or target was not found on disk. If the user asked whether the file exists, report that it does NOT exist. Do NOT search or debug Rivet harness source code."
                retryAllowed = hasAutonomousGoal && canRetry
              } else if (isPathEscapes) {
                directiveMsg =
                  "Path resolves outside the permitted workspace scope. If the path constraint is malformed or inapplicable, call invalidate_obligation with the obligation ID and reason. Do NOT search or debug Rivet harness source code."
                retryAllowed = canRetry
              } else if (isClaimNotAdmitted) {
                directiveMsg =
                  "Required claim has not been admitted. If you observed evidence via tools, call propose_claim with the proposition and supporting evidence ID from RECENT AUTHORITATIVE EVIDENCE. Do NOT search or debug Rivet harness source code."
                retryAllowed = canRetry
              } else if (isTestFailure) {
                directiveMsg =
                  "Inspect and fix the reported test failure. Do NOT fabricate files or run unrelated commands."
                retryAllowed = canRetry
              } else if (!isPassed) {
                directiveMsg =
                  "Verification could not be satisfied. Report the unresolved verification state to the user. Do NOT search or debug Rivet harness source code."
                retryAllowed = canRetry
              }

              if (!isPassed && !retryAllowed) {
                needsContinuation = false
                requireResponse = true
              } else if (!isPassed && retryAllowed) {
                needsContinuation = true
                requireResponse = false
              }

              const resultMessage = isPassed
                ? `Praxis verification passed for obligation [${receipt.obligationId}].`
                : `Praxis verification failed for obligation [${receipt.obligationId}].${reasonCodesMsg}${diagnosticsMsg}\nDirective: ${directiveMsg}`
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: {
                    type: isPassed ? "text" : "error",
                    value: resultMessage,
                  },
                }),
              )
              return
            }
            if (commitment.commitment.type === "obligation_invalidation") {
              const invalidation = yield* semantics
                .invalidateObligation(events, {
                  obligationId: commitment.commitment.obligationId,
                  reason: commitment.commitment.reason,
                })
                .pipe(Effect.exit)
              if (Exit.isFailure(invalidation)) {
                yield* publish(
                  LLMEvent.toolResult({
                    id: event.id,
                    name: event.name,
                    result: {
                      type: "error",
                      value: `Obligation invalidation rejected: ${String(Cause.squash(invalidation.cause))}`,
                    },
                  }),
                )
                return
              }
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: {
                    type: "text",
                    value: `Obligation [${commitment.commitment.obligationId}] successfully invalidated. Reason: ${commitment.commitment.reason}`,
                  },
                }),
              )
              return
            }
            if (commitment.commitment.type === "claim_proposal") {
              const claim = yield* semantics.admitClaim(events, commitment.commitment.proposal).pipe(Effect.exit)
              if (Exit.isFailure(claim)) {
                yield* publish(
                  LLMEvent.toolResult({
                    id: event.id,
                    name: event.name,
                    result: { type: "error", value: `Claim admission rejected: ${String(Cause.squash(claim.cause))}` },
                  }),
                )
                return
              }
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: { type: "text", value: "Claim admitted as supported evidence" },
                }),
              )
              return
            }
            if (commitment.commitment.type === "epistemic_query") {
              const snapshot = semantics.getEpistemicState(semantics.scope(session.location.directory))
              const memoryItems = [
                ...(snapshot.memoryFrontier?.active ?? []),
                ...(snapshot.memoryFrontier?.episodic ?? []),
                ...(snapshot.memoryFrontier?.procedural ?? []),
                ...(snapshot.memoryFrontier?.rejected ?? []),
              ]
              const stateSummary = [
                `=== RIVET AUTHORITATIVE EPISTEMIC STATE ===`,
                `Revision: ${snapshot.revision}`,
                `Goal: ${snapshot.goalDescription ?? "None"}`,
                `Active Valid Claims (${snapshot.activeClaims.length}):`,
                ...(snapshot.activeClaims.length > 0
                  ? snapshot.activeClaims.map((c) => `  - [${c.id}] ${c.status}: ${c.proposition}`)
                  : [`  (None active)`]),
                `Open Obligations (${snapshot.openObligations.length}):`,
                ...(snapshot.openObligations.length > 0
                  ? snapshot.openObligations.map(([id, desc]) => `  - [${id}] ${desc}`)
                  : [`  (None open)`]),
                ...(snapshot.premiseConflicts.length > 0
                  ? [
                      `Premise Conflicts (${snapshot.premiseConflicts.length}):`,
                      ...snapshot.premiseConflicts.map(
                        (pc) => `  - [PREMISE CONFLICT] User: "${pc.userPremise}" vs Valid: "${pc.currentValidState}"`,
                      ),
                    ]
                  : []),
                `Memory Frontier (${memoryItems.length} items):`,
                ...(memoryItems.length > 0
                  ? memoryItems.map((m) => `  - [${m.type}] ${m.summary}`)
                  : [`  (No relevant memory records recalled for this revision)`]),
                `Recent Evidence (${snapshot.recentEvidence.length}):`,
                ...snapshot.recentEvidence.map(([id, sum]) => `  - [${id}] ${sum}`),
              ].join("\n")

              // The authoritative projection is itself the closure proof for
              // open epistemic inquiry obligations: no execution, no Praxis.
              const inquiryReceipts = yield* semantics.satisfyInquiries(events, {
                summary: `Authoritative epistemic projection served at revision ${snapshot.revision.toJSON()}`,
                atRevision: snapshot.revision,
              })
              const closureSummary =
                inquiryReceipts.length > 0
                  ? `\n✓ Epistemic inquiry satisfied by authoritative Noesis projection @${snapshot.revision.toJSON()}`
                  : ""

              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: { type: "text", value: `${stateSummary}${closureSummary}` },
                  output: {
                    structured: {
                      revision: snapshot.revision.toJSON(),
                      goal: snapshot.goalDescription,
                      claims: snapshot.activeClaims,
                      obligations: snapshot.openObligations,
                      memories: memoryItems,
                    },
                    content: [{ type: "text", text: `${stateSummary}${closureSummary}` }],
                  },
                }),
              )
              return
            }
            if (commitment.commitment.type === "memory_retrieval") {
              const queryPrompt = commitment.commitment.query ?? latestUserMessage ?? "Project context and conventions"
              const memoryFrontier = yield* AutomaticRecallAdmissionHook.admitRecall({
                hardState: semantics.hardState,
                recallStore: semantics.recallStore,
                userPrompt: queryPrompt,
                goalDescription: semantics.hardState.goalDescription ?? effectiveGoal ?? "Retrieve project memory",
                repositoryId: session.location.directory,
                focusSymbols: commitment.commitment.symbols,
              }).pipe(Effect.orElseSucceed(() => undefined))

              const items = [
                ...(memoryFrontier?.active ?? []),
                ...(memoryFrontier?.episodic ?? []),
                ...(memoryFrontier?.procedural ?? []),
                ...(memoryFrontier?.rejected ?? []),
              ]

              const symbolsStr = memoryFrontier?.relatedSymbols?.length
                ? ` (symbols: ${memoryFrontier.relatedSymbols.join(", ")})`
                : ""
              const summary = [
                `=== RIVET PROJECT MEMORY RETRIEVAL ===`,
                `Query: "${queryPrompt}"`,
                `Recalled Records (${items.length}):`,
                ...(items.length > 0
                  ? items.map(
                      (m) => `  - [${m.type}] ${m.summary}${m.tags?.length ? ` [tags: ${m.tags.join(", ")}]` : ""}`,
                    )
                  : [`  (No associative memory records matched query in memory store)`]),
                ...(symbolsStr ? [`Related Symbols: ${memoryFrontier?.relatedSymbols.join(", ")}`] : []),
              ].join("\n")

              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: { type: "text", value: summary },
                  output: {
                    structured: {
                      query: queryPrompt,
                      count: items.length,
                      items,
                      relatedSymbols: memoryFrontier?.relatedSymbols ?? [],
                    },
                    content: [{ type: "text", text: summary }],
                  },
                }),
              )
              return
            }
            if (commitment.commitment.type !== "action_proposal") {
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: { type: "error", value: "Only ACCP action commitments can enter the tool executor" },
                }),
              )
              return
            }
            const authorizedAction = commitment.authorizedAction
            if (!authorizedAction) {
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: {
                    type: "error",
                    value: `ACCP action rejected: ${commitment.decision?.reason ?? "not authorized"}`,
                  },
                }),
              )
              return
            }

            const isRivetHarnessGoal = /debug\s+rivet|rivet\s+harness|develop\s+rivet|test\s+rivet/i.test(
              (latestUserMessage ?? "") + " " + (effectiveGoal ?? ""),
            )
            const targetStr = String(event.input && typeof event.input === "object" ? JSON.stringify(event.input) : "")
            const targetsHarnessInternals =
              targetStr.includes("packages/core/src/rivet") ||
              targetStr.includes("packages/core/src/session") ||
              /\b(?:praxis\.ts|noesis\.ts|accp\.ts|goal-compiler\.ts)\b/i.test(targetStr)

            if (!isRivetHarnessGoal && targetsHarnessInternals) {
              needsContinuation = false
              requireResponse = true
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: {
                    type: "error",
                    value:
                      "ACCP policy violation: Active goal cannot expand into inspecting or debugging Rivet's internal runtime harness or governance modules solely because internal verification or bookkeeping failed. Deliver the response to the user with existing workspace observations.",
                  },
                }),
              )
              return
            }

            const claim = yield* semantics.claimExecution(events, authorizedAction)
            if (claim.status !== "claimed") {
              needsContinuation = false
              requireResponse = true
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: {
                    type: "error",
                    value:
                      claim.status === "settled"
                        ? "This action was already settled; no duplicate side effect was executed."
                        : claim.message,
                  },
                }),
              )
              return
            }

            yield* withActivity(
              "tool",
              "tool.execute",
              Effect.uninterruptibleMask((restore) =>
                restore(
                  Effect.gen(function* () {
                    if (!semantics.isActionCurrent(authorizedAction)) {
                      return {
                        result: {
                          type: "error" as const,
                          value: "Action authorization became stale before execution; no side effect was executed.",
                        },
                      }
                    }
                    return yield* toolMaterialization.settle({
                      sessionID: session.id,
                      agent: agent.id,
                      assistantMessageID,
                      action: authorizedAction,
                    })
                  }),
                ).pipe(
                  Effect.tap((settlement) => {
                    if (settlement.receipt) {
                      lastSettledTool = {
                        fingerprint: stableToolFingerprint(event.name, event.input),
                        summary: settlement.receipt.outputSummary,
                      }
                    }
                    if (!settlement.receipt) return Effect.void
                    const receipt = settlement.receipt
                    return withSemanticCommit(
                      withActivity(
                        "tool",
                        "tool.result_process",
                        Effect.gen(function* () {
                          yield* semantics.recordExecution(events, receipt)
                          yield* semantics.recordObservation(events, receipt, receipt.outputSummary)
                          yield* semantics.admitEvidence(events, receipt, receipt.capability, receipt.outputSummary)
                        }),
                        { sessionId: session.id, turnId: currentStep, tool: event.name },
                      ),
                    )
                  }),
                  Effect.flatMap((settlement) => {
                    const result =
                      settlement.receipt?.evidenceId && settlement.result.type === "text"
                        ? {
                            ...settlement.result,
                            value: `${settlement.result.value}\n[Admitted Evidence ID: ${settlement.receipt.evidenceId}]`,
                          }
                        : settlement.result
                    return publish(
                      LLMEvent.toolResult({
                        id: event.id,
                        name: event.name,
                        result,
                        output: settlement.output,
                      }),
                      settlement.outputPaths ?? [],
                    )
                  }),
                ),
              ),
              { sessionId: session.id, turnId: currentStep, tool: event.name },
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.timeoutOrElse({
          duration: PROVIDER_TURN_TIMEOUT,
          orElse: () =>
            Effect.fail(
              new LLMError({
                module: "SessionRunner",
                method: "stream",
                reason: new TransportReason({
                  message: "Provider turn exceeded the session time limit",
                  kind: "timeout",
                }),
              }),
            ),
        }),
        Effect.ensuring(
          withPublication(
            FlightRecorder.withSpanEffect(
              "provider",
              "provider.finalize",
              Effect.gen(function* () {
                if (ttftSpan) {
                  publishCompletedActivity(FlightRecorder.endSpan(ttftSpan, { status: "ok" }))
                  ttftSpan = undefined
                }
                if (streamSpan) {
                  publishCompletedActivity(FlightRecorder.endSpan(streamSpan, { status: "ok" }))
                  streamSpan = undefined
                }
                publishCompletedActivity(FlightRecorder.endSpan(providerReqSpan, { status: "ok" }))
                yield* publishStatus(session, {
                  type: "busy",
                  ...(lastCompletedActivity ? { lastCompleted: lastCompletedActivity } : {}),
                })
                yield* publisher.flush()
              }),
              { sessionId: session.id, turnId: currentStep },
            ),
          ),
        ),
      )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          if (
            recoverOverflow &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
          )
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          if (settled._tag === "Failure" && isUserDeclined(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          const stepSettlement = publisher.stepSettlement()
          if (stepSettlement && !publisher.hasProviderError()) {
            TokenLedger.recordUsage(session.id, currentStep, stepSettlement.tokens)
            const endSnapshot = yield* snapshots.capture()
            const files =
              startSnapshot && endSnapshot
                ? yield* snapshots
                    .files({ from: startSnapshot, to: endSnapshot })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            yield* withPublication(
              events.publish(SessionEvent.Step.Ended, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                assistantMessageID: yield* publisher.startAssistant(),
                finish: stepSettlement.finish,
                cost: 0,
                tokens: stepSettlement.tokens,
                snapshot: endSnapshot,
                files,
              }),
            )
            FlightRecorder.endSpan(turnSpan, { status: "ok" })
            const turnEconomics = ExecutionEconomics.getTurnEconomics(currentStep, session.id)
            const sessionMeta = (session as any).metadata as Record<string, unknown> | undefined
            yield* db
              .update(SessionTable)
              .set({
                metadata: {
                  ...(sessionMeta ?? {}),
                  rivet: {
                    ...((sessionMeta?.rivet as Record<string, unknown>) ?? {}),
                    economics: {
                      cacheHitRatio: turnEconomics.tokens.cacheHitRatio,
                      totalTokens: turnEconomics.tokens.inputTokens,
                      cachedTokens: turnEconomics.tokens.cacheReadTokens,
                      recallLatencyMs: turnEconomics.timing.recallLatencyMs,
                      wallClockMs: turnEconomics.timing.wallClockMs,
                      rivetOwnedMs: turnEconomics.timing.rivetOwnedMs,
                      providerTtftMs: turnEconomics.timing.providerTtftMs,
                      providerGenerationMs: turnEconomics.timing.providerGenerationMs,
                      toolExecutionMs: turnEconomics.timing.toolExecutionMs,
                      unattributedMs: turnEconomics.timing.unattributedMs,
                    },
                    flightRecorder: {
                      turnId: currentStep,
                      breakdown: FlightRecorder.getTurnTimeline(currentStep, session.id),
                    },
                  },
                },
              })
              .where(eq(SessionTable.id, session.id))
              .pipe(Effect.orDie)
          }
          if (publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
            return yield* Effect.failCause(settled.cause)

          if (pendingCompletion && publisher.hasUserFacingText()) {
            const proposal = pendingCompletion
            const decision = yield* semantics.proposeCompletion(events, {
              summary: proposal.summary,
              taskId: proposal.taskId,
              baseRevision: proposal.baseRevision,
              responseDelivered: true,
            })
            completionAccepted = decision.completed
            if (decision.completed) {
              pendingCompletion = undefined
              requireResponse = false
            }
          }

          const openObligations = semantics.hardState.openObligationIds()
          const openExecutionObligations = openObligations.filter(
            (id) => semantics.hardState.obligationKind(id) === "execution",
          )
          const openInquiryObligations = openObligations.filter(
            (id) => semantics.hardState.obligationKind(id) === "epistemic_inquiry",
          )

          if (!needsContinuation && openInquiryObligations.length > 0) {
            yield* semantics.satisfyInquiries(events, {
              summary: `Inquiry answered by model response at revision ${semantics.hardState.revision.toJSON()}`,
              atRevision: semantics.hardState.revision,
            })
          }

          const hasUnclosedObligations = openExecutionObligations.length > 0 && !completionAccepted
          // Stagnation signature: open execution obligations plus the latest
          // durable Praxis failure evidence per obligation. Deliberately
          // excludes the revision counter because every recorded event bumps
          // it, which would mask repeated identical failures. Genuine closure,
          // new failing diagnostics, or invalidation all change this signature.
          const stallSignature = [
            [...openExecutionObligations].sort().join(","),
            [...semantics.hardState.verificationReceipts.values()]
              .filter((receipt) => !receipt.passed)
              .map((receipt) => `${receipt.obligationId}:${receipt.diagnostics ?? "undocumented"}`)
              .sort()
              .join("|"),
          ].join("#")
          const maxAllowedSteps = agent.info?.steps ?? 50
          const isMaxSteps = currentStep >= maxAllowedSteps
          const lastUserIndex = context.findLastIndex((m) => m.type === "user")
          const messagesSinceLastUser = lastUserIndex >= 0 ? context.slice(lastUserIndex) : context
          const directivesSinceLastUser = messagesSinceLastUser.filter(
            (m) => m.type === "synthetic" && m.text.includes("[RIVET COGNITIVE DIRECTIVE]"),
          )
          const hasPremiseConflict =
            cognitiveView.premiseConflicts.length > 0 || semantics.hardState.premiseConflicts.length > 0
          const isAutonomousGoal = Boolean(hasAutonomousGoal && latestAdmission?.requiresCompletion)
          const shouldDirect =
            hasUnclosedObligations &&
            isAutonomousGoal &&
            !responseOnly &&
            !hasPremiseConflict &&
            directivesSinceLastUser.length === 0 &&
            !isMaxSteps &&
            !publisher.hasProviderError() &&
            !needsContinuation

          if (shouldDirect) {
            yield* withPublication(
              events.publish(SessionEvent.Synthetic, {
                sessionID: session.id,
                messageID: SessionMessage.ID.create(),
                timestamp: yield* DateTime.now,
                text: `[RIVET COGNITIVE DIRECTIVE] Completion rejected. Open obligations remain to be verified: ${openObligations.join(", ")}. Close each obligation through its declared verifier: perform the real work, call request_verification against an observed execution, then submit request_completion. If an obligation is structurally malformed (e.g. a file path constraint derived from ordinary prose rather than a real workspace path), call invalidate_obligation with its id and reason. NEVER create, rename, or fabricate files, outputs, or evidence to literally satisfy a constraint.`,
              }),
            )
            needsContinuation = true
          }

          return {
            needsContinuation:
              !completionAccepted &&
              !publisher.hasProviderError() &&
              (needsContinuation ||
                pendingCompletion !== undefined ||
                (requireResponse && !publisher.hasUserFacingText())),
            step: currentStep,
            stallSignature,
            pendingCompletion,
            responseRequired: requireResponse && !publisher.hasUserFacingText(),
            toolCallsCount: toolCallsInTurn,
            hasActiveGoal: Boolean(hasAutonomousGoal && openExecutionObligations.length > 0),
            lastToolFingerprint: lastSettledTool?.fingerprint,
            lastToolSummary: lastSettledTool?.summary,
          }
        }),
      )
    }, Effect.scoped)
    type RunTurnResult = {
      readonly needsContinuation: boolean
      readonly step: number
      readonly stallSignature: string
      readonly pendingCompletion?: CompletionProposal
      readonly responseRequired: boolean
      readonly toolCallsCount: number
      readonly hasActiveGoal: boolean
      readonly lastToolFingerprint?: string
      readonly lastToolSummary?: string
    }
    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      completionResponse?: CompletionProposal,
      responseRequired?: boolean,
    ) => Effect.Effect<RunTurnResult, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(
      function* (sessionID, promotion, step, completionResponse, responseRequired) {
        return yield* runTurnAttempt(sessionID, promotion, step, undefined, completionResponse, responseRequired).pipe(
          Effect.catchDefect(
            Effect.fnUntraced(function* (defect) {
              if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
              if (defect.transition._tag === "ContinueAfterOverflowCompaction")
                return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
              yield* Effect.yieldNow
              return yield* runAfterOverflowCompaction(
                sessionID,
                undefined,
                defect.transition.step,
                completionResponse,
                responseRequired,
              )
            }),
          ),
        )
      },
    )

    const runTurn: RunTurn = Effect.fnUntraced(
      function* (sessionID, promotion, step, completionResponse, responseRequired) {
        return yield* runTurnAttempt(
          sessionID,
          promotion,
          step,
          compaction.compactAfterOverflow,
          completionResponse,
          responseRequired,
        ).pipe(
          Effect.catchDefect(
            Effect.fnUntraced(function* (defect) {
              if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
              yield* Effect.yieldNow
              if (defect.transition._tag === "ContinueAfterOverflowCompaction")
                return yield* runAfterOverflowCompaction(
                  sessionID,
                  undefined,
                  defect.transition.step,
                  completionResponse,
                  responseRequired,
                )
              return yield* runTurn(sessionID, undefined, defect.transition.step, completionResponse, responseRequired)
            }),
          ),
        )
      },
    )

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      const session = yield* getSession(input.sessionID)
      let outcome: SessionStatusEvent.Info = {
        type: "idle",
        outcome: "quiescent",
        source: "session_runner",
        phase: "admission",
      }
      return yield* Effect.gen(function* () {
        const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
        const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
        if (!input.force && !hasSteer && !hasQueue) return
        outcome = {
          type: "idle",
          outcome: "completed",
          source: "session_runner",
          phase: "response_delivery",
        }
        yield* failInterruptedTools(input.sessionID)
        let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
        let shouldRun = input.force || hasSteer || hasQueue
        while (shouldRun) {
          let needsContinuation = true
          let step = 1
          let pendingCompletion: CompletionProposal | undefined
          let responseRequired = false
          // Bounded retry policy: autonomous re-drive may continue only while
          // obligation/verification state changes. An unchanged stall signature
          // means the model is burning cycles on the same failure; stop the
          // loop, keep obligations open (fail-closed), and surface the stall.
          const maxStagnantDrives = 2
          let lastStallSignature: string | undefined
          let stagnantDrives = 0
          let lastToolFingerprint: string | undefined
          let lastToolSummary: string | undefined
          let repeatedToolCalls = 0
          let drives = 0
          while (needsContinuation) {
            drives++
            if (drives > 50) {
              yield* Effect.logWarning("autonomous drive limit reached; obligations remain open", {
                "session.id": input.sessionID,
              })
              needsContinuation = false
              outcome = {
                type: "idle",
                outcome: "stalled",
                source: "stagnation_guard",
                reason: "Autonomous continuation exceeded the 50-drive safety limit",
                phase: "continuation",
              }
              break
            }
            const result: RunTurnResult = yield* runTurn(
              input.sessionID,
              promotion,
              step,
              pendingCompletion,
              responseRequired,
            )
            pendingCompletion = result.pendingCompletion
            responseRequired = result.responseRequired
            needsContinuation = result.needsContinuation
            if (result.lastToolFingerprint !== undefined) {
              if (result.lastToolFingerprint === lastToolFingerprint && result.lastToolSummary === lastToolSummary) {
                repeatedToolCalls++
              } else {
                lastToolFingerprint = result.lastToolFingerprint
                lastToolSummary = result.lastToolSummary
                repeatedToolCalls = 1
              }
              if (repeatedToolCalls >= 3) {
                yield* Effect.logWarning("repeated identical tool call halted; side effects will not be retried", {
                  "session.id": input.sessionID,
                  fingerprint: result.lastToolFingerprint,
                })
                needsContinuation = false
                outcome = {
                  type: "idle",
                  outcome: "stalled",
                  source: "stagnation_guard",
                  reason: "Repeated identical tool call produced no new observable result",
                  phase: "tool_settlement",
                }
              }
            }
            if (needsContinuation) {
              // Stagnation guard applies only to autonomous goal re-drives where no forward progress
              // (no tool calls) occurred in the turn and open obligations remain unchanged.
              // Intra-turn tool sequences (e.g. read_file -> read_file -> answer) are normal progress and must not be killed.
              if (result.hasActiveGoal && result.toolCallsCount === 0) {
                if (result.stallSignature === lastStallSignature) {
                  stagnantDrives += 1
                } else {
                  stagnantDrives = 0
                  lastStallSignature = result.stallSignature
                }
                if (stagnantDrives >= maxStagnantDrives) {
                  yield* Effect.logWarning("stagnant autonomous drive halted; obligations remain open", {
                    "session.id": input.sessionID,
                    step: result.step,
                    stallSignature: result.stallSignature,
                  })
                  needsContinuation = false
                  outcome = {
                    type: "idle",
                    outcome: "stalled",
                    source: "stagnation_guard",
                    reason: "Repeated autonomous drive made no observable progress",
                    phase: "continuation",
                  }
                  stagnantDrives = 0
                  lastStallSignature = undefined
                }
              } else {
                stagnantDrives = 0
                lastStallSignature = result.stallSignature
              }
            } else {
              stagnantDrives = 0
              lastStallSignature = undefined
            }
            step = result.step + 1
            promotion = "steer"
            if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
          }
          shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
          promotion = shouldRun ? "queue" : undefined
        }
      }).pipe(
        Effect.onExit((exit) => {
          if (Exit.isSuccess(exit)) return publishStatus(session, outcome)
          const failure = Cause.squash(exit.cause)
          const timedOut =
            failure instanceof LLMError && failure.reason._tag === "Transport" && failure.reason.kind === "timeout"
          return Effect.uninterruptible(
            publishStatus(session, {
              type: "idle",
              outcome: Cause.hasInterrupts(exit.cause) ? "interrupted" : "failed",
              source: Cause.hasInterrupts(exit.cause)
                ? "host_runtime_cancellation"
                : timedOut
                  ? "timeout"
                  : "provider_failure",
              reason: Cause.hasInterrupts(exit.cause)
                ? "Session runner interrupted"
                : timedOut
                  ? "Provider wait exceeded its time limit"
                  : "Session runner failed",
              phase: "session_runner",
            }),
          )
        }),
      )
    })

    return Service.of({
      run,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    AgentV2.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SessionStore.node,
    Location.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Config.node,
    Snapshot.node,
    Database.node,
  ],
})

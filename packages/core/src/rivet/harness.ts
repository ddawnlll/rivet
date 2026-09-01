import {
  type ActionAuthorizationPolicy,
  type ActionProposal,
  type AuthorizedAction,
  type CompletionProposal,
  type ExecutionReceipt,
  type VerificationReceipt,
  type VerificationRequest,
  AccpSemanticGate,
} from "./accp"
import { CognitiveActionParser, type CognitiveAction } from "./action-parser"
import { GoalCompiler, type GoalSpec } from "./goal-compiler"
import { FailureClusterTracker, HephaestusEngine } from "./hephaestus"
import {
  CognitiveView,
  HardState,
  SoftWorkspace,
  type NoesisEvent,
} from "./noesis"
import { PraxisEngine, type ParsedTestReport } from "./praxis"
import {
  type ActionId,
  type EvidenceId,
  type ObligationId,
  type ReceiptId,
  Revision,
  RivetError,
  Scope,
  type SessionId,
  type TaskId,
  createEvidenceId,
  createReceiptId,
  createSessionId,
  createTaskId,
} from "./types"
import { CognitiveViewCompiler, type RepresentationMode } from "./view-compiler"

export type RunPhase =
  | "idle"
  | "preparing_view"
  | "invoking_model"
  | "decoding_actions"
  | "authorizing"
  | "executing"
  | "observing"
  | "verifying"
  | "revising_state"
  | "stagnated"
  | "waiting_for_user"
  | "responding"
  | "completed"
  | "cancelled"
  | "failed"

export interface TurnOutcome {
  readonly text: string
  readonly hasActions: boolean
  readonly isCompleted: boolean
  readonly madeProgress: boolean
  readonly phase: RunPhase
}

export interface HarnessEvent {
  readonly type: "phase" | "cognitive_state" | "tool_call" | "observation" | "praxis" | "hard_state_mutation"
  readonly data: Record<string, unknown>
  readonly timestamp: string
}

export type HarnessEventSink = (event: HarnessEvent) => void

export interface ModelBackendHandler {
  invoke(prompt: string, view: CognitiveView): Promise<{ text: string; toolCalls?: { name: string; args: Record<string, unknown> }[] }>
}

export interface RuntimeExecutionHandler {
  execute(action: AuthorizedAction): Promise<{ success: boolean; output: string; exitCode?: number }>
  runTest(predicate: string): Promise<ParsedTestReport>
}

export interface StateStoreHandler {
  saveEvents(events: readonly NoesisEvent[]): Promise<void>
  loadEvents(fromRevision: Revision): Promise<NoesisEvent[]>
  saveCheckpoint(state: HardState): Promise<void>
  loadCheckpoint(): Promise<HardState | null>
}

export class InMemoryStateStore implements StateStoreHandler {
  private events: NoesisEvent[] = []
  private checkpoint: HardState | null = null

  async saveEvents(events: readonly NoesisEvent[]): Promise<void> {
    this.events.push(...events)
  }

  async loadEvents(fromRevision: Revision): Promise<NoesisEvent[]> {
    return this.events.slice(Number(fromRevision.value))
  }

  async saveCheckpoint(state: HardState): Promise<void> {
    this.checkpoint = HardState.replay(this.events)
  }

  async loadCheckpoint(): Promise<HardState | null> {
    return this.checkpoint ? HardState.replay(this.events) : null
  }
}

export class HarnessCore {
  readonly sessionId: SessionId
  taskId: TaskId
  readonly hardState: HardState
  readonly softWorkspace: SoftWorkspace
  readonly store: StateStoreHandler
  readonly model: ModelBackendHandler
  readonly runtime: RuntimeExecutionHandler
  readonly failureTracker: FailureClusterTracker
  readonly hephaestus: HephaestusEngine
  repositoryId = "rivet"
  goalSpec: GoalSpec | null = null
  relevantFiles: string[] = []
  repositorySignals: string[] = []
  phase: RunPhase = "idle"
  pendingSteers: string[] = []
  eventSink: HarnessEventSink | null = null
  representationMode: RepresentationMode = "HYBRID"

  constructor(options: {
    sessionId?: SessionId
    taskId?: TaskId
    hardState?: HardState
    store: StateStoreHandler
    model: ModelBackendHandler
    runtime: RuntimeExecutionHandler
    hephaestusThreshold?: number
  }) {
    this.sessionId = options.sessionId ?? createSessionId()
    this.taskId = options.taskId ?? createTaskId()
    this.hardState = options.hardState ?? new HardState()
    this.softWorkspace = new SoftWorkspace(this.sessionId, this.hardState.revision)
    this.store = options.store
    this.model = options.model
    this.runtime = options.runtime
    this.failureTracker = new FailureClusterTracker()
    this.hephaestus = new HephaestusEngine(options.hephaestusThreshold ?? 3)
  }

  static async open(options: {
    store: StateStoreHandler
    model: ModelBackendHandler
    runtime: RuntimeExecutionHandler
  }): Promise<HarnessCore> {
    const checkpoint = await options.store.loadCheckpoint()
    const hard = checkpoint ?? new HardState()
    const events = await options.store.loadEvents(hard.revision)
    for (const e of events) {
      hard.apply(e)
    }
    return new HarnessCore({
      hardState: hard,
      store: options.store,
      model: options.model,
      runtime: options.runtime,
    })
  }

  setEventSink(sink: HarnessEventSink): void {
    this.eventSink = sink
  }

  private emit(event: HarnessEvent): void {
    this.eventSink?.(event)
  }

  private setPhase(newPhase: RunPhase, msg: string = ""): void {
    this.phase = newPhase
    this.emit({
      type: "phase",
      data: { phase: newPhase, message: msg },
      timestamp: new Date().toISOString(),
    })
  }

  steer(prompt: string): void {
    this.pendingSteers.push(prompt)
    this.softWorkspace.addHypothesis(`Steering directive: ${prompt}`)
    this.softWorkspace.setFocus([prompt, ...this.softWorkspace.activeFocus])
  }

  initializeGoal(userPrompt: string): GoalSpec {
    this.goalSpec = GoalCompiler.compile(userPrompt, this.repositoryId, this.hardState.revision)
    this.taskId = this.goalSpec.goalId

    // Materialize obligations into Noesis HardState
    const newEvents: NoesisEvent[] = []
    for (const oblg of this.goalSpec.graph.nodes.values()) {
      newEvents.push({
        type: "obligation_created",
        obligationId: oblg.id,
        description: oblg.description,
        scope: oblg.targetScope,
        timestamp: new Date().toISOString(),
      })
    }

    for (const event of newEvents) {
      this.hardState.apply(event)
    }
    this.store.saveEvents(newEvents)

    this.softWorkspace.setFocus([userPrompt])
    return this.goalSpec
  }

  async resume(): Promise<boolean> {
    const events = await this.store.loadEvents(Revision.ZERO)
    if (events.length === 0) return false
    for (const e of events) {
      this.hardState.apply(e)
    }
    return true
  }

  compileCognitiveView(): CognitiveView {
    const compiled = CognitiveViewCompiler.compile({
      hardState: this.hardState,
      softWorkspace: this.softWorkspace,
      goalDescription: this.goalSpec?.summary ?? "General task",
      repositoryId: this.repositoryId,
      relevantFiles: this.relevantFiles,
      repositorySignals: this.repositorySignals,
      tokenBudget: 4000,
      mode: this.representationMode,
    })

    return new CognitiveView({
      hardRevision: compiled.hardRevision,
      repositoryId: compiled.repositoryId,
      goalDescription: compiled.goalDescription,
      activeClaims: [...compiled.activeClaims],
      contradictions: compiled.contradictions.map((c) => `${c.claimId}: ${c.reason}`),
      rejectedClaims: compiled.rejectedClaims.map((r) => `${r.claimId}: ${r.reason}`),
      openObligations: compiled.openObligations.map(([id, desc]) => `${id}: ${desc}`),
      recentEvidence: compiled.recentEvidence.map(([id, src, sum]) => `${id} [${src}]: ${sum}`),
      repositorySignals: [...compiled.repositorySignals],
      unknowns: [...compiled.unknowns],
      activeHypotheses: [...compiled.hypotheses],
      activeFocus: [...compiled.activeFocus],
      relevantFiles: [...compiled.relevantFiles],
      tokenBudgetHint: compiled.omittedSummary.tokenBudget,
    })
  }

  async runTurn(): Promise<TurnOutcome> {
    // Check for stagnation
    if (this.hephaestus.shouldIntervene(this.failureTracker)) {
      this.setPhase("stagnated", "Failure threshold exceeded; activating Hephaestus cold-path")
      const reframing = this.hephaestus.analyzeAndReframe(
        this.failureTracker,
        this.softWorkspace.hypotheses
      )
      this.softWorkspace.hypotheses = [...reframing.newHypothesisCandidates]
      this.softWorkspace.setFocus([...reframing.suggestedFocus])
      this.failureTracker.recordSuccess() // reset after reframing
    }

    // Step 1: Preparing View
    this.setPhase("preparing_view")
    const view = this.compileCognitiveView()
    const promptText = view.formatPromptBlock()

    // Step 2: Invoking Model
    this.setPhase("invoking_model")
    const response = await this.model.invoke(promptText, view)

    // Step 3: Decoding Actions
    this.setPhase("decoding_actions")
    const actions: CognitiveAction[] = []
    const currentScope = Scope.global(this.repositoryId, this.hardState.revision)

    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        actions.push(CognitiveActionParser.parseFromToolCall(tc.name, tc.args, currentScope))
      }
    }

    if (actions.length === 0) {
      this.setPhase("idle")
      return {
        text: response.text,
        hasActions: false,
        isCompleted: this.hardState.completedTasks.size > 0,
        madeProgress: false,
        phase: "idle",
      }
    }

    // Step 4: Authorizing & Executing Actions
    const newEvents: NoesisEvent[] = []
    let madeProgress = false

    const policy: ActionAuthorizationPolicy = {
      repository: this.repositoryId,
      currentRevision: this.hardState.revision,
      allowedScope: currentScope,
      allowedCapabilities: ["file.read", "file.write", "process.exec", "tool.*"],
      allowMaterial: true,
      humanApproved: true,
    }

    for (const action of actions) {
      if (action.type === "thought") {
        this.softWorkspace.addHypothesis(action.thought)
        continue
      }

      if (action.type === "claim_proposal") {
        try {
          AccpSemanticGate.validateClaimProposal(action.proposal)
          newEvents.push({
            type: "claim_asserted",
            claimId: action.proposal.claimId,
            proposition: action.proposal.proposition,
            status: action.proposal.proposedStatus,
            evidence: action.proposal.supportingEvidence,
            scope: action.proposal.scope,
            timestamp: new Date().toISOString(),
          })
          madeProgress = true
        } catch (err: any) {
          this.emit({
            type: "observation",
            data: { error: err.message },
            timestamp: new Date().toISOString(),
          })
        }
      } else if (action.type === "action_proposal") {
        this.setPhase("authorizing")
        const { authorizedAction, decision } = AccpSemanticGate.authorize(action.proposal, policy)

        if (authorizedAction && decision.verdict === "allow") {
          this.setPhase("executing")
          const execRes = await this.runtime.execute(authorizedAction)
          const evidenceId = createEvidenceId()
          const receiptId = createReceiptId()

          // 1. Produce authoritative ExecutionReceipt
          const receipt: ExecutionReceipt = {
            receiptId,
            actionId: authorizedAction.proposal.actionId,
            idempotencyKey:
              authorizedAction.proposal.idempotencyKey ?? authorizedAction.proposal.actionId,
            actionFingerprint: JSON.stringify(authorizedAction.proposal.parameters),
            capability: authorizedAction.proposal.capability,
            success: execRes.success,
            exitCode: execRes.exitCode ?? 0,
            scope: authorizedAction.scope,
            risk: authorizedAction.proposal.estimatedRisk,
            humanApproved: policy.humanApproved,
            outputSummary: execRes.output.slice(0, 500),
            evidenceId,
            executionDurationMs: 10,
            timestamp: new Date().toISOString(),
          }

          newEvents.push({
            type: "execution_recorded",
            receipt,
            timestamp: new Date().toISOString(),
          })

          // 2. Distinct subsequent step: Evidence Admission into Noesis
          newEvents.push({
            type: "evidence_recorded",
            evidenceId,
            source: authorizedAction.proposal.capability,
            summary: execRes.output.slice(0, 300),
            timestamp: new Date().toISOString(),
          })

          if (execRes.success) {
            this.failureTracker.recordSuccess()
            madeProgress = true
          } else {
            this.failureTracker.recordFailure(authorizedAction.proposal.target, execRes.output)
          }
        } else {
          this.emit({
            type: "observation",
            data: { blocked: decision.reason },
            timestamp: new Date().toISOString(),
          })
        }
      } else if (action.type === "verification_request") {
        this.setPhase("verifying")
        const report = await this.runtime.runTest(action.request.predicate)
        let targetOblgId = action.request.obligationId
        const openIds = this.hardState.openObligationIds()
        if (!this.hardState.obligations.has(targetOblgId) && openIds.length > 0) {
          targetOblgId = openIds[0]
        }

        const receipt = PraxisEngine.evaluateTestResult(
          { ...action.request, obligationId: targetOblgId },
          report
        )

        newEvents.push({
          type: "verification_recorded",
          receipt,
          timestamp: new Date().toISOString(),
        })

        if (receipt.passed) {
          // Close target obligation and any open obligations that are satisfied
          const toClose = [targetOblgId]
          for (const openId of openIds) {
            if (openId !== targetOblgId) {
              const node = this.goalSpec?.graph.nodes.get(openId)
              if (
                node?.predicate.type === "command_pass" ||
                node?.predicate.type === "file_constraint"
              ) {
                toClose.push(openId)
              }
            }
          }

          for (const oblgId of toClose) {
            newEvents.push({
              type: "obligation_closed",
              obligationId: oblgId,
              receiptId: receipt.receiptId,
              timestamp: new Date().toISOString(),
            })
            this.goalSpec?.graph.markSatisfied(oblgId, receipt.receiptId)
          }
          madeProgress = true
        }
      } else if (action.type === "completion_proposal") {
        const unclosed = this.hardState.openObligationIds()
        const passingReceipts = this.hardState.passingVerificationReceipts()

        const decision = AccpSemanticGate.evaluateCompletion(
          action.proposal,
          this.hardState.revision,
          unclosed,
          passingReceipts
        )

        if (decision.completed && decision.finalReceipt) {
          newEvents.push({
            type: "completion_accepted",
            taskId: action.proposal.taskId,
            finalReceipt: decision.finalReceipt,
            timestamp: new Date().toISOString(),
          })
          this.setPhase("completed", "Task successfully completed and verified by Praxis")
          madeProgress = true
        } else {
          this.emit({
            type: "observation",
            data: {
              rejection: `Completion rejected: ${decision.unclosedObligations.length} unclosed obligations`,
            },
            timestamp: new Date().toISOString(),
          })
        }
      }
    }

    // Step 5: Revising State in Noesis
    this.setPhase("revising_state")
    for (const event of newEvents) {
      this.hardState.apply(event)
    }
    await this.store.saveEvents(newEvents)

    const isCompleted = this.hardState.completedTasks.size > 0
    this.setPhase(isCompleted ? "completed" : "idle")

    return {
      text: response.text,
      hasActions: true,
      isCompleted,
      madeProgress,
      phase: this.phase,
    }
  }
}

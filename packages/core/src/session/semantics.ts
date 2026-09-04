import fs from "fs"
import path from "path"
import { DateTime, Effect } from "effect"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Global } from "../global"
import { SessionEvent } from "./event"
import { SessionSchema } from "./schema"
import { CognitiveView, HardState, SoftWorkspace, type ClaimRecord, type NoesisEvent, type Observation } from "../rivet/noesis"
import { CognitiveViewCompiler, type RepresentationMode } from "../rivet/view-compiler"
import {
  AccpSemanticGate,
  type ActionAuthorizationPolicy,
  type AuthorizedAction,
  type ClaimProposal,
  type CompletionProposal,
  type ExecutionReceipt,
  type VerificationReceipt,
  type VerificationRequest,
} from "../rivet/accp"
import { PraxisEngine } from "../rivet/praxis"
import { GoalCompiler } from "../rivet/goal-compiler"
import {
  Revision,
  Scope,
  createEvidenceId,
  createClaimId,
  createObligationId,
  createReceiptId,
  createTaskId,
  type ActionId,
  type ClaimId,
  type DependencyRef,
  type EpistemicStatus,
  type InvocationId,
  type MemoryFrontier,
  type PremiseConflict,
  type Provenance,
  type SessionId,
  type TaskId,
  type ValidityPolicy,
} from "../rivet/types"
import { parseProviderToolFrame, type ProviderToolFrame } from "./commitment"
import { ValidityEngine, type EnvironmentChange } from "../rivet/validity"
import { RepositoryCensusProjector } from "../rivet/repository/census"

export interface EpistemicStateSnapshot {
  readonly revision: Revision
  readonly goalDescription: string | null
  readonly activeClaims: readonly ClaimRecord[]
  readonly historicalClaims: readonly ClaimRecord[]
  readonly dirtyClaims: readonly ClaimRecord[]
  readonly supersededClaims: readonly ClaimRecord[]
  readonly rejectedClaims: readonly ClaimRecord[]
  readonly openObligations: readonly [string, string][]
  readonly closedObligations: readonly [string, string][]
  readonly recentEvidence: readonly [string, string][]
  readonly premiseConflicts: readonly PremiseConflict[]
  readonly memoryFrontier: MemoryFrontier
}

import { InMemoryRecallStore, AutomaticRecallAdmissionHook, NoesisRecallProjector, SqliteRecallStore, type RecallStore } from "../rivet/recall"

export class SessionSemantics {
  static workspaceRecallStore: RecallStore | null = null
  private static defaultStore: RecallStore | null = null

  static getDefaultRecallStore(): RecallStore {
    if (SessionSemantics.workspaceRecallStore) return SessionSemantics.workspaceRecallStore
    if (!SessionSemantics.defaultStore) {
      try {
        const dbPath = path.join(Global.Path.data, "rivet-recall.db")
        SessionSemantics.defaultStore = new SqliteRecallStore(dbPath)
      } catch {
        SessionSemantics.defaultStore = new InMemoryRecallStore()
      }
    }
    return SessionSemantics.defaultStore
  }

  readonly hardState: HardState
  readonly softWorkspace: SoftWorkspace
  readonly recallStore: RecallStore

  private constructor(readonly sessionID: SessionSchema.ID, hardState: HardState, recallStore?: RecallStore) {
    this.hardState = hardState
    this.softWorkspace = new SoftWorkspace(sessionID as unknown as SessionId, hardState.revision)
    this.recallStore = recallStore ?? SessionSemantics.getDefaultRecallStore()
  }

  static load = Effect.fn("SessionSemantics.load")(function* (
    db: Database.Interface["db"],
    sessionID: SessionSchema.ID,
    customRecallStore?: RecallStore,
  ) {
    const state = new HardState()
    const aggregate = yield* EventV2.readAggregate(db, {
      aggregateID: sessionID,
      manifest: SessionDurable,
      limit: Number.MAX_SAFE_INTEGER,
    })
    for (const event of aggregate.events) {
      if (event.type !== SessionEvent.Semantic.type) continue
      state.apply(decodeNoesisEvent(event.data.event))
    }
    const store = customRecallStore ?? SessionSemantics.getDefaultRecallStore()
    const docs = NoesisRecallProjector.projectFromHardState(state, sessionID)
    yield* store.index(docs).pipe(Effect.ignore)
    return new SessionSemantics(sessionID, state, store)
  })

  append(events: EventV2.Interface, event: NoesisEvent) {
    const self = this
    return Effect.gen(function* () {
      yield* events.publish(SessionEvent.Semantic, {
        sessionID: self.sessionID,
        timestamp: yield* DateTime.now,
        version: 1,
        event: encodeNoesisEvent(event),
      })
      self.hardState.apply(event)
      const docs = NoesisRecallProjector.projectFromHardState(self.hardState, self.sessionID)
      yield* self.recallStore.index(docs).pipe(Effect.ignore)
    })
  }

  appendAll(events: EventV2.Interface, values: readonly NoesisEvent[]) {
    return Effect.forEach(values, (event) => this.append(events, event), { discard: true })
  }

  scope(repository: string) {
    return Scope.global(repository, this.hardState.revision)
  }

  admitProviderCommitment(frame: ProviderToolFrame, scope: Scope, policy: ActionAuthorizationPolicy) {
    const commitment = parseProviderToolFrame(frame, scope)
    if (commitment.type !== "action_proposal") return { commitment, authorizedAction: null }
    const authorization = AccpSemanticGate.authorize(commitment.proposal, policy)
    return { commitment, authorizedAction: authorization.authorizedAction, decision: authorization.decision }
  }

  executeAuthorizedAction<A, E>(
    action: AuthorizedAction,
    execute: (action: AuthorizedAction) => Effect.Effect<A, E>,
    summarize: (value: A) => string,
  ): Effect.Effect<{ readonly value: A; readonly receipt: ExecutionReceipt }, E | Error> {
    if (!action.revision.equals(this.hardState.revision))
      return Effect.fail(new Error(`Stale authorized action revision: ${action.revision.toJSON()}`))
    const started = Date.now()
    return execute(action).pipe(
      Effect.map((value) => ({
        value,
        receipt: {
          receiptId: createReceiptId(),
          actionId: action.proposal.actionId,
          idempotencyKey: action.proposal.idempotencyKey ?? action.proposal.actionId,
          actionFingerprint: JSON.stringify(action.proposal.parameters),
          capability: action.proposal.capability,
          success: true,
          exitCode: 0,
          scope: action.scope,
          risk: action.proposal.estimatedRisk,
          humanApproved: action.decision.reason.includes("human"),
          outputSummary: summarize(value),
          observations: value,
          evidenceId: createEvidenceId(),
          executionDurationMs: Date.now() - started,
          timestamp: new Date().toISOString(),
        } satisfies ExecutionReceipt,
      })),
    )
  }

  recordExecution(events: EventV2.Interface, receipt: ExecutionReceipt) {
    return this.append(events, { type: "execution_recorded", receipt, timestamp: new Date().toISOString() })
  }

  recordInvocation(events: EventV2.Interface, invocationId: InvocationId, modelId: string) {
    return this.append(events, {
      type: "model_invocation_recorded",
      record: {
        invocationId,
        modelId,
        reason: "SEMANTIC_DIAGNOSIS",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        timestamp: new Date().toISOString(),
      },
    })
  }

  recordObservation(events: EventV2.Interface, receipt: ExecutionReceipt, summary: string) {
    const observation: Observation = {
      observationId: `${receipt.receiptId}:observation`,
      actionId: receipt.actionId,
      scope: receipt.scope,
      summary,
      timestamp: new Date().toISOString(),
    }
    return this.append(events, { type: "observation_recorded", observation })
  }

  admitEvidence(events: EventV2.Interface, receipt: ExecutionReceipt, source: string, summary: string) {
    return this.append(events, {
      type: "evidence_recorded",
      evidenceId: receipt.evidenceId,
      source,
      summary,
      timestamp: new Date().toISOString(),
    })
  }

  recordVerification(events: EventV2.Interface, receipt: VerificationReceipt) {
    const self = this
    return Effect.gen(function* () {
      if (!self.hardState.evidence.has(receipt.evidenceId))
        return yield* Effect.fail(new Error("Verification receipt references unadmitted evidence"))
      yield* self.append(events, {
        type: "verification_recorded",
        receipt,
        timestamp: new Date().toISOString(),
      })
      if (receipt.passed && self.hardState.obligations.has(receipt.obligationId)) {
        yield* self.append(events, {
          type: "obligation_closed",
          obligationId: receipt.obligationId,
          receiptId: receipt.receiptId,
          timestamp: new Date().toISOString(),
        })
      }
    })
  }

  verifyLastExecution(events: EventV2.Interface, request: VerificationRequest) {
    const execution = this.hardState.executionReceipts.findLast(
      (receipt) => receipt.scope.repository === request.targetScope.repository,
    )
    if (!execution?.observations) return Effect.fail(new Error("Praxis requires an observed execution result"))
    if (!execution.success) return Effect.fail(new Error("Praxis cannot verify a failed execution"))
    if (!this.hardState.evidence.has(execution.evidenceId))
      return Effect.fail(new Error("Praxis requires explicitly admitted execution evidence"))
    if (request.targetScope.revision.value < execution.scope.revision.value)
      return Effect.fail(new Error("Praxis verification scope is stale for the observed execution"))
    const requestScopeAtExecutionRevision = new Scope({
      repository: request.targetScope.repository,
      pathPattern: request.targetScope.pathPattern,
      revision: execution.scope.revision,
    })
    if (!requestScopeAtExecutionRevision.containsScope(execution.scope))
      return Effect.fail(new Error("Praxis verification scope does not contain the observed execution scope"))
    const observed = isRecord(execution.observations) && "value" in execution.observations
      ? execution.observations.value
      : isRecord(execution.observations) && typeof execution.observations.output === "string"
        ? execution.observations.output
        : execution.observations
    const stdout = typeof observed === "string" ? observed : JSON.stringify(observed)
    const predicate = request.predicate.toLowerCase()
    const framework = predicate.includes("cargo")
      ? "cargo"
      : predicate.includes("pytest")
        ? "pytest"
        : predicate.includes("go test")
          ? "go"
          : "bun"
    const report = PraxisEngine.parseTestOutput(framework, stdout)
    const obligationId = this.hardState.obligations.has(request.obligationId)
      ? request.obligationId
      : this.hardState.openObligationIds()[0]
    if (!obligationId) return Effect.fail(new Error("Praxis verification has no applicable open obligation"))
    const receipt = {
      ...PraxisEngine.evaluateTestResult({ ...request, obligationId, targetScope: execution.scope }, report),
      evidenceId: execution.evidenceId,
    }
    return this.recordVerification(events, receipt).pipe(Effect.as(receipt))
  }

  proposeVerification(
    events: EventV2.Interface,
    input: { readonly repository: string; readonly predicate: string; readonly obligationId?: string },
  ) {
    const request: VerificationRequest = {
      obligationId: (input.obligationId ?? createObligationId()) as VerificationRequest["obligationId"],
      predicate: input.predicate,
      targetScope: this.scope(input.repository),
      timeoutSeconds: 30,
      timestamp: new Date().toISOString(),
    }
    return this.verifyLastExecution(events, request)
  }

  /**
   * Adjudicates and admits a new claim proposal through the Write-Time Validity Barrier.
   * Distinguishes between supersession (historical replacement) and contradiction.
   */
  admitClaim(
    events: EventV2.Interface,
    proposal: ClaimProposal,
    options?: {
      readonly validityPolicy?: ValidityPolicy
      readonly dependencies?: readonly DependencyRef[]
      readonly provenance?: Provenance
      readonly validFromRevision?: Revision
    },
  ) {
    const self = this
    return Effect.gen(function* () {
      try {
        AccpSemanticGate.validateClaimProposal(proposal)
      } catch (error) {
        return yield* Effect.fail(error instanceof Error ? error : new Error(String(error)))
      }

      if (proposal.supportingEvidence.length > 0 && !self.hardState.canPromoteToSupported(proposal.supportingEvidence))
        return yield* Effect.fail(new Error("Claim evidence has not been admitted by the Harness"))

      // Write-Time Barrier: Adjudicate against existing state
      const adjudication = ValidityEngine.adjudicateWriteTime(
        self.hardState,
        proposal,
        options?.validityPolicy ?? "EPISTEMIC",
      )

      if (adjudication.action === "supersede" && adjudication.supersededClaimId) {
        yield* self.append(events, {
          type: "claim_superseded",
          claimId: adjudication.supersededClaimId,
          supersededBy: proposal.claimId,
          reason: `Superseded by updated claim ${proposal.claimId}: '${proposal.proposition}'`,
          timestamp: proposal.timestamp,
        })
      } else if (adjudication.action === "contradict" && adjudication.contradictionReason) {
        yield* self.append(events, {
          type: "claim_contradicted",
          claimId: proposal.claimId,
          contradictedBy: [...proposal.supportingEvidence],
          reason: adjudication.contradictionReason,
          scope: proposal.scope,
          timestamp: proposal.timestamp,
        })
      }

      yield* self.append(events, {
        type: "claim_asserted",
        claimId: proposal.claimId,
        proposition: proposal.proposition,
        status: proposal.proposedStatus,
        evidence: proposal.supportingEvidence,
        dependencies: options?.dependencies ? [...options.dependencies] : undefined,
        scope: proposal.scope,
        validFromRevision: options?.validFromRevision ?? self.hardState.revision,
        validityPolicy: options?.validityPolicy ?? "EPISTEMIC",
        provenance: options?.provenance,
        timestamp: proposal.timestamp,
      })
    })
  }

  proposeClaim(
    events: EventV2.Interface,
    input: {
      readonly repository: string
      readonly proposition: string
      readonly supportingEvidence?: readonly string[]
      readonly validityPolicy?: ValidityPolicy
      readonly dependencies?: readonly DependencyRef[]
      readonly provenance?: Provenance
      readonly validFromRevision?: Revision
    },
  ) {
    return this.admitClaim(
      events,
      {
        claimId: createClaimId(),
        proposition: input.proposition,
        proposedStatus: "supported",
        supportingEvidence: [...(input.supportingEvidence ?? [])] as ClaimProposal["supportingEvidence"],
        scope: this.scope(input.repository),
        timestamp: new Date().toISOString(),
      },
      {
        validityPolicy: input.validityPolicy,
        dependencies: input.dependencies,
        provenance: input.provenance,
        validFromRevision: input.validFromRevision,
      },
    )
  }

  /**
   * Change-Time Barrier: Evaluates environmental changes and marks affected claims DIRTY.
   */
  handleEnvironmentChanges(events: EventV2.Interface, changes: readonly EnvironmentChange[]) {
    const self = this
    return Effect.gen(function* () {
      const impact = ValidityEngine.analyzeEnvironmentChanges(self.hardState.validityGraph, self.hardState, changes)
      if (impact.allDirtyClaimIds.length === 0) return impact

      for (const claimId of impact.allDirtyClaimIds) {
        yield* self.append(events, {
          type: "claim_dirtied",
          claimId,
          reason: `Environmental dependency modified: ${impact.affectedDependencies.join(", ")}`,
          timestamp: new Date().toISOString(),
        })
      }

      return impact
    })
  }

  /**
   * First-class Epistemic State Query: Allows inspecting memory without raw SQLite queries.
   */
  getEpistemicState(scope?: Scope): EpistemicStateSnapshot {
    const barrier = ValidityEngine.applyReadTimeBarrier(this.hardState, scope)
    const memoryFrontier = ValidityEngine.compileMemoryFrontier(this.hardState)

    const openObligations: [string, string][] = []
    for (const [id, desc] of this.hardState.obligations) {
      openObligations.push([id, desc])
    }

    const closedObligations: [string, string][] = []
    for (const [id, rcpt] of this.hardState.closedObligations) {
      closedObligations.push([id, rcpt])
    }

    const recentEvidence: [string, string][] = []
    for (const [id, summary] of this.hardState.evidence) {
      recentEvidence.push([id, summary])
    }

    return {
      revision: this.hardState.revision,
      goalDescription: this.hardState.goalDescription,
      activeClaims: barrier.activeClaims,
      historicalClaims: barrier.historicalClaims,
      dirtyClaims: barrier.dirtyClaims,
      supersededClaims: barrier.supersededClaims,
      rejectedClaims: barrier.rejectedClaims,
      openObligations,
      closedObligations,
      recentEvidence,
      premiseConflicts: [...this.hardState.premiseConflicts],
      memoryFrontier,
    }
  }

  completionDecision(proposal: CompletionProposal) {
    return AccpSemanticGate.evaluateCompletion(
      proposal,
      this.hardState.revision,
      this.hardState.openObligationIds(),
      this.hardState.passingVerificationReceipts(),
    )
  }

  proposeCompletion(
    events: EventV2.Interface,
    input: {
      readonly summary: string
      readonly claimsAddressed?: readonly ClaimId[]
      readonly taskId?: TaskId
      readonly baseRevision?: Revision
    },
  ) {
    const proposal: CompletionProposal = {
      taskId: input.taskId ?? createTaskId(),
      summary: input.summary,
      claimsAddressed: [...(input.claimsAddressed ?? [])],
      baseRevision: input.baseRevision ?? this.hardState.revision,
      timestamp: new Date().toISOString(),
    }
    const decision = this.completionDecision(proposal)
    if (!decision.completed || !decision.finalReceipt) return Effect.succeed(decision)
    return this.append(events, {
      type: "completion_accepted",
      taskId: decision.taskId,
      finalReceipt: decision.finalReceipt,
      timestamp: decision.timestamp,
    }).pipe(Effect.as(decision))
  }

  ensureGoal(events: EventV2.Interface, goal: string, repository: string) {
    if (this.hardState.goalDescription === goal) return Effect.void
    const compiled = GoalCompiler.compile(goal, repository, this.hardState.revision)
    const self = this
    return Effect.gen(function* () {
      yield* self.append(events, { type: "goal_set", goal, timestamp: new Date().toISOString() })
      yield* self.appendAll(
        events,
        [...compiled.graph.nodes.values()].map((obligation) => ({
          type: "obligation_created" as const,
          obligationId: obligation.id,
          description: obligation.description,
          scope: obligation.targetScope,
          timestamp: new Date().toISOString(),
        })),
      )
    })
  }

  cognitiveView(input: {
    readonly repositoryId: string
    readonly goalDescription?: string
    readonly userPrompt?: string
    readonly currentEnvironmentLanguage?: string
    readonly relevantFiles?: readonly string[]
    readonly repositorySignals?: readonly string[]
    readonly focusSymbols?: readonly string[]
    readonly scope?: Scope
    readonly tokenBudget?: number
    readonly mode?: RepresentationMode
  }): Effect.Effect<CognitiveView> {
    const self = this
    return Effect.gen(function* () {
      let memoryFrontier: MemoryFrontier | undefined
      if (input.userPrompt) {
        memoryFrontier = yield* AutomaticRecallAdmissionHook.admitRecall({
          hardState: self.hardState,
          recallStore: self.recallStore,
          userPrompt: input.userPrompt,
          goalDescription: input.goalDescription ?? self.hardState.goalDescription ?? "Continue the current goal",
          repositoryId: input.repositoryId,
          focusSymbols: input.focusSymbols,
        }).pipe(Effect.orElseSucceed(() => undefined))
      }

      const compiled = CognitiveViewCompiler.compile({
        hardState: self.hardState,
        softWorkspace: self.softWorkspace,
        goalDescription: input.goalDescription ?? self.hardState.goalDescription ?? "Continue the current goal",
        repositoryId: input.repositoryId,
        userPrompt: input.userPrompt,
        currentEnvironmentLanguage: input.currentEnvironmentLanguage,
        relevantFiles: input.relevantFiles,
        repositorySignals: input.repositorySignals,
        focusSymbols: input.focusSymbols,
        memoryFrontier,
        scope: input.scope,
        tokenBudget: input.tokenBudget ?? 4000,
        mode: input.mode ?? "HYBRID",
      })

      return new CognitiveView({
        hardRevision: compiled.hardRevision,
        repositoryId: compiled.repositoryId,
        goalDescription: compiled.goalDescription,
        activeClaims: [...compiled.activeClaims],
        contradictions: compiled.contradictions.map((item) => `${item.claimId}: ${item.reason}`),
        rejectedClaims: compiled.rejectedClaims.map((item) => `${item.claimId}: ${item.reason}`),
        openObligations: compiled.openObligations.map(([id, description]) => `${id}: ${description}`),
        recentEvidence: compiled.recentEvidence.map(([id, source, summary]) => `${id} [${source}]: ${summary}`),
        repositorySignals: [...compiled.repositorySignals],
        unknowns: [...compiled.unknowns],
        activeHypotheses: [...compiled.hypotheses],
        activeFocus: [...compiled.activeFocus],
        relevantFiles: [...compiled.relevantFiles],
        premiseConflicts: [...compiled.premiseConflicts],
        memoryFrontier: compiled.memoryFrontier,
        tokenBudgetHint: compiled.omittedSummary.tokenBudget,
      })
    })
  }

  /**
   * T0 Cold Start Repository Census Bootstrap:
   * When session Hard State is empty (no claims, no observations), scans the repository workspace,
   * projects deterministic architectural census, and asserts baseline claims & observations.
   */
  ensureColdStart(events: EventV2.Interface, directory: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (self.hardState.claims.size > 0 || self.hardState.observations.size > 0) {
        return
      }

      const files = yield* Effect.sync(() => discoverWorkspaceFiles(directory))
      if (files.length === 0) return

      const census = RepositoryCensusProjector.projectFromFiles(files, self.hardState.revision)
      const evidenceId = createEvidenceId("ev_census_bootstrap")

      // 1. Evidence of Cold Start discovery
      yield* self.append(events, {
        type: "evidence_recorded",
        evidenceId,
        source: "repository_census",
        summary: `T0 Cold Start census cataloged ${census.totalTrackedFiles} tracked files, primary languages: [${census.primaryLanguages.join(", ")}], package managers: [${census.packageManagers.join(", ")}], workspaces: ${census.workspaces.length} packages.`,
        timestamp: new Date().toISOString(),
      })

      // 2. Baseline Observation
      yield* self.append(events, {
        type: "observation_recorded",
        observation: {
          observationId: "obs_census_bootstrap",
          actionId: "action_census_bootstrap" as ActionId,
          scope: self.scope(directory),
          summary: `T0 Census Bootstrap completed: ${census.totalTrackedFiles} files and ${census.workspaces.length} packages discovered in repository.`,
          timestamp: new Date().toISOString(),
        },
      })

      // 3. Primary Languages Claim
      if (census.primaryLanguages.length > 0) {
        yield* self.append(events, {
          type: "claim_asserted",
          claimId: createClaimId("claim_census_languages"),
          proposition: `Repository primary implementation language(s): ${census.primaryLanguages.join(", ")}`,
          status: "supported",
          evidence: [evidenceId],
          scope: self.scope(directory),
          validityPolicy: "DERIVED_STATE",
          dependencies: census.manifestFiles.map((m) => ({ type: "manifest" as const, name: m })),
          validFromRevision: self.hardState.revision,
          timestamp: new Date().toISOString(),
        })
      }

      // 4. Workspaces Structure Claim
      if (census.workspaces.length > 0) {
        const wsNames =
          census.workspaces.slice(0, 8).map((w) => w.name).join(", ") +
          (census.workspaces.length > 8 ? ` and ${census.workspaces.length - 8} more` : "")
        yield* self.append(events, {
          type: "claim_asserted",
          claimId: createClaimId("claim_census_workspaces"),
          proposition: `Repository monorepo workspace structure comprises ${census.workspaces.length} packages: ${wsNames}`,
          status: "supported",
          evidence: [evidenceId],
          scope: self.scope(directory),
          validityPolicy: "CURRENT_STATE",
          dependencies: census.workspaces.slice(0, 20).map((w) => ({ type: "manifest" as const, name: w.manifestPath })),
          validFromRevision: self.hardState.revision,
          timestamp: new Date().toISOString(),
        })
      }

      // 5. Build and Test Toolchains Claim
      const toolchains = [...census.buildSystems, ...census.testFrameworks]
      if (toolchains.length > 0) {
        yield* self.append(events, {
          type: "claim_asserted",
          claimId: createClaimId("claim_census_toolchains"),
          proposition: `Repository build and test toolchains: ${toolchains.join(", ")}`,
          status: "supported",
          evidence: [evidenceId],
          scope: self.scope(directory),
          validityPolicy: "DERIVED_STATE",
          dependencies: census.manifestFiles.map((m) => ({ type: "manifest" as const, name: m })),
          validFromRevision: self.hardState.revision,
          timestamp: new Date().toISOString(),
        })
      }
    })
  }
}

function discoverWorkspaceFiles(directory: string): string[] {
  try {
    if (fs.existsSync(path.join(directory, ".git"))) {
      const proc = Bun.spawnSync(["git", "ls-files"], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      })
      if (proc.exitCode === 0) {
        const out = proc.stdout.toString()
        if (out.trim().length > 0) {
          return out.trim().split("\n").filter(Boolean)
        }
      }
    }
  } catch {
    // Fall back to fast recursive directory scan
  }

  const results: string[] = []
  function scan(dir: string, prefix = "", depth = 0) {
    if (depth > 6 || results.length > 10000) return
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (
          e.name.startsWith(".") ||
          e.name === "node_modules" ||
          e.name === "dist" ||
          e.name === "target" ||
          e.name === "build" ||
          e.name === ".next" ||
          e.name === "artifacts" ||
          e.name === "vendor"
        ) {
          continue
        }
        const rel = prefix ? `${prefix}/${e.name}` : e.name
        if (e.isDirectory()) {
          scan(path.join(dir, e.name), rel, depth + 1)
        } else {
          results.push(rel)
        }
      }
    } catch {
      // Ignore unreadable dirs
    }
  }
  scan(directory)
  return results
}

function encodeNoesisEvent(event: NoesisEvent): unknown {
  return JSON.parse(JSON.stringify(event))
}

function decodeNoesisEvent(value: unknown): NoesisEvent {
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("Invalid persisted Rivet semantic event")
  const event: Record<string, unknown> = { ...value }
  if ("scope" in event) event.scope = decodeScope(event.scope)
  if ("validFromRevision" in event && event.validFromRevision !== undefined) {
    event.validFromRevision = Revision.from(typeof event.validFromRevision === "string" || typeof event.validFromRevision === "number" ? event.validFromRevision : 0)
  }
  if (event.type === "execution_recorded" && isRecord(event.receipt)) {
    event.receipt = { ...event.receipt, scope: decodeScope(event.receipt.scope) }
  }
  if (event.type === "observation_recorded" && isRecord(event.observation)) {
    event.observation = { ...event.observation, scope: decodeScope(event.observation.scope) }
  }
  if (event.type === "verification_recorded" && isRecord(event.receipt)) {
    event.receipt = { ...event.receipt, verifiedScope: decodeScope(event.receipt.verifiedScope) }
  }
  return event as unknown as NoesisEvent
}

function decodeScope(value: unknown): Scope {
  if (!isRecord(value) || typeof value.repository !== "string") throw new Error("Invalid persisted Rivet scope")
  return new Scope({
    repository: value.repository,
    pathPattern: typeof value.path_pattern === "string" ? value.path_pattern : null,
    revision: Revision.from(typeof value.revision === "string" || typeof value.revision === "number" ? value.revision : 0),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

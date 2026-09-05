import fs from "fs"
import path from "path"
import { DateTime, Effect } from "effect"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Global } from "../global"
import { SessionEvent } from "./event"
import { SessionSchema } from "./schema"
import {
  CognitiveView,
  HardState,
  SoftWorkspace,
  type ClaimRecord,
  type NoesisEvent,
  type Observation,
} from "../rivet/noesis"
import { CognitiveViewCompiler, describePredicate, type RepresentationMode } from "../rivet/view-compiler"
import {
  AccpSemanticGate,
  type ActionAuthorizationPolicy,
  type AuthorizedAction,
  type ClaimProposal,
  type CompletionProposal,
  type ExecutionReceipt,
  type InquiryReceipt,
  type VerificationReceipt,
  type VerificationRequest,
} from "../rivet/accp"
import { GoalCompiler, type ObligationPredicate } from "../rivet/goal-compiler"
import { TaskControlController } from "../rivet/task-control"
import {
  Induction,
  RepositoryInduction,
  isMarkerStale,
  readInductionMarker,
  writeInductionMarker,
  type InductionResult,
} from "../rivet/repository/induction"
import { RivetInductionEvent } from "@opencode-ai/schema/rivet-induction-event"
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
  type EvidenceId,
  type FailureClass,
  type InvocationId,
  type MemoryFrontier,
  type ObligationId,
  type ObligationKind,
  type PremiseConflict,
  type Provenance,
  type RecoveryId,
  type RecoveryVerificationReceipt,
  type SessionId,
  type TaskId,
  type TaskAuthority,
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

import {
  InMemoryRecallStore,
  AutomaticRecallAdmissionHook,
  NoesisRecallProjector,
  SqliteRecallStore,
  type RecallStore,
} from "../rivet/recall"

export class SessionSemantics {
  static workspaceRecallStore: RecallStore | null = null
  private static defaultStore: RecallStore | null = null

  static getDefaultRecallStore(): RecallStore {
    if (SessionSemantics.workspaceRecallStore) return SessionSemantics.workspaceRecallStore
    if (!SessionSemantics.defaultStore) {
      if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
        SessionSemantics.defaultStore = new InMemoryRecallStore()
        return SessionSemantics.defaultStore
      }
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

  private constructor(
    readonly sessionID: SessionSchema.ID,
    hardState: HardState,
    recallStore?: RecallStore,
  ) {
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
      const deltaDocs = NoesisRecallProjector.projectEventDelta(event, self.hardState, self.sessionID)
      if (deltaDocs.length > 0) {
        yield* self.recallStore.index(deltaDocs).pipe(Effect.ignore)
      }
    })
  }

  appendAll(events: EventV2.Interface, values: readonly NoesisEvent[]) {
    const self = this
    return Effect.gen(function* () {
      if (values.length === 0) return
      const now = yield* DateTime.now
      const allDeltaDocs = []
      for (const event of values) {
        yield* events.publish(SessionEvent.Semantic, {
          sessionID: self.sessionID,
          timestamp: now,
          version: 1,
          event: encodeNoesisEvent(event),
        })
        self.hardState.apply(event)
        const deltaDocs = NoesisRecallProjector.projectEventDelta(event, self.hardState, self.sessionID)
        if (deltaDocs.length > 0) {
          allDeltaDocs.push(...deltaDocs)
        }
      }
      if (allDeltaDocs.length > 0) {
        yield* self.recallStore.index(allDeltaDocs).pipe(Effect.ignore)
      }
    })
  }

  scope(repository: string) {
    return Scope.global(repository, this.hardState.revision)
  }

  admitProviderCommitment(frame: ProviderToolFrame, scope: Scope, policy: ActionAuthorizationPolicy) {
    const parsed = parseProviderToolFrame(frame, scope)
    const commitment =
      parsed.type === "completion_proposal" && this.hardState.activeTaskId
        ? { ...parsed, proposal: { ...parsed.proposal, taskId: this.hardState.activeTaskId } }
        : parsed
    if (commitment.type !== "action_proposal") return { commitment, authorizedAction: null }
    const authorization = AccpSemanticGate.authorize(commitment.proposal, {
      ...policy,
      // The provider cannot supply this authority. Re-derive it from the
      // durable goal admission state at the semantic boundary.
      taskAuthority: this.hardState.activeTaskAuthority ?? "normal_project_task",
    })
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
          target: action.proposal.target,
          success: true,
          exitCode: 0,
          scope: action.scope,
          risk: action.proposal.estimatedRisk,
          // Provider output and policy text are not a human approval receipt.
          // A future approval event may set this explicitly at admission.
          humanApproved: false,
          outputSummary: summarize(value),
          observations: value,
          evidenceId: createEvidenceId(),
          executionDurationMs: Date.now() - started,
          timestamp: new Date().toISOString(),
        } satisfies ExecutionReceipt,
      })),
    )
  }

  claimExecution(events: EventV2.Interface, action: AuthorizedAction) {
    const baseIdempotencyKey = action.proposal.idempotencyKey ?? action.proposal.actionId
    const actionFingerprint = JSON.stringify(action.proposal.parameters)
    const settled = this.hardState.executionReceipts.find(
      (receipt) => receipt.idempotencyKey === baseIdempotencyKey && receipt.actionFingerprint === actionFingerprint,
    )
    if (settled) return Effect.succeed({ status: "settled" as const, receipt: settled })
    const existing = this.hardState.executionClaims.get(baseIdempotencyKey)
    const idempotencyKey =
      existing && existing.actionFingerprint !== actionFingerprint
        ? `${baseIdempotencyKey}:${actionFingerprint}`
        : baseIdempotencyKey
    const scopedExisting = this.hardState.executionClaims.get(idempotencyKey)
    if (scopedExisting) {
      return Effect.succeed({
        status: "uncertain" as const,
        message: `An earlier process claimed idempotency key ${idempotencyKey}, but no settlement receipt was committed; execution was not retried`,
      })
    }
    return this.append(events, {
      type: "execution_claimed",
      actionId: action.proposal.actionId,
      idempotencyKey,
      actionFingerprint,
      scope: action.scope,
      timestamp: new Date().toISOString(),
    }).pipe(Effect.as({ status: "claimed" as const }))
  }

  isActionCurrent(action: AuthorizedAction): boolean {
    return action.revision.equals(this.hardState.revision)
  }

  recordExecution(events: EventV2.Interface, receipt: ExecutionReceipt) {
    return this.append(events, { type: "execution_recorded", receipt, timestamp: new Date().toISOString() })
  }

  recordInvocation(events: EventV2.Interface, invocationId: InvocationId, modelId: string) {
    return this.append(events, {
      type: "model_invocation_recorded",
      record: {
        invocationId,
        focusId: this.hardState.executionFocus?.id ?? null,
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
      executionReceiptId: receipt.receiptId,
      timestamp: new Date().toISOString(),
    })
  }

  recordVerification(events: EventV2.Interface, receipt: VerificationReceipt) {
    const self = this
    return Effect.gen(function* () {
      if (
        !self.hardState.obligations.has(receipt.obligationId) &&
        (!self.hardState.closedObligations.has(receipt.obligationId) || receipt.passed)
      ) {
        return yield* Effect.fail(new Error("Verification receipt must target an active obligation"))
      }
      const predicate = self.hardState.obligationPredicates.get(receipt.obligationId)
      if (!predicate) {
        return yield* Effect.fail(
          new Error("Verification receipt cannot be admitted without the obligation's declared predicate"),
        )
      }
      if (!self.hardState.evidence.has(receipt.evidenceId))
        return yield* Effect.fail(new Error("Verification receipt references unadmitted evidence"))
      const obligationScope = self.hardState.obligationScopes.get(receipt.obligationId)
      if (!obligationScope || obligationScope.repository !== receipt.verifiedScope.repository) {
        return yield* Effect.fail(new Error("Verification receipt scope does not match the obligation scope"))
      }
      const predicateDescription = describePredicate(predicate)
      if (receipt.predicate !== predicateDescription) {
        return yield* Effect.fail(
          new Error("Verification receipt predicate does not match the obligation's declared predicate"),
        )
      }
      const execution = receipt.executionReceiptId
        ? self.hardState.executionReceipts.find((candidate) => candidate.receiptId === receipt.executionReceiptId)
        : undefined
      if (receipt.executionReceiptId && !execution) {
        return yield* Effect.fail(new Error("Verification receipt references an unknown execution receipt"))
      }
      if (execution && self.hardState.evidenceExecutionReceipts.get(receipt.evidenceId) !== execution.receiptId) {
        return yield* Effect.fail(
          new Error("Verification evidence is not linked to the execution receipt used by Praxis"),
        )
      }
      if (predicate.type === "file_constraint") {
        const actual = evaluateFileConstraintOnDisk(receipt.verifiedScope.repository, predicate)
        if (receipt.passed !== actual.passed) {
          return yield* Effect.fail(new Error("Verification result does not match the observed filesystem predicate"))
        }
      }
      if (predicate.type === "claims_verified") {
        const actual = self.evaluateClaimsVerified(receipt.obligationId, predicate)
        if (receipt.passed !== actual.passed) {
          return yield* Effect.fail(new Error("Verification result does not match admitted claim evidence"))
        }
      }
      if (predicate.type === "command_pass") {
        if (!execution || execution.target !== predicate.command) {
          return yield* Effect.fail(
            new Error("Verification execution does not match the obligation's command predicate"),
          )
        }
        const observedExitCode = execution.exitCode ?? (execution.success ? 0 : 1)
        if (receipt.passed !== (execution.success && observedExitCode === predicate.expectedExitCode)) {
          return yield* Effect.fail(new Error("Verification result does not match the observed command execution"))
        }
      }
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

  /**
   * Closes an epistemic inquiry obligation with its kind-appropriate proof
   * object: an InquiryReceipt binding the obligation to the canonical revision
   * of the authoritative projection that answered it. No execution, no Praxis.
   * Returns undefined when no open epistemic inquiry obligation applies.
   */
  satisfyInquiries(
    events: EventV2.Interface,
    input: { readonly summary: string; readonly obligationId?: string; readonly atRevision?: Revision },
  ): Effect.Effect<readonly InquiryReceipt[]> {
    const openInquiryIds = this.hardState
      .openObligationIds()
      .filter((id) => this.hardState.obligationKind(id) === "epistemic_inquiry")
    const targetIds =
      input.obligationId !== undefined ? openInquiryIds.filter((id) => id === input.obligationId) : openInquiryIds
    if (targetIds.length === 0) return Effect.succeed([])
    const self = this
    return Effect.gen(function* () {
      const receipts: InquiryReceipt[] = []
      for (const oblgId of targetIds) {
        const receipt: InquiryReceipt = {
          receiptId: createReceiptId(),
          obligationId: oblgId,
          satisfiedAtRevision: input.atRevision ?? self.hardState.revision,
          summary: input.summary,
          timestamp: new Date().toISOString(),
        }
        yield* self.append(events, {
          type: "inquiry_satisfied",
          obligationId: oblgId,
          receiptId: receipt.receiptId,
          satisfiedAtRevision: receipt.satisfiedAtRevision,
          summary: receipt.summary,
          timestamp: receipt.timestamp,
        })
        receipts.push(receipt)
      }
      return receipts
    })
  }

  satisfyInquiry(
    events: EventV2.Interface,
    input: { readonly summary: string; readonly obligationId?: string; readonly atRevision?: Revision },
  ): Effect.Effect<InquiryReceipt | undefined> {
    return this.satisfyInquiries(events, input).pipe(Effect.map((receipts) => receipts[0]))
  }

  invalidateObligation(
    events: EventV2.Interface,
    input: { readonly obligationId: string; readonly reason: string },
  ): Effect.Effect<{ readonly obligationId: string; readonly invalidated: boolean; readonly reason: string }, Error> {
    const self = this
    const oblgId = input.obligationId as ObligationId
    if (!self.hardState.obligations.has(oblgId)) {
      return Effect.fail(new Error(`Obligation ${input.obligationId} is not an active open obligation`))
    }
    // Authority gate (ACCP): the model may only invalidate mechanically
    // malformed compiler artifacts. Substantive obligations must close via
    // their declared verifier; rejecting here keeps the attempt auditable and
    // prevents invalidation from becoming a verification bypass.
    const authority = AccpSemanticGate.checkInvalidationAuthority(self.hardState.obligationPredicates.get(oblgId))
    if (!authority.allowed) {
      return Effect.fail(
        new Error(
          `Invalidation authority denied for obligation ${input.obligationId}: ${authority.reason}. Do NOT mutate reality to satisfy a constraint you believe is malformed; report it to the user instead.`,
        ),
      )
    }
    return Effect.gen(function* () {
      yield* self.append(events, {
        type: "obligation_invalidated",
        obligationId: oblgId,
        reason: input.reason,
        timestamp: new Date().toISOString(),
      })
      return { obligationId: input.obligationId, invalidated: true, reason: input.reason }
    })
  }

  verifyLastExecution(
    events: EventV2.Interface,
    request: VerificationRequest,
  ): Effect.Effect<
    | { readonly type: "inquiry"; readonly receipt: InquiryReceipt }
    | { readonly type: "praxis"; readonly receipt: VerificationReceipt & { readonly evidenceId: EvidenceId } },
    Error
  > {
    const obligationId = this.hardState.obligations.has(request.obligationId)
      ? request.obligationId
      : this.hardState.openObligationIds()[0]
    if (!obligationId) return Effect.fail(new Error("Praxis verification has no applicable open obligation"))
    // Verifier routing: each obligation kind has its own closure proof object.
    // Epistemic inquiries are closed by the authoritative Noesis projection
    // that answered them; demanding an observed execution here would only
    // manufacture verification theater.
    if (this.hardState.obligationKind(obligationId) === "epistemic_inquiry") {
      return this.satisfyInquiry(events, {
        summary: `Epistemic inquiry satisfied by authoritative Noesis projection at revision ${this.hardState.revision.toJSON()}`,
        obligationId,
        atRevision: this.hardState.revision,
      }).pipe(
        Effect.flatMap((receipt) =>
          receipt === undefined
            ? Effect.fail(new Error("No open epistemic inquiry obligation to satisfy"))
            : Effect.succeed({ type: "inquiry" as const, receipt }),
        ),
      )
    }
    // Verifier routing is predicate-driven. A successful execution is not a
    // generic proof object that can be applied to an unrelated obligation.
    const obligationPredicate = this.hardState.obligationPredicates.get(obligationId)
    if (obligationPredicate?.type === "file_constraint") {
      return this.verifyFileConstraint(events, request, obligationId, obligationPredicate)
    }
    if (obligationPredicate?.type === "command_pass") {
      return this.verifyCommandPass(events, request, obligationId, obligationPredicate)
    }
    if (obligationPredicate?.type === "claims_verified") {
      const outcome = this.evaluateClaimsVerified(obligationId, obligationPredicate)
      return this.recordClaimsOutcome(events, request, obligationId, outcome)
    }
    return Effect.fail(new Error("Praxis requires a declared machine-checkable predicate"))
  }

  private verifyCommandPass(
    events: EventV2.Interface,
    request: VerificationRequest,
    obligationId: ObligationId,
    predicate: Extract<ObligationPredicate, { type: "command_pass" }>,
  ) {
    const execution = this.hardState.executionReceipts.findLast(
      (receipt) => receipt.scope.repository === request.targetScope.repository && receipt.target === predicate.command,
    )
    if (!execution?.observations) return Effect.fail(new Error("Praxis requires the declared command to be executed"))
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

    const observedExitCode = execution.exitCode ?? (execution.success ? 0 : 1)
    const passed = execution.success && observedExitCode === predicate.expectedExitCode
    const receipt: VerificationReceipt = {
      receiptId: createReceiptId(),
      obligationId,
      passed,
      evidenceId: execution.evidenceId,
      verifiedScope: execution.scope,
      predicate: describePredicate(predicate),
      executionReceiptId: execution.receiptId,
      reasonCodes: passed ? ["COMMAND_PASSED"] : ["COMMAND_FAILED"],
      diagnostics: passed
        ? null
        : `COMMAND_FAILED: '${predicate.command}' exited with ${observedExitCode}; expected ${predicate.expectedExitCode}`,
      timestamp: new Date().toISOString(),
    }
    return this.recordVerification(events, receipt).pipe(Effect.map(() => ({ type: "praxis" as const, receipt })))
  }

  /**
   * Closes a file_constraint obligation with a harness-side deterministic
   * filesystem observation. The check runs in the harness (not from model
   * output), so the evidence cannot be fabricated by the controller; the
   * receipt carries typed reason codes for rejection projection.
   */
  private verifyFileConstraint(
    events: EventV2.Interface,
    request: VerificationRequest,
    obligationId: ObligationId,
    predicate: Extract<ObligationPredicate, { type: "file_constraint" }>,
  ) {
    const outcome = evaluateFileConstraintOnDisk(request.targetScope.repository, predicate)
    const evidenceId = createEvidenceId()
    const receipt: VerificationReceipt = {
      receiptId: createReceiptId(),
      obligationId,
      passed: outcome.passed,
      evidenceId,
      verifiedScope: request.targetScope,
      predicate: describePredicate(predicate),
      reasonCodes: outcome.reasonCodes,
      diagnostics: outcome.diagnostics,
      timestamp: new Date().toISOString(),
    }
    const self = this
    return Effect.gen(function* () {
      yield* self.append(events, {
        type: "evidence_recorded",
        evidenceId,
        source: "praxis.file_constraint",
        summary: outcome.observation,
        timestamp: new Date().toISOString(),
      })
      yield* self.recordVerification(events, receipt)
      return { type: "praxis" as const, receipt: { ...receipt, evidenceId } }
    })
  }

  /**
   * Closes a claims_verified obligation through relevant admitted claims,
   * relevant execution evidence for a goal wrapper, or — when appropriate —
   * passing sibling obligations. The derivation is mechanical and audited.
   */
  private evaluateClaimsVerified(
    obligationId: ObligationId,
    predicate: Extract<ObligationPredicate, { type: "claims_verified" }>,
  ): { passed: boolean; reasonCodes: string[]; diagnostics: string | null; evidenceSummary: string } {
    const supported = new Set(
      [...this.hardState.claims.values()]
        .filter(
          (claim) =>
            claim.status === "supported" &&
            claim.supportingEvidence.some((evidenceId) =>
              claimEvidenceIsRelevant(this.hardState, claim.proposition, evidenceId),
            ),
        )
        .map((claim) => claim.proposition),
    )
    const missing = predicate.claimPropositions.filter((proposition) => !supported.has(proposition))
    const claimEvidenceMissing = predicate.claimPropositions.filter((proposition) =>
      [...this.hardState.claims.values()].some(
        (claim) =>
          claim.status === "supported" &&
          claim.proposition === proposition &&
          !claim.supportingEvidence.some((evidenceId) =>
            claimEvidenceIsRelevant(this.hardState, claim.proposition, evidenceId),
          ),
      ),
    )
    const siblingOpenObligations = this.hardState.openObligationIds().filter((id) => id !== obligationId)
    // Sibling closure only counts receipts minted at or after this obligation's
    // own goal revision, so receipts from an earlier goal can never satisfy a
    // later claims_verified wrapper.
    const goalRevision = this.hardState.obligationScopes.get(obligationId)?.revision
    const closedSiblingIds = [...this.hardState.closedObligations.keys()].filter((id) => id !== obligationId)
    const verifiedSiblings = closedSiblingIds.filter((id) => {
      if (!goalRevision) return false
      const receipt = this.hardState.verificationReceipts.get(id)
      if (receipt?.passed && receipt.verifiedScope.revision.value >= goalRevision.value) return true
      const inquiry = this.hardState.inquiryReceipts.get(id)
      return Boolean(inquiry && inquiry.satisfiedAtRevision.value >= goalRevision.value)
    })
    const fulfilledBySiblings =
      siblingOpenObligations.length === 0 && verifiedSiblings.length > 0 && goalRevision !== undefined
    const relevantExecution = this.hardState.executionReceipts.findLast(
      (execution) =>
        execution.success &&
        this.hardState.evidence.has(execution.evidenceId) &&
        meaningfulTokenOverlap(
          predicate.claimPropositions.join(" "),
          [
            this.hardState.evidence.get(execution.evidenceId),
            execution.target,
            execution.capability,
            execution.actionFingerprint,
          ]
            .filter(Boolean)
            .join(" "),
        ),
    )
    const fulfilledByExecution = siblingOpenObligations.length === 0 && relevantExecution !== undefined
    const passed = missing.length === 0 || fulfilledBySiblings || fulfilledByExecution
    const diagnostics = passed
      ? null
      : claimEvidenceMissing.length > 0
        ? `CLAIM_EVIDENCE_NOT_RELEVANT: supported claim evidence is not semantically linked to ${claimEvidenceMissing.map((p) => `"${p}"`).join(", ")}`
        : `CLAIM_NOT_ADMITTED: no supported claim matches ${missing.map((p) => `"${p}"`).join(", ")}. Admit via propose_claim with relevant admitted evidence, or close sibling obligations.`
    const evidenceSummary = passed
      ? fulfilledBySiblings
        ? `Goal wrapper closed by ${verifiedSiblings.length} verified sibling obligations at revision ${goalRevision?.toJSON()}`
        : fulfilledByExecution
          ? `Goal wrapper matched relevant execution ${relevantExecution.receiptId}`
          : "Supported claims match all predicate propositions"
      : `Missing supported claims: ${missing.join(" | ")}`
    return {
      passed,
      reasonCodes: passed
        ? ["CLAIMS_VERIFIED", ...(fulfilledByExecution ? ["RELEVANT_EXECUTION"] : [])]
        : ["CLAIM_NOT_ADMITTED", ...(claimEvidenceMissing.length > 0 ? ["CLAIM_EVIDENCE_NOT_RELEVANT"] : [])],
      diagnostics,
      evidenceSummary,
    }
  }

  private recordClaimsOutcome(
    events: EventV2.Interface,
    request: VerificationRequest,
    obligationId: ObligationId,
    outcome: { passed: boolean; reasonCodes: string[]; diagnostics: string | null; evidenceSummary: string },
  ) {
    const evidenceId = createEvidenceId()
    const receipt: VerificationReceipt = {
      receiptId: createReceiptId(),
      obligationId,
      passed: outcome.passed,
      evidenceId,
      verifiedScope: request.targetScope,
      predicate: describePredicate(this.hardState.obligationPredicates.get(obligationId)!),
      reasonCodes: outcome.reasonCodes,
      diagnostics: outcome.diagnostics,
      timestamp: new Date().toISOString(),
    }
    const self = this
    return Effect.gen(function* () {
      yield* self.append(events, {
        type: "evidence_recorded",
        evidenceId,
        source: "praxis.claims_verified",
        summary: outcome.evidenceSummary,
        timestamp: new Date().toISOString(),
      })
      yield* self.recordVerification(events, receipt)
      return { type: "praxis" as const, receipt: { ...receipt, evidenceId } }
    })
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

      if (!self.hardState.canPromoteToSupported(proposal.supportingEvidence))
        return yield* Effect.fail(new Error("Claim requires exact, relevant evidence admitted by the Harness"))

      const effectiveProposal = proposal

      // Write-Time Barrier: Adjudicate against existing state
      const adjudication = ValidityEngine.adjudicateWriteTime(
        self.hardState,
        effectiveProposal,
        options?.validityPolicy ?? "EPISTEMIC",
      )

      if (adjudication.action === "supersede" && adjudication.supersededClaimId) {
        yield* self.append(events, {
          type: "claim_superseded",
          claimId: adjudication.supersededClaimId,
          supersededBy: effectiveProposal.claimId,
          reason: `Superseded by updated claim ${effectiveProposal.claimId}: '${effectiveProposal.proposition}'`,
          timestamp: effectiveProposal.timestamp,
        })
      } else if (adjudication.action === "contradict" && adjudication.contradictionReason) {
        yield* self.append(events, {
          type: "claim_contradicted",
          claimId: effectiveProposal.claimId,
          contradictedBy: [...effectiveProposal.supportingEvidence],
          reason: adjudication.contradictionReason,
          scope: effectiveProposal.scope,
          timestamp: effectiveProposal.timestamp,
        })
      }

      yield* self.append(events, {
        type: "claim_asserted",
        claimId: effectiveProposal.claimId,
        proposition: effectiveProposal.proposition,
        status: effectiveProposal.proposedStatus,
        evidence: effectiveProposal.supportingEvidence,
        dependencies: options?.dependencies ? [...options.dependencies] : undefined,
        scope: effectiveProposal.scope,
        validFromRevision: options?.validFromRevision ?? self.hardState.revision,
        validityPolicy: options?.validityPolicy ?? "EPISTEMIC",
        provenance: options?.provenance,
        timestamp: effectiveProposal.timestamp,
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
      this.hardState.closureReceiptIds(),
      {
        getKind: (id) => this.hardState.obligationKind(id),
        getDescription: (id) => this.hardState.obligations.get(id) ?? id,
      },
      true,
      this.hardState.activeTaskId,
    )
  }

  proposeCompletion(
    events: EventV2.Interface,
    input: {
      readonly summary: string
      readonly claimsAddressed?: readonly ClaimId[]
      readonly taskId?: TaskId
      readonly baseRevision?: Revision
      readonly responseDelivered?: boolean
    },
  ) {
    const proposal: CompletionProposal = {
      taskId: input.taskId ?? this.hardState.activeTaskId ?? createTaskId(),
      summary: input.summary,
      claimsAddressed: [...(input.claimsAddressed ?? [])],
      baseRevision: input.baseRevision ?? this.hardState.revision,
      timestamp: new Date().toISOString(),
    }
    const decision = AccpSemanticGate.evaluateCompletion(
      proposal,
      this.hardState.revision,
      this.hardState.openObligationIds(),
      this.hardState.closureReceiptIds(),
      {
        getKind: (id) => this.hardState.obligationKind(id),
        getDescription: (id) => this.hardState.obligations.get(id) ?? id,
      },
      input.responseDelivered ?? true,
      this.hardState.activeTaskId,
    )
    const readiness = AccpSemanticGate.checkCompletionReadiness({
      unclosedObligations: this.hardState.openObligationIds(),
      passingReceipts: this.hardState.closureReceiptIds(),
      hasContradictions: this.hardState.contradictions.size > 0,
      getKind: (id) => this.hardState.obligationKind(id),
      getDescription: (id) => this.hardState.obligations.get(id) ?? id,
      totalObligations: this.hardState.obligations.size + this.hardState.closedObligations.size,
      hasActiveGoal: Boolean(this.hardState.goalDescription),
    })
    // Internal closure is deliberately not recorded as accepted until a
    // user-facing response has been emitted. The runner uses this deferred
    // decision to request a text-only response.
    if (decision.internalClosureReady && !decision.responseDelivered) {
      return Effect.succeed(decision)
    }

    if (!decision.completed) {
      return this.append(events, {
        type: "completion_rejected",
        taskId: proposal.taskId,
        blockers: decision.blockers,
        avoidable: readiness.status === "BLOCKED",
        timestamp: decision.timestamp,
      }).pipe(Effect.as(decision))
    }

    if (!decision.finalReceipt) return Effect.succeed(decision)
    return this.append(events, {
      type: "completion_accepted",
      taskId: decision.taskId,
      finalReceipt: decision.finalReceipt,
      timestamp: decision.timestamp,
    }).pipe(Effect.as(decision))
  }

  ensureGoal(
    events: EventV2.Interface,
    goal: string,
    repository: string,
    kind?: ObligationKind,
    taskAuthority: TaskAuthority = "normal_project_task",
  ) {
    if (this.hardState.goalDescription === goal && this.hardState.activeTaskAuthority === taskAuthority)
      return Effect.void
    const compiled = GoalCompiler.compile(goal, repository, this.hardState.revision, kind)
    const self = this
    return Effect.gen(function* () {
      const previousTaskId = self.hardState.activeTaskId
      if (previousTaskId && previousTaskId !== compiled.goalId) {
        yield* self.append(events, {
          type: "task_archived",
          taskId: previousTaskId,
          reason: `Superseded by user-authorized goal ${compiled.goalId}`,
          timestamp: new Date().toISOString(),
        })
      }
      yield* self.append(events, {
        type: "goal_set",
        goal,
        goalId: compiled.goalId,
        taskAuthority,
        timestamp: new Date().toISOString(),
      })
      self.hardState.activeTaskId = compiled.goalId
      yield* self.appendAll(
        events,
        [...compiled.graph.nodes.values()].map((obligation) => ({
          type: "obligation_created" as const,
          obligationId: obligation.id,
          taskId: obligation.taskId,
          description: obligation.description,
          scope: obligation.targetScope,
          kind: obligation.kind,
          predicate: obligation.predicate,
          dependencies: obligation.dependencies,
          timestamp: new Date().toISOString(),
        })),
      )
      const first = compiled.graph.openObligations()[0]
      if (first) {
        yield* self.append(events, {
          type: "focus_set",
          focus: TaskControlController.obligationFocus({
            taskId: compiled.goalId,
            obligationId: first.id,
            objective: first.description,
            predicate: first.predicate,
            repository: first.targetScope.repository,
            pathPattern: first.targetScope.pathPattern,
            reason: "Initial focus selected when the user goal was admitted",
          }),
          timestamp: new Date().toISOString(),
        })
      }
    })
  }

  advanceFocus(events: EventV2.Interface, obligationId: ObligationId, receipt: VerificationReceipt) {
    const current = this.hardState.executionFocus
    if (!current?.targetObligationId) return Effect.fail(new Error("No authoritative obligation focus to advance"))
    if (this.hardState.verificationReceipts.get(receipt.obligationId)?.receiptId !== receipt.receiptId) {
      return Effect.fail(new Error("Focus transition requires a recorded Praxis receipt"))
    }
    try {
      TaskControlController.requirePassingVerification(receipt, current.targetObligationId)
    } catch (error) {
      return Effect.fail(error instanceof Error ? error : new Error(String(error)))
    }
    if (!this.hardState.readyObligationIds().includes(obligationId)) {
      return Effect.fail(new Error(`Obligation ${obligationId} is not on the active task ready frontier`))
    }
    const scope = this.hardState.obligationScopes.get(obligationId)
    if (!scope || !this.hardState.activeTaskId) return Effect.fail(new Error("Next focus is missing task scope"))
    const focus = TaskControlController.obligationFocus({
      taskId: this.hardState.activeTaskId,
      obligationId,
      objective: this.hardState.obligationDescriptions.get(obligationId) ?? obligationId,
      predicate: this.hardState.obligationPredicates.get(obligationId),
      repository: scope.repository,
      pathPattern: scope.pathPattern,
    })
    return this.appendAll(events, [
      {
        type: "focus_archived",
        focusId: current.id,
        reason: `Acceptance verified by ${receipt.receiptId}`,
        timestamp: new Date().toISOString(),
      },
      {
        type: "focus_folded",
        fold: {
          focusId: current.id,
          taskId: current.taskId,
          kind: current.kind,
          summary: `RESOLVED FOCUS ${current.id}: ${current.objective}. Acceptance verified.`,
          evidenceRefs: [receipt.evidenceId, receipt.receiptId],
          startedAt: current.createdAt,
          completedAt: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      },
      { type: "focus_set", focus, timestamp: new Date().toISOString() },
    ])
  }

  pushRecovery(
    events: EventV2.Interface,
    input: {
      readonly failureClass: FailureClass
      readonly objective: string
      readonly acceptanceCriteria: readonly string[]
      readonly budget?: number
    },
  ) {
    const parent = this.hardState.executionFocus
    if (!parent || !this.hardState.activeTaskId || !parent.targetObligationId) {
      return Effect.fail(new Error("Recovery requires an active authoritative obligation focus"))
    }
    const recovery = TaskControlController.recoveryFocus({
      taskId: this.hardState.activeTaskId,
      parentFocusId: parent.id,
      resumeTarget: parent.targetObligationId,
      failureClass: input.failureClass,
      objective: input.objective,
      acceptanceCriteria: input.acceptanceCriteria,
      allowedScope: parent.contract.allowedScope,
      budget: input.budget,
    })
    return this.append(events, {
      type: "recovery_opened",
      frame: recovery.frame,
      focus: recovery.focus,
      timestamp: new Date().toISOString(),
    }).pipe(Effect.as(recovery.frame))
  }

  recordRecoveryVerification(events: EventV2.Interface, receipt: RecoveryVerificationReceipt) {
    const frame = this.hardState.recoveryFrames.get(receipt.recoveryId)
    if (!frame || frame.status !== "open") {
      return Effect.fail(new Error(`Recovery ${receipt.recoveryId} is not open`))
    }
    if (!receipt.evidenceRefs.every((evidenceId) => this.hardState.evidence.has(evidenceId))) {
      return Effect.fail(new Error("Recovery verification references unadmitted evidence"))
    }
    return this.append(events, {
      type: "recovery_verification_recorded",
      receipt,
      timestamp: new Date().toISOString(),
    })
  }

  popRecovery(events: EventV2.Interface, recoveryId: RecoveryId, receipt: RecoveryVerificationReceipt) {
    const frame = this.hardState.recoveryFrames.get(recoveryId)
    if (!frame || frame.status !== "open") return Effect.fail(new Error(`Recovery ${recoveryId} is not open`))
    if (this.hardState.recoveryVerificationReceipts.get(recoveryId)?.receiptId !== receipt.receiptId) {
      return Effect.fail(new Error("Recovery transition requires a recorded Praxis receipt"))
    }
    try {
      TaskControlController.requirePassingRecoveryVerification(receipt, recoveryId)
    } catch (error) {
      return Effect.fail(error instanceof Error ? error : new Error(String(error)))
    }
    const parent = this.hardState.focuses.get(frame.parentFocusId)
    if (!parent) return Effect.fail(new Error(`Recovery ${recoveryId} has no resumable parent focus`))
    const recoveryFocus = this.hardState.executionFocus
    return this.appendAll(events, [
      {
        type: "recovery_verified",
        recoveryId,
        receiptId: receipt.receiptId,
        timestamp: new Date().toISOString(),
      },
      {
        type: "recovery_closed",
        recoveryId,
        resumeFocus: parent,
        timestamp: new Date().toISOString(),
      },
      ...(recoveryFocus
        ? [
            {
              type: "focus_folded" as const,
              fold: {
                focusId: recoveryFocus.id,
                taskId: recoveryFocus.taskId,
                kind: recoveryFocus.kind,
                summary: `RESOLVED RECOVERY ${recoveryId}: ${frame.objective}. Cause: ${frame.failureClass}. No remaining recovery blocker.`,
                evidenceRefs: [...receipt.evidenceRefs, receipt.receiptId],
                startedAt: recoveryFocus.createdAt,
                completedAt: new Date().toISOString(),
              },
              timestamp: new Date().toISOString(),
            },
          ]
        : []),
    ])
  }

  settleFocusAfterVerification(events: EventV2.Interface, receipt: VerificationReceipt) {
    if (!receipt.passed) return Effect.fail(new Error("Cannot settle focus from a failing verification receipt"))
    const self = this
    return Effect.gen(function* () {
      const recoveryId = self.hardState.recoveryStack.at(-1)
      if (recoveryId) {
        const recoveryReceipt: RecoveryVerificationReceipt = {
          receiptId: createReceiptId(),
          recoveryId,
          passed: true,
          evidenceRefs: [receipt.evidenceId],
          verifier: "PRAXIS",
          timestamp: new Date().toISOString(),
        }
        yield* self.recordRecoveryVerification(events, recoveryReceipt)
        yield* self.popRecovery(events, recoveryId, recoveryReceipt)
      }
      const current = self.hardState.executionFocus
      const next = self.hardState.readyObligationIds().find((id) => id !== current?.targetObligationId)
      if (next && current?.targetObligationId === receipt.obligationId) {
        yield* self.advanceFocus(events, next, receipt)
        return
      }
      if (
        current?.targetObligationId === receipt.obligationId &&
        !self.hardState.obligations.has(receipt.obligationId)
      ) {
        yield* self.append(events, {
          type: "focus_folded",
          fold: {
            focusId: current.id,
            taskId: current.taskId,
            kind: current.kind,
            summary: `RESOLVED FOCUS ${current.id}: ${current.objective}. Awaiting verified task completion.`,
            evidenceRefs: [receipt.evidenceId, receipt.receiptId],
            startedAt: current.createdAt,
            completedAt: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        })
      }
    })
  }

  strategyRedirect(events: EventV2.Interface, reason: string) {
    const focus = this.hardState.executionFocus
    if (!focus) return Effect.fail(new Error("Strategy redirect requires an active focus"))
    return this.append(events, {
      type: "strategy_redirected",
      focusId: focus.id,
      reason,
      timestamp: new Date().toISOString(),
    })
  }

  completeObligation(events: EventV2.Interface, receipt: VerificationReceipt) {
    return this.recordVerification(events, receipt)
  }

  archiveTask(events: EventV2.Interface, taskId: TaskId, receipt: VerificationReceipt) {
    const focus = this.hardState.executionFocus
    if (!focus?.targetObligationId || focus.taskId !== taskId) {
      return Effect.fail(new Error(`Task ${taskId} is not the active focus owner`))
    }
    if (this.hardState.verificationReceipts.get(receipt.obligationId)?.receiptId !== receipt.receiptId) {
      return Effect.fail(new Error("Task archive requires a recorded Praxis receipt"))
    }
    try {
      TaskControlController.requirePassingVerification(receipt, focus.targetObligationId)
    } catch (error) {
      return Effect.fail(error instanceof Error ? error : new Error(String(error)))
    }
    return this.append(events, {
      type: "task_archived",
      taskId,
      reason: `Verifier-backed archive ${receipt.receiptId}`,
      timestamp: new Date().toISOString(),
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

      return CognitiveViewCompiler.toCognitiveView(compiled)
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
          census.workspaces
            .slice(0, 8)
            .map((w) => w.name)
            .join(", ") + (census.workspaces.length > 8 ? ` and ${census.workspaces.length - 8} more` : "")
        yield* self.append(events, {
          type: "claim_asserted",
          claimId: createClaimId("claim_census_workspaces"),
          proposition: `Repository monorepo workspace structure comprises ${census.workspaces.length} packages: ${wsNames}`,
          status: "supported",
          evidence: [evidenceId],
          scope: self.scope(directory),
          validityPolicy: "CURRENT_STATE",
          dependencies: census.workspaces
            .slice(0, 20)
            .map((w) => ({ type: "manifest" as const, name: w.manifestPath })),
          validFromRevision: self.hardState.revision,
          timestamp: new Date().toISOString(),
        })
      }

      // 5. Build and Test Toolchains Claim
      // buildSystems and testFrameworks overlap (e.g. pytest), dedupe to keep
      // the canonical claim payload normalized.
      const toolchains = Array.from(new Set([...census.buildSystems, ...census.testFrameworks]))
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

  /**
   * Deep Repository Induction (hard scan):
   * Deterministically reads a bounded set of key files per package, extracts
   * package facts (entrypoints, imports, exports) and asserts architecture
   * claims into Hard State. The result persists in the project's
   * .rivet/induction.json marker so later sessions replay claims instead of
   * rescanning. Progress streams as non-durable rivet.induction.* events so
   * the TUI can show live scan status. Never blocks the calling drain when
   * forked by the runner.
   */
  ensureDeepInduction(
    events: EventV2.Interface,
    directory: string,
    options?: { force?: boolean; budgetMs?: number },
  ): Effect.Effect<void> {
    const self = this
    return Effect.flatMap(
      Effect.sync(() => Induction.claimInFlight(directory)),
      (acquired) => {
        if (!acquired) return Effect.void
        return self
          .runDeepInduction(events, directory, options)
          .pipe(Effect.ensuring(Effect.sync(() => Induction.releaseInFlight(directory))))
      },
    )
  }

  private runDeepInduction(
    events: EventV2.Interface,
    directory: string,
    options?: { force?: boolean; budgetMs?: number },
  ): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!options?.force) {
        const hasInductionClaims = Array.from(self.hardState.claims.keys()).some((claimId) =>
          claimId.startsWith("claim_induction_"),
        )
        if (hasInductionClaims) return
      }

      const marker = readInductionMarker(directory)
      const cached = options?.force ? undefined : marker
      if (cached?.result && (cached.status === "complete" || cached.status === "partial")) {
        yield* self.appendAll(
          events,
          inductionClaimEvents(cached.result, self.scope(directory), self.hardState.revision),
        )
        yield* publishInductionCompleted(
          events,
          directory,
          cached.result,
          "Replayed cached deep induction (.rivet/induction.json)",
        )
        return
      }

      const runningElsewhere = options?.force ? undefined : marker
      if (runningElsewhere?.status === "running" && !isMarkerStale(runningElsewhere)) return

      const files = yield* Effect.sync(() => discoverWorkspaceFiles(directory))
      if (files.length === 0) return

      const startedAt = new Date().toISOString()
      const head = gitHead(directory)
      writeInductionMarker(directory, { status: "running", startedAt, gitHead: head, fileCount: files.length })

      const census = RepositoryCensusProjector.projectFromFiles(files, self.hardState.revision)
      const result = yield* RepositoryInduction.run({
        directory,
        files,
        census,
        budgetMs: options?.budgetMs,
        onProgress: (progress) =>
          events.publish(RivetInductionEvent.Progress, { directory, ...progress }).pipe(Effect.ignore),
      })

      const summary = `Deep induction read ${result.filesRead} files across ${result.packages.length} packages (${result.dependencyEdges.length} import edges${result.partial ? ", partial: budget reached" : ""}).`
      yield* self.append(events, {
        type: "evidence_recorded",
        evidenceId: createEvidenceId("ev_induction_deep_scan"),
        source: "repository_induction",
        summary,
        timestamp: new Date().toISOString(),
      })
      yield* self.append(events, {
        type: "observation_recorded",
        observation: {
          observationId: "obs_induction_deep_scan",
          actionId: "action_induction_deep_scan" as ActionId,
          scope: self.scope(directory),
          summary: `T0+ Deep Repository Induction ${result.partial ? "completed partially" : "completed"}: ${result.packages.length} packages, ${result.dependencyEdges.length} dependency edges, ${result.claims.length} claims.`,
          timestamp: new Date().toISOString(),
        },
      })
      yield* self.appendAll(events, inductionClaimEvents(result, self.scope(directory), self.hardState.revision))

      writeInductionMarker(directory, {
        status: result.partial ? "partial" : "complete",
        startedAt,
        completedAt: new Date().toISOString(),
        gitHead: head,
        fileCount: files.length,
        result,
      })
      yield* publishInductionCompleted(events, directory, result, summary)
    })
  }
}

function gitHead(directory: string): string | undefined {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: directory, stdout: "pipe", stderr: "pipe" })
    if (proc.exitCode !== 0) return undefined
    return proc.stdout.toString().trim() || undefined
  } catch {
    return undefined
  }
}

function inductionClaimEvents(result: InductionResult, scope: Scope, revision: Revision): NoesisEvent[] {
  const evidenceId = createEvidenceId("ev_induction_deep_scan")
  return result.claims.map((claim) => ({
    type: "claim_asserted",
    claimId: createClaimId(claim.claimId),
    proposition: claim.proposition,
    status: "supported",
    evidence: [evidenceId],
    scope,
    validityPolicy: claim.validityPolicy,
    dependencies: [...claim.dependencies],
    validFromRevision: revision,
    timestamp: new Date().toISOString(),
  }))
}

function publishInductionCompleted(
  events: EventV2.Interface,
  directory: string,
  result: InductionResult,
  summary: string,
): Effect.Effect<void> {
  return events
    .publish(RivetInductionEvent.Completed, {
      directory,
      status: result.partial ? "partial" : "complete",
      claimCount: result.claims.length,
      filesRead: result.filesRead,
      packageCount: result.packages.length,
      durationMs: result.durationMs,
      summary,
    })
    .pipe(Effect.ignore)
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
    event.validFromRevision = Revision.from(
      typeof event.validFromRevision === "string" || typeof event.validFromRevision === "number"
        ? event.validFromRevision
        : 0,
    )
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
    revision: Revision.from(
      typeof value.revision === "string" || typeof value.revision === "number" ? value.revision : 0,
    ),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function claimEvidenceIsRelevant(state: HardState, proposition: string, evidenceId: EvidenceId): boolean {
  const summary = state.evidence.get(evidenceId)
  if (!summary) return false
  const source = state.evidenceSources.get(evidenceId)
  const executionReceiptId = state.evidenceExecutionReceipts.get(evidenceId)
  const execution = executionReceiptId
    ? state.executionReceipts.find((receipt) => receipt.receiptId === executionReceiptId)
    : undefined
  if (execution && !execution.success) return false
  const evidenceText = [summary, execution?.target, execution?.capability, execution?.actionFingerprint]
    .filter(Boolean)
    .join(" ")
  const paths = proposition
    .split(/\s+/)
    .map((token) => token.replace(/^[^\w~./-]+|[^\w~./-]+$/g, ""))
    .filter((token) => token.length > 0 && isPathClaimToken(token))
  if (paths.length > 0 && (!source?.startsWith("file.") || !paths.every((token) => evidenceText.includes(token))))
    return false
  return meaningfulTokenOverlap(proposition, evidenceText)
}

function isPathClaimToken(token: string): boolean {
  return token.startsWith("~/") || token.includes("/") || /\.[A-Za-z0-9]{2,}$/.test(token)
}

function meaningfulTokenOverlap(left: string, right: string): boolean {
  const ignored = new Set([
    "a",
    "an",
    "and",
    "are",
    "at",
    "be",
    "by",
    "for",
    "from",
    "goal",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "the",
    "to",
    "was",
    "were",
    "with",
    "this",
    "that",
    "ve",
    "bir",
    "bu",
    "de",
    "da",
    "ile",
    "için",
  ])
  const tokens = (value: string) =>
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}_~./-]+/u)
      .filter((token) => token.length > 2 && !ignored.has(token))
  const rightTokens = new Set(tokens(right))
  return tokens(left).some((token) => rightTokens.has(token))
}

/**
 * Deterministic filesystem evaluation for file_constraint predicates.
 * Runs harness-side: the model cannot fabricate this observation.
 */
function evaluateFileConstraintOnDisk(
  repositoryRoot: string,
  predicate: Extract<ObligationPredicate, { type: "file_constraint" }>,
): { passed: boolean; reasonCodes: string[]; diagnostics: string | null; observation: string } {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ""
  const isHomePath = predicate.path.startsWith("~/") || predicate.path === "~"
  const expandedPath = isHomePath
    ? homeDir
      ? path.join(homeDir, predicate.path.slice(predicate.path === "~" ? 1 : 2))
      : predicate.path
    : predicate.path

  const root = path.resolve(repositoryRoot)
  const isAbsolute = path.isAbsolute(expandedPath)
  const target = isAbsolute ? path.resolve(expandedPath) : path.resolve(root, expandedPath)

  const inRepo = target === root || target.startsWith(root + path.sep)
  const inHome = homeDir ? target === homeDir || target.startsWith(homeDir + path.sep) : false
  const isConfigLookup =
    isHomePath || predicate.path.includes(".config") || predicate.path.includes(".rivet") || isAbsolute
  if (!inRepo && !(inHome && isConfigLookup)) {
    return {
      passed: false,
      reasonCodes: ["PATH_ESCAPES_REPOSITORY"],
      diagnostics: `PATH_ESCAPES_REPOSITORY: "${predicate.path}" resolves outside the obligation scope (${repositoryRoot}). If the constraint is malformed, invalidate it via invalidate_obligation.`,
      observation: `filesystem scope check failed for "${predicate.path}"`,
    }
  }

  const exists = fs.existsSync(target)

  if (predicate.mustExist && !exists) {
    return {
      passed: false,
      reasonCodes: ["FILE_NOT_FOUND"],
      diagnostics: `FILE_NOT_FOUND: "${predicate.path}" does not exist in ${repositoryRoot}. Create the target, or invalidate the obligation via invalidate_obligation if it is malformed.`,
      observation: `filesystem observation: "${predicate.path}" missing`,
    }
  }
  if (!predicate.mustExist && exists) {
    return {
      passed: false,
      reasonCodes: ["FILE_EXISTS"],
      diagnostics: `FILE_EXISTS: "${predicate.path}" must not exist`,
      observation: `filesystem observation: "${predicate.path}" present`,
    }
  }
  if (predicate.contentPattern) {
    if (!exists) {
      return {
        passed: false,
        reasonCodes: ["FILE_NOT_FOUND"],
        diagnostics: `FILE_NOT_FOUND: "${predicate.path}" does not exist (required for content check)`,
        observation: `filesystem observation: "${predicate.path}" missing`,
      }
    }
    const content = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : ""
    if (!content.includes(predicate.contentPattern)) {
      return {
        passed: false,
        reasonCodes: ["CONTENT_MISMATCH"],
        diagnostics: `CONTENT_MISMATCH: "${predicate.contentPattern}" not found in "${predicate.path}"`,
        observation: `filesystem observation: content of "${predicate.path}" inspected`,
      }
    }
  }
  return {
    passed: true,
    reasonCodes: ["FILE_CONSTRAINT_SATISFIED"],
    diagnostics: null,
    observation: `filesystem observation: "${predicate.path}" ${exists ? "exists" : "absent as required"}`,
  }
}

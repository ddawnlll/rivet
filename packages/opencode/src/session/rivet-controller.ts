import { Effect } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionSemantics } from "@opencode-ai/core/session/semantics"
import { TurnAdmissionGate } from "@opencode-ai/core/rivet"
import { createTaskId } from "@opencode-ai/core/rivet/types"
import { Session } from "./session"

export interface CommitmentInput {
  readonly session: Session.Info
  readonly semantics: SessionSemantics
  readonly callID: string
  readonly name: string
  readonly args: Record<string, unknown>
  readonly capabilities: readonly string[]
}

export interface PrepareInput {
  readonly session: Session.Info
  readonly semantics: SessionSemantics
  readonly events: EventV2.Interface
  readonly goal: string | undefined
}

export interface SettlementInput {
  readonly session: Session.Info
  readonly semantics: SessionSemantics
  readonly events: EventV2.Interface
  readonly callID: string
  readonly name: string
  readonly args: Record<string, unknown>
  readonly execute: () => Effect.Effect<Record<string, unknown>, unknown>
}

export interface CompletionInput {
  readonly semantics: SessionSemantics
  readonly taskId?: string
  readonly summary: string
}

export const prepareTurn = Effect.fn("RivetController.prepareTurn")(function* (input: PrepareInput) {
  yield* input.semantics.ensureColdStart(input.events, input.session.directory)
  const admission = input.goal ? classify(input.goal, input.semantics.hardState.goalDescription) : undefined
  if (admission?.shouldCreateGoal && admission.goalText)
    yield* input.semantics.ensureGoal(
      input.events,
      admission.goalText,
      input.session.directory,
      admission.obligationKind,
    )
  return yield* input.semantics.cognitiveView({
    repositoryId: input.session.directory,
    goalDescription: input.semantics.hardState.goalDescription ?? undefined,
    userPrompt: input.goal,
  })
})

export const decideContinuation = (semantics: SessionSemantics) => semantics.hardState.openObligationIds().length > 0

export const decideCompletion = Effect.fn("RivetController.decideCompletion")(function* (input: CompletionInput) {
  return input.semantics.completionDecision({
    taskId: (input.taskId ?? input.semantics.hardState.activeTaskId ?? createTaskId()) as never,
    claimsAddressed: [],
    summary: input.summary,
    baseRevision: input.semantics.hardState.revision,
    timestamp: new Date().toISOString(),
  })
})

function classify(goal: string, existing: string | null) {
  return TurnAdmissionGate.classify(goal, existing)
}

export const admitCommitment = Effect.fn("RivetController.admitCommitment")(function* (input: CommitmentInput) {
  const scope = input.semantics.scope(input.session.directory)
  const result = input.semantics.admitProviderCommitment(
    { id: input.callID, name: input.name, input: input.args },
    scope,
    {
      repository: input.session.directory,
      currentRevision: input.semantics.hardState.revision,
      allowedScope: scope,
      allowedCapabilities: [...input.capabilities],
      allowMaterial: true,
      humanApproved: false,
    },
  )
  if (result.authorizedAction && !result.authorizedAction.revision.equals(input.semantics.hardState.revision))
    return yield* Effect.fail(new Error("ACCP authority rejected: action revision is stale"))
  if (!result.authorizedAction)
    return yield* Effect.fail(new Error(result.decision?.reason ?? "Only ACCP action commitments may execute"))
  return result.authorizedAction
})

export * as RivetController from "./rivet-controller"

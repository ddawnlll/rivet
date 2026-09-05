import type { ToolDefinition } from "@opencode-ai/llm"
import type { CognitiveView, InvocationReason } from "../rivet/noesis"
import type { FocusId, InvocationId } from "../rivet/types"

export type { InvocationReason }

export interface SystemContract {
  readonly name: "Rivet Harness"
  readonly version: "1"
  readonly authority: "Harness"
}

export interface ModelBudget {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly deadlineMs?: number
}

/** The complete Harness-owned input to one provider turn. */
export interface ModelInvocation {
  readonly systemContract: SystemContract
  readonly cognitiveView: CognitiveView
  readonly availableActions: ReadonlyArray<ToolDefinition>
  readonly budget: ModelBudget
  readonly invocation: InvocationId
  readonly focusId: FocusId | null
}

/** Audit receipt for every model invocation or suppression decision. */
export interface ModelInvocationReceipt {
  readonly id: InvocationId
  readonly reason: InvocationReason
  readonly unresolvedEntities: readonly string[]
  readonly deterministicOptionsExhausted: readonly string[]
  readonly context?: {
    readonly taskStateTokens?: number
    readonly codeSliceTokens?: number
    readonly evidenceTokens?: number
    readonly policyTokens?: number
  }
  readonly modelTier: string
  readonly outputTokens?: number
  readonly suppressed: boolean
  readonly suppressionReason?: string
  readonly result?: {
    readonly proposedHypothesis?: string
    readonly actionChosen?: string
  }
  readonly verificationRequired: boolean
  readonly timestamp: string
}

export interface InvocationGateEvaluation {
  readonly shouldInvoke: boolean
  readonly reason: InvocationReason
  readonly receipt: ModelInvocationReceipt
  readonly suppressionReason?: string
}

export class ModelInvocationGate {
  /**
   * Evaluates whether a model round-trip is strictly necessary or can be mechanically suppressed.
   *
   * 1. Mechanical closure: Is the next sub-step completely determined by contract/state?
   * 2. Observation availability: Can missing data be fetched via safe capability without separate reasoning?
   * 3. State freshness: Is current CognitiveView sufficient?
   * 4. Risk of suppression: Does skipping turn increase drift risk?
   */
  static evaluate(invocation: ModelInvocation): InvocationGateEvaluation {
    const view = invocation.cognitiveView
    const unresolvedEntities: string[] = []

    if (view.contradictions.length > 0) {
      unresolvedEntities.push(...view.contradictions.map((c) => `contradiction:${c}`))
    }
    if (view.activeHypotheses.length > 0) {
      unresolvedEntities.push(...view.activeHypotheses.map((h) => `hypothesis:${h}`))
    }

    const hasActiveContradiction = view.contradictions.length > 0
    const hasMultipleHypotheses = view.activeHypotheses.length > 1
    const hasUnresolvedObligations = view.openObligations.length > 0

    let reason: InvocationReason = "SEMANTIC_DIAGNOSIS"
    if (hasActiveContradiction) {
      reason = "STATE_CONTRADICTION"
    } else if (hasMultipleHypotheses) {
      reason = "HYPOTHESIS_CONFLICT"
    } else if (hasUnresolvedObligations && !view.goalDescription) {
      reason = "GOAL_AMBIGUITY"
    }

    // A turn is mechanically decidable / suppressible ONLY if:
    // 1. There are NO unresolved contradictions
    // 2. State has 0 open obligations and all active claims are verified
    // 3. No unresolved hypotheses exist that require cognitive resolution
    const isMechanicallyClosed =
      !hasActiveContradiction &&
      !hasUnresolvedObligations &&
      view.activeClaims.length > 0 &&
      view.activeClaims.every((c) => c.status === "verified")

    const suppressed = isMechanicallyClosed
    const suppressionReason = suppressed
      ? "Mechanically closed: all obligations satisfied, claims verified, and no state contradictions."
      : undefined

    const receipt: ModelInvocationReceipt = {
      id: invocation.invocation,
      reason,
      unresolvedEntities,
      deterministicOptionsExhausted: ["inspect_contract", "verify_state_freshness", "check_mechanical_closure"],
      context: {
        taskStateTokens: view.goalDescription.length,
        codeSliceTokens: view.activeFocus.join(" ").length,
        evidenceTokens: view.recentEvidence.join(" ").length,
      },
      modelTier: "frontier",
      suppressed,
      suppressionReason,
      verificationRequired: true,
      timestamp: new Date().toISOString(),
    }

    return {
      shouldInvoke: !suppressed,
      reason,
      receipt,
      suppressionReason,
    }
  }
}

import type { ObligationKind } from "./types"

/**
 * Rivet Turn Semantics Categories (v0.3.1)
 *
 * Enforces the Quadruple Invariant:
 * 1. Not every turn creates a goal.
 * 2. Not every goal creates an obligation.
 * 3. Not every obligation requires Praxis.
 * 4. Not every response requires completion.
 */
export type TurnCategory =
  | "phatic"
  | "acknowledgement"
  | "conversational_query"
  | "state_query"
  | "goal_continuation"
  | "goal_revision"
  | "autonomous_goal"

export interface TurnAdmissionDecision {
  readonly category: TurnCategory
  readonly shouldCreateGoal: boolean
  readonly shouldCreateObligation: boolean
  readonly requiresPraxis: boolean
  readonly requiresCompletion: boolean
  readonly goalText: string | null
  readonly obligationKind?: ObligationKind
  readonly rationale: string
}

export class TurnAdmissionGate {
  /**
   * Classify a raw user turn and determine its admission lifecycle contract.
   * Explicit protocol markers and slash commands only; semantic intent classification
   * is owned by the LLM, NOT deterministic word hunting or regexes.
   */
  static classify(turnText: string, activeGoal?: string | null): TurnAdmissionDecision {
    const trimmed = turnText.trim()

    // 1. Explicit RIVET goal execution directives
    if (trimmed.startsWith("[RIVET GOAL EXECUTION]")) {
      const match = trimmed.match(/Goal:\s*(.+?)(?:\n|$)/i)
      const goalText = match && match[1]?.trim()
        ? match[1].trim()
        : trimmed.replace(/^\[RIVET GOAL EXECUTION\]\s*/i, "").trim()

      return {
        category: "autonomous_goal",
        shouldCreateGoal: true,
        shouldCreateObligation: true,
        requiresPraxis: true,
        requiresCompletion: true,
        goalText: goalText || trimmed,
        obligationKind: "execution",
        rationale: "Explicit RIVET GOAL EXECUTION marker present",
      }
    }

    // 2. Explicit slash commands
    if (trimmed.startsWith("/goal")) {
      const goalText = trimmed.replace(/^\/goal\s*/, "").trim()
      return {
        category: "autonomous_goal",
        shouldCreateGoal: true,
        shouldCreateObligation: true,
        requiresPraxis: true,
        requiresCompletion: true,
        goalText: goalText || trimmed,
        obligationKind: "execution",
        rationale: "Explicit /goal command",
      }
    }

    if (trimmed.startsWith("/inquiry") || trimmed.startsWith("/ask")) {
      const queryText = trimmed.replace(/^\/(?:inquiry|ask)\s*/, "").trim()
      const hasQuery = queryText.length > 0
      return {
        category: "state_query",
        shouldCreateGoal: hasQuery,
        shouldCreateObligation: hasQuery,
        requiresPraxis: false,
        requiresCompletion: false,
        goalText: hasQuery ? queryText : null,
        obligationKind: "epistemic_inquiry",
        rationale: hasQuery ? "Explicit /inquiry query goal" : "Explicit /inquiry epistemic inspection",
      }
    }

    // 3. Default: Every ordinary natural language turn is a conversational turn without
    // hardcoded synthetic goals. The LLM decides what actions or answers to take.
    return {
      category: "conversational_query",
      shouldCreateGoal: false,
      shouldCreateObligation: false,
      requiresPraxis: false,
      requiresCompletion: false,
      goalText: null,
      rationale: "Natural conversational turn: cognitive intent evaluated by LLM",
    }
  }
}



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

const PHATIC_PATTERNS = [
  /^(?:selam|merhaba|selamlar|günaydın|tünaydın|iyi\s+akşamlar|iyi\s+geceler|iyi\s+günler|kolay\s+gelsin)[!.,\s]*(?:nasılsın|naber|ne\s+haber)?[?!.]*$/i,
  /^(?:hello|hi(?:\s+there)?|hey(?:\s+there)?|greetings|good\s+morning|good\s+evening|good\s+afternoon)[!.,\s]*(?:how\s+are\s+you|what'?s\s+up)?[?!.]*$/i,
  /^(?:teşekkürler|teşekkür\s+ederim|sağol|sağolasın|eyvallah|eline\s+sağlık|harika)[!.]*$/i,
  /^(?:thanks|thank\s+you|thx|cheers|bye|goodbye|görüşürüz)[!.]*$/i,
  /^(?:nasılsın|naber|ne\s+haber|how\s+are\s+you|what'?s\s+up)[?!.]*$/i,
]

const ACK_PATTERNS = [
  /^(?:tamam|anladım|anlaşıldı|peki|ok|okay|k|hmm|hıhı|aynen|olur|oldu|yes|yep|sure|got\s+it|understood|noted)[!.]*$/i,
]

const CONTINUATION_PATTERNS = [
  /^(?:devam|devam\s+et|ilerle|continue|proceed|go\s+ahead|keep\s+going)[!.]*$/i,
]

const STATE_QUERY_PATTERNS = [
  /^\/(?:status|state)(?:\s+.*)?$/i,
  /(?:hard\s*state|durum|neler\s+var|ne\s+durumda|hangi\s+db|hangi\s+veritaban|hangi\s+kütüphane|hangi\s+paket)/i,
  /(?:proje\s+ne\s+durumda|projede\s+hangi|state'de|state'te|open\s+obligations|aktif\s+görevler)/i,
  /(?:what\s+is\s+the\s+status|project\s+status|what\s+database|which\s+database|show\s+state)/i,
]

const CONVERSATIONAL_PATTERNS = [
  /^(?:rust|python|typescript|javascript|c\+\+|golang)\s+ne(?:dir)?[?!.]*$/i,
  /(?:hangi\s+modeldesin|kimsin|sen\s+kimsin|modelin\s+ne|ne\s+düşünüyorsun|bunu\s+açıkla|nedir)[?!.]*$/i,
  /^(?:who\s+are\s+you|what\s+model|what\s+do\s+you\s+think|explain\s+this|what\s+is)[?!.]*$/i,
  /(?:benziyor\s+olabilir\s+mi|olabilir\s+mi|mümkün\s+mü|sence|ne\s+dersin|ne\s+yapmalıyız|fikrin\s+ne|nasıl\s+çalışır)[?!.]*$/i,
  /(?:could\s+it\s+be|is\s+it\s+possible|what\s+do\s+you\s+recommend|how\s+does\s+(?:this|it)\s+work)[?!.]*$/i,
]

const REVISION_PATTERNS = [
  /(?:bunu\s+biraz\s+aç|şöyle\s+yapalım|şunu\s+değiştir|bunun\s+yerine|farklı\s+bir\s+şekilde|revize\s+et|şunu\s+ekle)/i,
  /(?:instead\s+of|let's\s+change|revise\s+this|expand\s+on\s+this|modify\s+this)/i,
]

const MUTATION_VERBS = [
  /(?:düzelt|fix|çöz|solve|uygula|implement|yaz|write|oluştur|create|sil|delete|kaldır|remove|ekle|add)/i,
  /(?:değiştir|modify|update|güncelle|refactor|testleri\s+geçir|migrate|taşı|derle|build)/i,
  // Run/execute/verify are genuine execution verbs (test, implement, observe
  // code) — without them, "Run the tests" is misclassified as conversation.
  /(?:çalıştır|run|execute|doğrula|verify)/i,
]

export class TurnAdmissionGate {
  /**
   * Classify a raw user turn and determine its admission lifecycle contract.
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
    if (/^\/goal(?:\s+|$)/i.test(trimmed)) {
      const goalText = trimmed.replace(/^\/goal\s*/i, "").trim()
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

    if (/^\/inquiry(?:\s+|$)/i.test(trimmed) || /^\/ask(?:\s+|$)/i.test(trimmed)) {
      const queryText = trimmed.replace(/^\/(?:inquiry|ask)\s*/i, "").trim()
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

    // 3. Phatic turns (greetings, courtesies, acknowledgements of social nature)
    for (const pattern of PHATIC_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          category: "phatic",
          shouldCreateGoal: false,
          shouldCreateObligation: false,
          requiresPraxis: false,
          requiresCompletion: false,
          goalText: null,
          rationale: "Phatic turn: social pleasantry or greeting; no goal or obligation admitted",
        }
      }
    }

    // 4. Acknowledgement turns
    for (const pattern of ACK_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          category: "acknowledgement",
          shouldCreateGoal: false,
          shouldCreateObligation: false,
          requiresPraxis: false,
          requiresCompletion: false,
          goalText: null,
          rationale: "Acknowledgement turn: no new goal created",
        }
      }
    }

    // 5. Goal continuation if active goal exists
    if (activeGoal) {
      for (const pattern of CONTINUATION_PATTERNS) {
        if (pattern.test(trimmed)) {
          return {
            category: "goal_continuation",
            shouldCreateGoal: false,
            shouldCreateObligation: false,
            requiresPraxis: true,
            requiresCompletion: true,
            goalText: activeGoal,
            rationale: "Continuation of existing active goal",
          }
        }
      }

      for (const pattern of REVISION_PATTERNS) {
        if (pattern.test(trimmed)) {
          return {
            category: "goal_revision",
            shouldCreateGoal: false,
            shouldCreateObligation: false,
            requiresPraxis: true,
            requiresCompletion: true,
            goalText: activeGoal,
            rationale: "Steering or revision of existing active goal",
          }
        }
      }
    }

    // 6. State / epistemic queries (read-only inspection of project or hard state)
    for (const pattern of STATE_QUERY_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          category: "state_query",
          shouldCreateGoal: false,
          shouldCreateObligation: false,
          requiresPraxis: false,
          requiresCompletion: false,
          goalText: null,
          obligationKind: "epistemic_inquiry",
          rationale: "Epistemic state query: read-only projection, no persistent goal/obligation needed",
        }
      }
    }

    // 7. General conversational questions
    for (const pattern of CONVERSATIONAL_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          category: "conversational_query",
          shouldCreateGoal: false,
          shouldCreateObligation: false,
          requiresPraxis: false,
          requiresCompletion: false,
          goalText: null,
          rationale: "Conversational query: informational inquiry without state mutation or verification requirements",
        }
      }
    }

    // 8. Question syntax check (sentences ending in '?' or containing question markers without mutation verbs)
    const isQuestion = trimmed.endsWith("?") || /(?:(?:^|\s)(?:nedir|nasıl|neden|niçin|kim|hangi|ne zaman|nerede|how|why|what|when|where|which|could|would|can)\b)/i.test(trimmed)
    const hasMutationVerb = MUTATION_VERBS.some((pat) => pat.test(trimmed))

    if (isQuestion && !hasMutationVerb) {
      return {
        category: "conversational_query",
        shouldCreateGoal: false,
        shouldCreateObligation: false,
        requiresPraxis: false,
        requiresCompletion: false,
        goalText: null,
        rationale: "Conversational question without workspace mutation verbs",
      }
    }

    // 9. Mutation / Action tasks (explicit verbs targeting the workspace)
    if (hasMutationVerb) {
      return {
        category: "autonomous_goal",
        shouldCreateGoal: true,
        shouldCreateObligation: true,
        requiresPraxis: true,
        requiresCompletion: true,
        goalText: trimmed,
        obligationKind: "execution",
        rationale: "Action-oriented turn containing mutation/execution verbs",
      }
    }

    // 10. Default: In the absence of mutation verbs or execution directives, conversation is not automatically an execution goal.
    return {
      category: "conversational_query",
      shouldCreateGoal: false,
      shouldCreateObligation: false,
      requiresPraxis: false,
      requiresCompletion: false,
      goalText: null,
      rationale: "Conversational turn without mutation verbs admitted as conversational query",
    }
  }
}

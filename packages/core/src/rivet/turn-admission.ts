import type { ObligationKind, TaskAuthority } from "./types"

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
  readonly taskAuthority: TaskAuthority
  readonly shouldCreateGoal: boolean
  readonly shouldCreateObligation: boolean
  readonly requiresPraxis: boolean
  readonly requiresCompletion: boolean
  readonly goalText: string | null
  readonly obligationKind?: ObligationKind
  readonly rationale: string
}

function taskAuthorityFor(turnText: string): TaskAuthority {
  const hasMaintenanceAction =
    /\b(?:audit|inspect|debug|develop|improve|fix|repair|modify|change|update|implement|test|refactor|maintain|review|examine|incele|audit\s+et|düzelt|geliştir|iyileştir|değiştir|güncelle|uygula|test\s+et|bak)\b/i.test(
      turnText,
    )
  if (!hasMaintenanceAction) return "normal_project_task"

  const mentionsRivet = /\brivet(?:['’][\p{L}]+)?\b/iu.test(turnText)
  const mentionsRivetInternals =
    /\b(?:system\s+prompt|runtime|harness|governance|internal(?:s)?|itself|completion|sistem\s+prompt(?:u|unu)?|çalışma\s+zamanı|yönetişim|iç\s+yapı)\b/iu.test(
      turnText,
    )
  const mentionsGovernanceModule =
    /\b(?:accp|turn\s*admission|turnadmission|praxis|noesis|commitment(?:\.ts)?|session\s*runner|sessionrunner)\b/iu.test(
      turnText,
    )
  const namesBugOrPolicy = /\b(?:bug|bug\p{L}*|denial|policy|polic(?:y|ies)|hata|sorun|engel|redd|yönetim)\b/iu.test(turnText)

  if (mentionsRivet && mentionsRivetInternals) return "rivet_maintenance_task"
  if (mentionsRivet && mentionsGovernanceModule) return "rivet_maintenance_task"
  if (mentionsGovernanceModule && namesBugOrPolicy) return "rivet_maintenance_task"
  return "normal_project_task"
}

export class TurnAdmissionGate {
  /**
   * Classify a raw user turn and determine its admission lifecycle contract.
   * Enforces the Quadruple Invariant:
   * 1. Not every turn creates a goal.
   * 2. Not every goal creates an obligation.
   * 3. Not every obligation requires Praxis.
   * 4. Not every response requires completion.
   *
   * Principled boundary:
   * - Explicit markers ([RIVET GOAL EXECUTION], /goal) create autonomous execution goals with Praxis.
   * - Epistemic commands (/inquiry, /ask) create read-only inspection goals.
   * - Explicit Rivet maintenance intent creates a maintenance-authorized goal.
   * - Natural conversational turns (greetings, questions, feedback, chat) do not create synthetic goals.
   */
  static classify(turnText: string, _activeGoal?: string | null): TurnAdmissionDecision {
    const trimmed = turnText.trim()

    // 1. Explicit RIVET goal execution directives
    if (trimmed.startsWith("[RIVET GOAL EXECUTION]")) {
      const match = trimmed.match(/Goal:\s*(.+?)(?:\n|$)/i)
      const goalText = match && match[1]?.trim()
        ? match[1].trim()
        : trimmed.replace(/^\[RIVET GOAL EXECUTION\]\s*/i, "").trim()

      return {
        category: "autonomous_goal",
        taskAuthority: taskAuthorityFor(goalText || trimmed),
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
        taskAuthority: taskAuthorityFor(goalText || trimmed),
        shouldCreateGoal: true,
        shouldCreateObligation: true,
        requiresPraxis: true,
        requiresCompletion: true,
        goalText: goalText || trimmed,
        obligationKind: "execution",
        rationale: "Explicit /goal command",
      }
    }

    if (/^\/(?:inquiry|ask)(?:\s+|$)/i.test(trimmed)) {
      const queryText = trimmed.replace(/^\/(?:inquiry|ask)\s*/i, "").trim()
      const hasQuery = queryText.length > 0
      return {
        category: "state_query",
        taskAuthority: taskAuthorityFor(queryText),
        shouldCreateGoal: hasQuery,
        shouldCreateObligation: hasQuery,
        requiresPraxis: false,
        requiresCompletion: false,
        goalText: hasQuery ? queryText : null,
        obligationKind: "epistemic_inquiry",
        rationale: hasQuery ? "Explicit /inquiry query goal" : "Explicit /inquiry epistemic inspection",
      }
    }

    // 3. Conversational complaints & feedback
    if (/^(?:you\s+didn't\s+answer|bana\s+cevap\s+vermedin|cevap\s+ver)/i.test(trimmed)) {
      return {
        category: "conversational_query",
        taskAuthority: "normal_project_task",
        shouldCreateGoal: false,
        shouldCreateObligation: false,
        requiresPraxis: false,
        requiresCompletion: false,
        goalText: null,
        rationale: "Conversational feedback or complaint; no persistent execution goal",
      }
    }

    // 4. Conversational steering & redirection
    if (/^(?:change\s+direction|start\s+working|never\s*mind|hold\s+on|wait|stop|let's\s+move\s+on|yön\s+değiştir|boşver|dur|bekle)[.!?\s]*$/i.test(trimmed)) {
      return {
        category: "conversational_query",
        taskAuthority: "normal_project_task",
        shouldCreateGoal: false,
        shouldCreateObligation: false,
        requiresPraxis: false,
        requiresCompletion: false,
        goalText: null,
        rationale: "Conversational steering or redirection; no persistent execution goal",
      }
    }

    // 5. Phatic conversation and greetings
    const PHATIC_PATTERN = /^(?:selam|merhaba|günaydın|iyi\s+(?:günler|akşamlar)|hey|hi|hello|greetings|howdy|naber|nasılsın|sup|yo|merhabalar)[.!?\s]*$/i
    if (PHATIC_PATTERN.test(trimmed)) {
      return {
        category: "conversational_query",
        taskAuthority: "normal_project_task",
        shouldCreateGoal: false,
        shouldCreateObligation: false,
        requiresPraxis: false,
        requiresCompletion: false,
        goalText: null,
        rationale: "Phatic pleasantry or greeting; no persistent goal needed",
      }
    }

    // 6. Acknowledgements
    const ACK_PATTERN = /^(?:tamam|anladım|teşekkürler|teşekkür\s+ederim|sağol|eyvallah|ok|okay|got\s+it|understood|thanks|thank\s+you|cool|great|harika|süper|anlaşıldı|peki|hmm|sure)[.!?\s]*$/i
    if (ACK_PATTERN.test(trimmed)) {
      return {
        category: "conversational_query",
        taskAuthority: "normal_project_task",
        shouldCreateGoal: false,
        shouldCreateObligation: false,
        requiresPraxis: false,
        requiresCompletion: false,
        goalText: null,
        rationale: "Acknowledgement; no persistent goal needed",
      }
    }

    // 7. Explicit user-authorized Rivet maintenance. This is intentionally
    // derived from the user turn before generic question/action handling; a
    // model claim that Rivet is broken cannot produce this authority.
    const taskAuthority = taskAuthorityFor(trimmed)
    if (taskAuthority === "rivet_maintenance_task") {
      return {
        category: "autonomous_goal",
        taskAuthority,
        shouldCreateGoal: true,
        shouldCreateObligation: true,
        requiresPraxis: true,
        requiresCompletion: true,
        goalText: trimmed,
        obligationKind: "execution",
        rationale: "Explicit user-authorized Rivet maintenance intent",
      }
    }

    // 8. Information Acquisition (Questions, state queries, inspection of files or system)
    const isPureStateInspection = /^(?:show\s+state|hard\s+state(?:'de)?\s+ne(?:ler)?\s+var|proje\s+ne\s+durumda)/i.test(trimmed)
    const isExplanationQuery = /^(?:how\s+(?:do|can|does|to)\b|explain\b|tell\s+me\s+about\b|nedir\b|nasıl\s+(?:yapılır|çalışır)\b)/i.test(trimmed)
    const isQuestionSyntax = trimmed.endsWith("?") || /(?:^(?:what|where|when|who|which|why|is\s+there|are\s+there|does\s+it|did\s+the|can\s+you\s+(?:check|look|see))\b)/i.test(trimmed) || /(?:(?:nerede|nedir|nasıl|kaç|hangi|hangisi|kim|kimsin|ne\s+zaman|var\s+mı|yok\s+mu|olabilir\s+mi|bakar\s+mısın(?:ız)?)[?!.]*$)/i.test(trimmed)
    const hasCompoundMutationDirective = /(?:(?:ve|and)\s+(?:ekle|düzelt|oluştur|sil|değiştir|add|fix|create|delete|test))\b/i.test(trimmed)

    if (isPureStateInspection || isExplanationQuery || (isQuestionSyntax && !hasCompoundMutationDirective)) {
      return {
        category: "conversational_query",
        taskAuthority: "normal_project_task",
        shouldCreateGoal: false,
        shouldCreateObligation: false,
        requiresPraxis: false,
        requiresCompletion: false,
        goalText: null,
        rationale: "Information acquisition / inspection query: read-only, no persistent goal created",
      }
    }

    // 9. Natural Execution / Mutation Directives
    const EXECUTION_PATTERNS = [
      /(?:run|fix|execute)\s+and\s+verify\b/i,
      /^(?:run|fix|execute)\s+.*(?:echo|test|build|suite|code|file|function|module)/i,
      /\b(?:create|write|implement|build|fix|repair|solve|delete|remove|refactor|migrate|patch)\b/i,
      /\b(?:update|modify|change)\s+(?:the\s+|this\s+|that\s+|a\s+|an\s+)?(?:code|file|test|function|module|package|version|repo|repository|database|config)/i,
      /\b(?:oluştur|yaz|uygula|kur|düzelt|çöz|sil|kaldır|yama|güncelle|değiştir)\b/i,
      /\b(?:çalıştır|test\s+et|testi\s+düzelt)\s+ve\s+(?:doğrula|geçtiğini\s+doğrula|düzelt)\b/i,
    ]

    if (EXECUTION_PATTERNS.some((pat) => pat.test(trimmed))) {
      return {
        category: "autonomous_goal",
        taskAuthority: "normal_project_task",
        shouldCreateGoal: true,
        shouldCreateObligation: true,
        requiresPraxis: true,
        requiresCompletion: true,
        goalText: trimmed,
        obligationKind: "execution",
        rationale: "Action-oriented turn requesting repository mutation or autonomous execution",
      }
    }

    // 10. Default: Conversational query
    return {
      category: "conversational_query",
      taskAuthority: "normal_project_task",
      shouldCreateGoal: false,
      shouldCreateObligation: false,
      requiresPraxis: false,
      requiresCompletion: false,
      goalText: null,
      rationale: "Natural conversational turn: cognitive intent evaluated by LLM",
    }
  }
}

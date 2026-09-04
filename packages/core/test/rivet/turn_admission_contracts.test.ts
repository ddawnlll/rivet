import { describe, expect, test } from "bun:test"
import {
  AccpSemanticGate,
  CognitiveViewCompiler,
  HardState,
  Revision,
  TurnAdmissionGate,
} from "../../src/rivet"

describe("Turn Semantics & Lifecycle Admission Gate (v0.3.1 / I-21)", () => {
  test("I-21.1: Natural language conversational turns (phatic, conversational, queries) do not create goals or obligations", () => {
    const conversationalExamples = [
      "Selam",
      "selam!",
      "merhaba",
      "günaydın",
      "iyi akşamlar",
      "teşekkürler",
      "sağol",
      "eyvallah",
      "hello",
      "hi there",
      "thanks!",
      "nasılsın?",
      "tamam",
      "anladım",
      "ok",
      "peki",
      "hmm",
      "anlaşıldı",
      "sure",
      "got it",
      "Rust ne?",
      "hangi modeldesin?",
      "sen kimsin?",
      "what model are you?",
      "what do you think?",
      "TypeScript nedir?",
      "proje ne durumda? hard state'de neler var",
      "projede hangi DB kullanıyoruz?",
      "hard state'de ne var?",
      "show state",
    ]

    for (const text of conversationalExamples) {
      const decision = TurnAdmissionGate.classify(text)
      expect(decision.category).toBe("conversational_query")
      expect(decision.shouldCreateGoal).toBe(false)
      expect(decision.shouldCreateObligation).toBe(false)
      expect(decision.requiresPraxis).toBe(false)
      expect(decision.requiresCompletion).toBe(false)
      expect(decision.goalText).toBeNull()
    }
  })

  test("I-21.2: Epistemic state slash commands (/inquiry, /ask) create read-only inspection goals", () => {
    const queryCommands = [
      "/inquiry",
      "/ask",
      "/inquiry hard state inspection",
      "/ask what is the current revision",
    ]

    for (const text of queryCommands) {
      const decision = TurnAdmissionGate.classify(text)
      expect(decision.category).toBe("state_query")
      expect(decision.requiresPraxis).toBe(false)
      expect(decision.requiresCompletion).toBe(false)
      expect(decision.obligationKind).toBe("epistemic_inquiry")
    }
  })

  test("I-21.3: Explicit autonomous execution commands (/goal, [RIVET GOAL EXECUTION]) create goals and obligations", () => {
    const goalCommands = [
      "[RIVET GOAL EXECUTION]\nGoal: Fix memory leak in buffer",
      "/goal migrate database to sqlite",
      "/goal refactor the session runner module",
      "/goal implement error boundary in frontend",
    ]

    for (const text of goalCommands) {
      const decision = TurnAdmissionGate.classify(text)
      expect(decision.category).toBe("autonomous_goal")
      expect(decision.shouldCreateGoal).toBe(true)
      expect(decision.shouldCreateObligation).toBe(true)
      expect(decision.requiresPraxis).toBe(true)
      expect(decision.requiresCompletion).toBe(true)
      expect(decision.goalText).toBeDefined()
      expect(decision.goalText!.length).toBeGreaterThan(0)
    }
  })


  test("I-21.7: Completion contract v2 returns NOT_REQUIRED when no active goal exists", () => {
    const readiness = AccpSemanticGate.checkCompletionReadiness({
      unclosedObligations: [],
      passingReceipts: [],
      hasActiveGoal: false,
      totalObligations: 0,
    })

    expect(readiness.status).toBe("NOT_REQUIRED")
    expect(readiness.blockers).toHaveLength(0)
    expect(readiness.structuredBlockers).toHaveLength(0)
  })

  test("I-21.8: CognitiveView formatting in conversational mode does NOT leak internal completion bureaucracy", () => {
    const state = new HardState()
    expect(state.goalDescription).toBeNull()

    const view = CognitiveViewCompiler.compile({
      hardState: state,
      repositoryId: "rivet-repo",
      userPrompt: "Selam",
      tokenBudget: 4000,
      mode: "RAW_TEXT",
    })

    expect(view.completionReadiness.status).toBe("NOT_REQUIRED")
    expect(view.completionReadiness.blockers).toHaveLength(0)

    const cognitiveView = CognitiveViewCompiler.toCognitiveView(view)
    const promptBlock = cognitiveView.formatPromptBlock()
    // Must contain conversational mode directive
    expect(promptBlock).toContain("CONVERSATIONAL MODE")
    expect(promptBlock).toContain("No Active Autonomous Goal")
    // Must NOT contain intimidating completion blocker language
    expect(promptBlock).not.toContain("COMPLETION READINESS: BLOCKED")
    expect(promptBlock).not.toContain("Completion is currently BLOCKED by Harness runtime gates")
    expect(promptBlock).not.toContain("Address ONLY the blockers listed above")

    const rendered = CognitiveViewCompiler.render(view)
    expect(rendered).toContain("Status: NOT_REQUIRED (Conversational / Non-goal mode)")
  })
})

import { describe, expect, test } from "bun:test"
import {
  AccpSemanticGate,
  CognitiveViewCompiler,
  HardState,
  Revision,
  TurnAdmissionGate,
} from "../../src/rivet"

describe("Turn Semantics & Lifecycle Admission Gate (v0.3.1 / I-21)", () => {
  test("I-21.1: Phatic turns do not create goals or obligations", () => {
    const phaticExamples = [
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
    ]

    for (const text of phaticExamples) {
      const decision = TurnAdmissionGate.classify(text)
      expect(decision.category).toBe("phatic")
      expect(decision.shouldCreateGoal).toBe(false)
      expect(decision.shouldCreateObligation).toBe(false)
      expect(decision.requiresPraxis).toBe(false)
      expect(decision.requiresCompletion).toBe(false)
      expect(decision.goalText).toBeNull()
    }
  })

  test("I-21.2: Acknowledgements do not create goals or obligations", () => {
    const ackExamples = ["tamam", "anladım", "ok", "peki", "hmm", "anlaşıldı", "sure", "got it"]

    for (const text of ackExamples) {
      const decision = TurnAdmissionGate.classify(text)
      expect(decision.category).toBe("acknowledgement")
      expect(decision.shouldCreateGoal).toBe(false)
      expect(decision.shouldCreateObligation).toBe(false)
      expect(decision.requiresPraxis).toBe(false)
      expect(decision.requiresCompletion).toBe(false)
      expect(decision.goalText).toBeNull()
    }
  })

  test("I-21.3: Conversational queries do not create goals or obligations", () => {
    const convExamples = [
      "Rust ne?",
      "hangi modeldesin?",
      "sen kimsin?",
      "what model are you?",
      "what do you think?",
      "TypeScript nedir?",
    ]

    for (const text of convExamples) {
      const decision = TurnAdmissionGate.classify(text)
      expect(decision.category).toBe("conversational_query")
      expect(decision.shouldCreateGoal).toBe(false)
      expect(decision.shouldCreateObligation).toBe(false)
      expect(decision.requiresPraxis).toBe(false)
      expect(decision.requiresCompletion).toBe(false)
    }
  })

  test("I-21.4: Epistemic state queries inspect without mutating or creating goals", () => {
    const queryExamples = [
      "/inquiry",
      "/ask",
      "proje ne durumda? hard state'de neler var",
      "projede hangi DB kullanıyoruz?",
      "hard state'de ne var?",
      "show state",
    ]

    for (const text of queryExamples) {
      const decision = TurnAdmissionGate.classify(text)
      expect(decision.category).toBe("state_query")
      expect(decision.shouldCreateGoal).toBe(false)
      expect(decision.shouldCreateObligation).toBe(false)
      expect(decision.requiresPraxis).toBe(false)
      expect(decision.requiresCompletion).toBe(false)
    }
  })

  test("I-21.5: Autonomous goals with mutation verbs or directives create goals and obligations", () => {
    const goalExamples = [
      "[RIVET GOAL EXECUTION]\nGoal: Fix memory leak in buffer",
      "/goal migrate database to sqlite",
      "bu bug'ı düzelt ve testleri geçir",
      "refactor the session runner module",
      "implement error boundary in frontend",
    ]

    for (const text of goalExamples) {
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

  test("I-21.6: Goal continuation & revision binds to active goal without re-compiling duplicate root", () => {
    const activeGoal = "Fix syntax error in parser"

    const contDecision = TurnAdmissionGate.classify("devam", activeGoal)
    expect(contDecision.category).toBe("goal_continuation")
    expect(contDecision.shouldCreateGoal).toBe(false)
    expect(contDecision.requiresCompletion).toBe(true)
    expect(contDecision.goalText).toBe(activeGoal)

    const revDecision = TurnAdmissionGate.classify("bunu biraz aç", activeGoal)
    expect(revDecision.category).toBe("goal_revision")
    expect(revDecision.shouldCreateGoal).toBe(false)
    expect(revDecision.requiresCompletion).toBe(true)
    expect(revDecision.goalText).toBe(activeGoal)
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

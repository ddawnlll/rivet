import { describe, expect, test } from "bun:test"
import {
  AccpSemanticGate,
  GoalCompiler,
  HardState,
  PraxisEngine,
  Revision,
  Scope,
  TurnAdmissionGate,
  classifyGoalKind,
  createEvidenceId,
  createObligationId,
  createReceiptId,
  createTaskId,
  isValidFilePathCandidate,
} from "../../src/rivet"

describe("Controller Turn & Epistemic Boundary Regressions", () => {
  test("1. Turkish conversational sentences with punctuation do not create goals or file constraints", () => {
    const turkishSentences = [
      "Her şey tamam oldu.",
      "Şimdi şuna geçsek.",
      "Sistem veritabanına bağlanıyor.",
      "Böyle bir şey olabilir.",
      "Masaya bardağı koyuyor.",
      "Gözüne ışık çarpıyor.",
      "Nasılsın acaba?",
      "Teşekkürler, eline sağlık.",
      "Auth tarafında gene timeout almaya başladık, eski race condition sorununa benziyor olabilir mi?",
    ]

    for (const text of turkishSentences) {
      const admission = TurnAdmissionGate.classify(text)
      expect(admission.shouldCreateGoal).toBe(false)
      expect(admission.shouldCreateObligation).toBe(false)
      expect(admission.requiresPraxis).toBe(false)
      expect(admission.category).not.toBe("autonomous_goal")

      // Even if compile is directly called, file constraints must NOT be minted for verbs
      const compiled = GoalCompiler.compile(text, "rivet-repo", Revision.ZERO)
      const fileObligations = [...compiled.graph.nodes.values()].filter(
        (node) => node.predicate.type === "file_constraint",
      )
      expect(fileObligations).toHaveLength(0)
    }
  })

  test("2. English conversational equivalents do not create goals or file constraints", () => {
    const englishSentences = [
      "Everything is looking good.",
      "Shall we move on to the next topic.",
      "I think this makes sense.",
      "Could you tell me more about how this works?",
      "Thanks for the explanation.",
      "What do you think about our architecture?",
    ]

    for (const text of englishSentences) {
      const admission = TurnAdmissionGate.classify(text)
      expect(admission.shouldCreateGoal).toBe(false)
      expect(admission.shouldCreateObligation).toBe(false)
      expect(admission.requiresPraxis).toBe(false)
      expect(admission.category).not.toBe("autonomous_goal")

      const compiled = GoalCompiler.compile(text, "rivet-repo", Revision.ZERO)
      const fileObligations = [...compiled.graph.nodes.values()].filter(
        (node) => node.predicate.type === "file_constraint",
      )
      expect(fileObligations).toHaveLength(0)
    }
  })

  test("3. Ordinary decimal, version, and abbreviation tokens are rejected as file candidates", () => {
    const nonPathTokens = [
      "1.2.3",
      "2.0.0",
      "v1.0.0",
      "3.14",
      "e.g.",
      "i.e.",
      "etc.",
      "vs.",
      "10.30",
      "oldu.",
      "gecsek.",
      "bagliyor.",
      "olabilir.",
    ]

    for (const token of nonPathTokens) {
      expect(isValidFilePathCandidate(token)).toBe(false)
    }
  })

  test("4. Legitimate relative and repository-local paths are correctly recognized and extracted", () => {
    const validPaths = [
      "src/session/runner/llm.ts",
      "packages/core/src/rivet/types.ts",
      "packages/core/package.json",
      "main.rs",
      "config.toml",
      "README.md",
      "./schema.sql",
    ]

    for (const path of validPaths) {
      expect(isValidFilePathCandidate(path)).toBe(true)
    }

    // Extraction in an execution request strips sentence punctuation
    const prompt = "Please fix the error in packages/core/src/rivet/types.ts and main.rs."
    const compiled = GoalCompiler.compile(prompt, "rivet-repo", Revision.ZERO, "execution")
    const fileObligations = [...compiled.graph.nodes.values()].filter(
      (node) => node.predicate.type === "file_constraint",
    )

    expect(fileObligations.length).toBeGreaterThanOrEqual(2)
    const paths = fileObligations.map((o) => (o.predicate as { path: string }).path)
    expect(paths).toContain("packages/core/src/rivet/types.ts")
    expect(paths).toContain("main.rs")
    // Trailing period must be stripped
    expect(paths.some((p) => p.endsWith("."))).toBe(false)
  })

  test("5. Explicit code execution requests create autonomous execution goals", () => {
    const executionPrompts = [
      "/goal Fix memory leak in session buffer",
      "/goal migrate database to sqlite",
      "[RIVET GOAL EXECUTION]\nGoal: Refactor auth module",
      "/goal Implement user login endpoint in server",
    ]

    for (const prompt of executionPrompts) {
      const admission = TurnAdmissionGate.classify(prompt)
      expect(admission.category).toBe("autonomous_goal")
      expect(admission.shouldCreateGoal).toBe(true)
      expect(admission.shouldCreateObligation).toBe(true)
      expect(admission.requiresPraxis).toBe(true)
      expect(admission.obligationKind).toBe("execution")
    }
  })

  test("6. TurnAdmission to GoalCompiler propagation matches semantics", () => {
    expect(classifyGoalKind("Selam nasılsın")).toBe("epistemic_inquiry")
    expect(classifyGoalKind("Can you explain Praxis?")).toBe("epistemic_inquiry")
    expect(classifyGoalKind("/inquiry hard state ne durumda?")).toBe("epistemic_inquiry")
    expect(classifyGoalKind("/goal fix the bug in parser.ts")).toBe("execution")
    expect(classifyGoalKind("/goal implement feature X")).toBe("execution")
  })

  test("7. Malformed obligation invalidation provides an auditable closure path without reality mutation", () => {
    const state = new HardState()
    const malformedId = createObligationId()

    // Simulate accidental creation of a malformed obligation
    state.apply({
      type: "obligation_created",
      obligationId: malformedId,
      description: "Ensure target path 'oldu.' is maintained",
      scope: Scope.path("repo", "oldu.", Revision.ZERO),
      kind: "execution",
      timestamp: new Date().toISOString(),
    })

    expect(state.openObligationIds()).toContain(malformedId)

    // Check completion before invalidation: BLOCKED
    const readinessBefore = AccpSemanticGate.checkCompletionReadiness({
      unclosedObligations: state.openObligationIds(),
      passingReceipts: state.closureReceiptIds(),
      getKind: (id) => state.obligationKind(id),
    })
    expect(readinessBefore.status).toBe("BLOCKED")

    // Invalidate obligation explicitly with rationale
    const invalidationReason = "Malformed obligation: 'oldu.' is sentence punctuation, not a workspace file"
    state.apply({
      type: "obligation_invalidated",
      obligationId: malformedId,
      reason: invalidationReason,
      timestamp: new Date().toISOString(),
    })

    // Obligation is removed from active open obligations and audited
    expect(state.openObligationIds()).not.toContain(malformedId)
    expect(state.invalidatedObligations.get(malformedId)).toBe(invalidationReason)

    // Completion is no longer blocked by the malformed obligation
    const readinessAfter = AccpSemanticGate.checkCompletionReadiness({
      unclosedObligations: state.openObligationIds(),
      passingReceipts: [createReceiptId()],
      hasActiveGoal: true,
      totalObligations: 1,
    })
    expect(readinessAfter.status).toBe("READY")
  })

  test("8. Praxis verification exposes rich reason codes and diagnostics on failure", () => {
    const req = {
      obligationId: createObligationId(),
      predicate: "bun test",
      targetScope: Scope.global("repo", Revision.ZERO),
      timeoutSeconds: 30,
      timestamp: new Date().toISOString(),
    }

    // Scenario A: Tests failed (0 pass, 2 fail)
    const failedReport = {
      passedCount: 0,
      failedCount: 2,
      skippedCount: 0,
      rawStdout: "0 pass\n2 fail",
      rawStderr: "TypeError: undefined is not a function",
    }
    const failedReceipt = PraxisEngine.evaluateTestResult(req, failedReport)
    expect(failedReceipt.passed).toBe(false)
    expect(failedReceipt.reasonCodes).toContain("TESTS_FAILED")
    expect(failedReceipt.diagnostics).toContain("2 failed")

    // Scenario B: No tests found / non-test output (0 pass, 0 fail)
    const emptyReport = {
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      rawStdout: "file touch completed",
      rawStderr: "",
    }
    const emptyReceipt = PraxisEngine.evaluateTestResult(req, emptyReport)
    expect(emptyReceipt.passed).toBe(false)
    expect(emptyReceipt.reasonCodes).toContain("NO_PASSING_TESTS")
    expect(emptyReceipt.diagnostics).toContain("0 passed, 0 failed")

    // Scenario C: Passing test (4 pass, 0 fail)
    const passedReport = {
      passedCount: 4,
      failedCount: 0,
      skippedCount: 0,
      rawStdout: "4 pass\n0 fail",
      rawStderr: "",
    }
    const passedReceipt = PraxisEngine.evaluateTestResult(req, passedReport)
    expect(passedReceipt.passed).toBe(true)
    expect(passedReceipt.reasonCodes).toContain("TESTS_PASSED")
    expect(passedReceipt.diagnostics).toBeNull()
  })

  test("9. AccpSemanticGate evaluates completion accurately with passing receipts and no open obligations", () => {
    const taskId = createTaskId()
    const passingReceipt = createReceiptId()
    const rev = Revision.ZERO

    const proposal = {
      taskId,
      summary: "Refactored parser with passing tests",
      claimsAddressed: [],
      baseRevision: rev,
      timestamp: new Date().toISOString(),
    }

    const decision = AccpSemanticGate.evaluateCompletion(
      proposal,
      rev,
      [], // no open obligations
      [passingReceipt],
    )

    expect(decision.completed).toBe(true)
    expect(decision.finalReceipt).toBe(passingReceipt)
    expect(decision.blockers).toHaveLength(0)
  })

  test("10. A response complaint reuses conversation state instead of creating execution work", () => {
    const correction = TurnAdmissionGate.classify("You didn't answer my question.", "Existing execution goal")
    expect(correction.shouldCreateGoal).toBe(false)
    expect(correction.shouldCreateObligation).toBe(false)
    expect(correction.requiresPraxis).toBe(false)
    expect(correction.requiresCompletion).toBe(false)

    const configQuestion = TurnAdmissionGate.classify("Where do we configure the custom provider?")
    expect(configQuestion.shouldCreateGoal).toBe(false)
    expect(configQuestion.shouldCreateObligation).toBe(false)
  })
})

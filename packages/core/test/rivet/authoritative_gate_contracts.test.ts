import { describe, expect, test } from "bun:test"
import { AccpSemanticGate, type CompletionProposal } from "../../src/rivet/accp"
import { GoalCompiler } from "../../src/rivet/goal-compiler"
import { HardState } from "../../src/rivet/noesis"
import { Revision, Scope, createObligationId, createReceiptId, createTaskId } from "../../src/rivet/types"
import { CognitiveViewCompiler } from "../../src/rivet/view-compiler"

describe("Authoritative Gate Contracts & Cognitive Controller Alignment", () => {
  test("Behavioral Regression: Hard State inquiry closes via authoritative Noesis projection without shell or Praxis", () => {
    const userPrompt = "proje ne durumda? hard state'de neler var"
    const repo = "rivet-workspace"
    const rev = Revision.ZERO

    // 1. Goal Compilation: Compiles epistemic_inquiry obligation DAG with 0 file-execution constraints
    const goalSpec = GoalCompiler.compile(userPrompt, repo, rev, "epistemic_inquiry")
    const openNodes = goalSpec.graph.openObligations()
    expect(openNodes).toHaveLength(1)
    expect(openNodes[0].kind).toBe("epistemic_inquiry")

    // 2. Initialize HardState and apply created obligation
    const state = new HardState()
    state.goalDescription = userPrompt
    state.activeTaskId = goalSpec.goalId
    for (const node of openNodes) {
      state.apply({
        type: "obligation_created",
        obligationId: node.id,
        description: node.description,
        scope: node.targetScope,
        kind: node.kind,
        timestamp: new Date().toISOString(),
      })
    }

    // 3. CognitiveView: Initial compilation before query
    const initialView = CognitiveViewCompiler.compile({
      hardState: state,
      goalDescription: userPrompt,
      repositoryId: repo,
      tokenBudget: 4000,
      mode: "RAW_TEXT",
    })

    // Completion is BLOCKED before Noesis query
    expect(initialView.completionReadiness.status).toBe("BLOCKED")
    expect(initialView.completionReadiness.blockers.length).toBeGreaterThan(0)
    expect(initialView.completionReadiness.blockers[0]).toContain("AUTHORITATIVE_STATE_PROJECTION")

    // Obligation contract shows Verifier: NOESIS, Praxis: NOT REQUIRED
    const oblgRecord = initialView.obligations.find((o) => o.id === openNodes[0].id)
    expect(oblgRecord).toBeDefined()
    expect(oblgRecord!.closure.verifier).toBe("NOESIS")
    expect(oblgRecord!.closure.praxisRequired).toBe(false)
    expect(oblgRecord!.closure.requiredProofKind).toBe("AUTHORITATIVE_STATE_PROJECTION")
    expect(oblgRecord!.blockers[0]).toContain("authoritative Noesis projection")

    // Rendered text explicitly exposes prompt-visible rules
    const rendered = CognitiveViewCompiler.render(initialView)
    expect(rendered).toContain("Completion Readiness: BLOCKED")
    expect(rendered).toContain("EPISTEMIC_INQUIRY")
    expect(rendered).toContain("proof=AUTHORITATIVE_STATE_PROJECTION")
    expect(rendered).toContain("praxis=NOT_REQUIRED")

    // 4. Model calls query_epistemic_state -> Harness serves authoritative projection and satisfies inquiry
    const inquiryReceiptId = createReceiptId()
    state.apply({
      type: "inquiry_satisfied",
      obligationId: openNodes[0].id,
      receiptId: inquiryReceiptId,
      satisfiedAtRevision: state.revision,
      summary: `Authoritative epistemic projection served at revision ${state.revision.toJSON()}`,
      timestamp: new Date().toISOString(),
    })

    expect(state.openObligationIds()).toHaveLength(0)
    expect(state.closureReceiptIds()).toHaveLength(1)

    // 5. Updated CognitiveView: Completion is now READY
    const updatedView = CognitiveViewCompiler.compile({
      hardState: state,
      goalDescription: userPrompt,
      repositoryId: repo,
      tokenBudget: 4000,
      mode: "RAW_TEXT",
    })

    expect(updatedView.completionReadiness.status).toBe("READY")
    expect(updatedView.completionReadiness.blockers).toHaveLength(0)

    const satisfiedOblg = updatedView.obligations.find((o) => o.id === openNodes[0].id)
    expect(satisfiedOblg!.status).toBe("satisfied")
    expect(satisfiedOblg!.closure.acceptedProofRefs).toContain(inquiryReceiptId)

    // 6. Completion Proposal is accepted on FIRST ATTEMPT
    state.completionAttempts++
    const proposal: CompletionProposal = {
      taskId: goalSpec.goalId,
      summary: "Proje hard state durumu aktarıldı.",
      claimsAddressed: [],
      baseRevision: state.revision,
      timestamp: new Date().toISOString(),
    }

    const decision = AccpSemanticGate.evaluateCompletion(
      proposal,
      state.revision,
      state.openObligationIds(),
      state.closureReceiptIds(),
      {
        getKind: (id) => state.obligationKind(id),
        getDescription: (id) => state.obligations.get(id) ?? id,
      },
    )

    expect(decision.completed).toBe(true)
    expect(decision.requiredObligationsSatisfied).toBe(true)
    expect(decision.finalReceipt).toBe(inquiryReceiptId)
    expect(decision.blockers).toHaveLength(0)

    state.firstAttemptAccepted = true
    const metrics = state.getGateMetrics()
    expect(metrics.completionAttempts).toBe(1)
    expect(metrics.gateRejectionCount).toBe(0)
    expect(metrics.avoidableGateRejectionCount).toBe(0)
    expect(metrics.firstAttemptAccepted).toBe(true)
    expect(metrics.firstAttemptAcceptanceRate).toBe(1)
  })

  test("Structured Blockers: Premature completion returns actionable blockers and increments avoidable rejections", () => {
    const state = new HardState()
    const oblgId = createObligationId()
    state.apply({
      type: "obligation_created",
      obligationId: oblgId,
      description: "Implement user authentication",
      scope: Scope.global("repo", Revision.ZERO),
      kind: "execution",
      timestamp: new Date().toISOString(),
    })

    // Check readiness before completion
    const readiness = AccpSemanticGate.checkCompletionReadiness({
      unclosedObligations: state.openObligationIds(),
      passingReceipts: state.closureReceiptIds(),
      getKind: (id) => state.obligationKind(id),
      getDescription: (id) => state.obligations.get(id) ?? id,
    })

    expect(readiness.status).toBe("BLOCKED")
    expect(readiness.structuredBlockers).toHaveLength(1)
    expect(readiness.structuredBlockers[0].obligationId).toBe(oblgId)
    expect(readiness.structuredBlockers[0].kind).toBe("execution")
    expect(readiness.structuredBlockers[0].verifier).toBe("PRAXIS")
    expect(readiness.structuredBlockers[0].actionableGuidance).toContain("request_verification")

    // Premature completion attempt
    state.completionAttempts++
    const proposal: CompletionProposal = {
      taskId: createTaskId(),
      summary: "I think it is done",
      claimsAddressed: [],
      baseRevision: state.revision,
      timestamp: new Date().toISOString(),
    }

    const decision = AccpSemanticGate.evaluateCompletion(
      proposal,
      state.revision,
      state.openObligationIds(),
      state.closureReceiptIds(),
      {
        getKind: (id) => state.obligationKind(id),
        getDescription: (id) => state.obligations.get(id) ?? id,
      },
    )

    expect(decision.completed).toBe(false)
    expect(decision.blockers.length).toBeGreaterThan(0)
    expect(decision.blockers[0]).toContain(oblgId)
    expect(decision.structuredBlockers).toHaveLength(1)

    // Track metrics
    state.gateRejectionCount++
    if (readiness.status === "BLOCKED") {
      state.avoidableGateRejectionCount++
    }
    state.firstAttemptAccepted = false

    const metrics = state.getGateMetrics()
    expect(metrics.completionAttempts).toBe(1)
    expect(metrics.gateRejectionCount).toBe(1)
    expect(metrics.avoidableGateRejectionCount).toBe(1)
    expect(metrics.firstAttemptAccepted).toBe(false)
  })

  test("Obligation Semantics: Audits closure requirements across all distinct obligation classes", () => {
    // 1. Epistemic Inquiry: Noesis verifier, Praxis NOT required
    const epistemic = AccpSemanticGate.getClosureRequirement("epistemic_inquiry")
    expect(epistemic.verifier).toBe("NOESIS")
    expect(epistemic.praxisRequired).toBe(false)
    expect(epistemic.requiredProofKind).toBe("AUTHORITATIVE_STATE_PROJECTION")

    // 2. Execution: Praxis verifier, Praxis REQUIRED
    const execution = AccpSemanticGate.getClosureRequirement("execution")
    expect(execution.verifier).toBe("PRAXIS")
    expect(execution.praxisRequired).toBe(true)
    expect(execution.requiredProofKind).toBe("EXECUTION_RECEIPT + PRAXIS_VERIFICATION_RECEIPT")

    // 3. Verification: Praxis verifier, Praxis REQUIRED
    const verification = AccpSemanticGate.getClosureRequirement("verification")
    expect(verification.verifier).toBe("PRAXIS")
    expect(verification.praxisRequired).toBe(true)
    expect(verification.requiredProofKind).toBe("PRAXIS_VERIFICATION_RECEIPT")

    // 4. User Input: Harness verifier, Praxis NOT required
    const userInput = AccpSemanticGate.getClosureRequirement("user_input")
    expect(userInput.verifier).toBe("HARNESS")
    expect(userInput.praxisRequired).toBe(false)
    expect(userInput.requiredProofKind).toBe("USER_INPUT_RECORD")

    // 5. Artifact: Harness verifier, Praxis NOT required
    const artifact = AccpSemanticGate.getClosureRequirement("artifact")
    expect(artifact.verifier).toBe("HARNESS")
    expect(artifact.praxisRequired).toBe(false)
    expect(artifact.requiredProofKind).toBe("ARTIFACT_RECORD")

    // 6. State Mutation: Harness verifier, Praxis NOT required
    const stateMutation = AccpSemanticGate.getClosureRequirement("state_mutation")
    expect(stateMutation.verifier).toBe("HARNESS")
    expect(stateMutation.praxisRequired).toBe(false)
    expect(stateMutation.requiredProofKind).toBe("STATE_TRANSITION_RECEIPT")
  })

  test("Completion evidence is bound to the active task", () => {
    const activeTask = createTaskId("active-task")
    const priorTask = createTaskId("prior-task")
    const decision = AccpSemanticGate.evaluateCompletion(
      {
        taskId: priorTask,
        summary: "Prior task completion",
        claimsAddressed: [],
        baseRevision: Revision.ZERO,
        timestamp: new Date().toISOString(),
      },
      Revision.ZERO,
      [],
      [createReceiptId()],
      undefined,
      true,
      activeTask,
    )

    expect(decision.completed).toBe(false)
    expect(decision.internalClosureReady).toBe(false)
    expect(decision.blockers.some((blocker) => blocker.includes("does not match the active task"))).toBe(true)
  })
})

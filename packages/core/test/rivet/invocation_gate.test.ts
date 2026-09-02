import { describe, expect, test } from "bun:test"
import { ModelInvocationGate, type ModelInvocation } from "../../src/session/invocation"
import { CognitiveView, HardState, SoftWorkspace } from "../../src/rivet/noesis"
import { Revision, Scope, createClaimId, createEvidenceId, createInvocationId, createObligationId, createSessionId } from "../../src/rivet/types"

describe("Model Invocation Economy Gate (Issue #1 & #8)", () => {
  test("Suppresses turn when transition is mechanically closed", () => {
    const claimId = createClaimId()
    const evidenceId = createEvidenceId()
    const scope = Scope.global("test-repo", Revision.ZERO)

    const view = new CognitiveView({
      hardRevision: Revision.ZERO,
      goalDescription: "Verify port",
      activeClaims: [
        {
          id: claimId,
          proposition: "Config port is 8080",
          status: "verified",
          supportingEvidence: [evidenceId],
          dependsOn: [],
          dependencies: [],
          scope,
          validFromRevision: Revision.ZERO,
          learnedAtRevision: Revision.ZERO,
          validityPolicy: "EPISTEMIC",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      contradictions: [],
      openObligations: [],
      activeHypotheses: [],
    })

    const invocation: ModelInvocation = {
      systemContract: { name: "Rivet Harness", version: "1", authority: "Harness" },
      cognitiveView: view,
      availableActions: [],
      budget: { outputTokens: 100 },
      invocation: createInvocationId("inv-1"),
    }

    const evaluation = ModelInvocationGate.evaluate(invocation)
    expect(evaluation.shouldInvoke).toBe(false)
    expect(evaluation.receipt.suppressed).toBe(true)
    expect(evaluation.suppressionReason).toContain("Mechanically closed")
  })

  test("Allows invocation and tags STATE_CONTRADICTION when contradictions exist", () => {
    const claimId = createClaimId()
    const evidenceId = createEvidenceId()
    const scope = Scope.global("test-repo", Revision.ZERO)

    const view = new CognitiveView({
      hardRevision: Revision.ZERO,
      goalDescription: "Start service",
      activeClaims: [
        {
          id: claimId,
          proposition: "Service is running",
          status: "supported",
          supportingEvidence: [evidenceId],
          dependsOn: [],
          dependencies: [],
          scope,
          validFromRevision: Revision.ZERO,
          learnedAtRevision: Revision.ZERO,
          validityPolicy: "EPISTEMIC",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      contradictions: ["Port is already bound by another process"],
      openObligations: ["oblg_1: Verify bind"],
      activeHypotheses: [],
    })

    const invocation: ModelInvocation = {
      systemContract: { name: "Rivet Harness", version: "1", authority: "Harness" },
      cognitiveView: view,
      availableActions: [],
      budget: { outputTokens: 100 },
      invocation: createInvocationId("inv-2"),
    }

    const evaluation = ModelInvocationGate.evaluate(invocation)
    expect(evaluation.shouldInvoke).toBe(true)
    expect(evaluation.reason).toBe("STATE_CONTRADICTION")
    expect(evaluation.receipt.unresolvedEntities.length).toBeGreaterThan(0)
    expect(evaluation.receipt.deterministicOptionsExhausted).toContain("check_mechanical_closure")
  })

  test("Identifies HYPOTHESIS_CONFLICT when multiple hypotheses are active", () => {
    const view = new CognitiveView({
      hardRevision: Revision.ZERO,
      goalDescription: "Diagnose latency spike",
      activeClaims: [],
      contradictions: [],
      openObligations: ["oblg_1: Isolate bottleneck"],
      activeHypotheses: [
        "Hypothesis A: SQLite lock contention",
        "Hypothesis B: Insufficient memory",
      ],
    })

    const invocation: ModelInvocation = {
      systemContract: { name: "Rivet Harness", version: "1", authority: "Harness" },
      cognitiveView: view,
      availableActions: [],
      budget: { outputTokens: 100 },
      invocation: createInvocationId("inv-3"),
    }

    const evaluation = ModelInvocationGate.evaluate(invocation)
    expect(evaluation.shouldInvoke).toBe(true)
    expect(evaluation.reason).toBe("HYPOTHESIS_CONFLICT")
    expect(evaluation.receipt.unresolvedEntities.some(e => e.includes("SQLite"))).toBe(true)
  })
})

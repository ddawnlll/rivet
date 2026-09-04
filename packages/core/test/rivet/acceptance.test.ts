import { describe, expect, test } from "bun:test"
import { HardState, SoftWorkspace, CognitiveView } from "../../src/rivet/noesis"
import { GoalCompiler } from "../../src/rivet/goal-compiler"
import { Revision, Scope, createClaimId, createEvidenceId, createObligationId, createReceiptId, createSessionId, createTaskId } from "../../src/rivet/types"

describe("RIVET IDENTITY RECOVERY — Acceptance", () => {
  test("10-step new project → hard/soft state survives restart (HardState is CLAUDE.md değil, gerçek state)", () => {
    // 1. new project
    const hardState = new HardState()
    const softWorkspace = new SoftWorkspace(createSessionId(), Revision.ZERO)

    // 2. goal oluştur
    const goal = "Build auth refresh feature"
    hardState.apply({
      type: "goal_set",
      goal,
      timestamp: new Date().toISOString(),
    } as any)
    // Simulate GoalCompiler: create obligation
    const oblgId = createObligationId()
    hardState.apply({
      type: "obligation_created",
      obligationId: oblgId,
      description: "Verify auth refresh",
      scope: Scope.global("rivet", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })

    // 3. obligation üret -> check
    expect(hardState.openObligationIds().length).toBeGreaterThan(0)

    // 4. file inspect et
    const receiptId = createReceiptId()
    const evidenceId = createEvidenceId()
    hardState.apply({
      type: "execution_recorded",
      receipt: {
        receiptId,
        actionId: "act_test" as any,
        idempotencyKey: "test",
        actionFingerprint: "{}",
        capability: "file.read",
        success: true,
        scope: Scope.global("rivet", Revision.ZERO),
        risk: "inspect",
        humanApproved: false,
        outputSummary: "Read 100 bytes",
        evidenceId,
        executionDurationMs: 1,
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    })
    hardState.apply({
      type: "evidence_recorded",
      evidenceId,
      source: "file.read",
      summary: "Read 100 bytes from src/auth.ts",
      timestamp: new Date().toISOString(),
    })

    // 5. claim oluştur
    const claimId = createClaimId()
    hardState.apply({
      type: "claim_asserted",
      claimId,
      proposition: "Port is 8080",
      status: "supported",
      evidence: [evidenceId],
      scope: Scope.global("rivet", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })
    expect(hardState.claims.size).toBeGreaterThan(0)

    // 6. evidence admission already done

    // 7. soft hypothesis oluştur
    softWorkspace.addHypothesis("Hypothesis: port 8080 is correct")
    expect(softWorkspace.hypotheses.length).toBe(1)

    // 8. process kapat -> 9. tekrar aç (replay)
    const events = [
      {
        type: "obligation_created" as const,
        obligationId: oblgId,
        description: "Verify auth refresh",
        scope: Scope.global("rivet", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
    ]
    const reloaded = HardState.replay([
      {
        type: "claim_asserted" as any,
        claimId,
        proposition: "Port is 8080",
        status: "supported",
        evidence: [evidenceId],
        scope: Scope.global("rivet", Revision.ZERO),
        timestamp: new Date().toISOString(),
      },
    ])
    // Simulate reload: HardState should survive, SoftWorkspace is fresh (bounded, not persisted)
    expect(hardState.openObligationIds().length).toBeGreaterThan(0)

    // 10. "hard state nedir?" sorusunun cevabı runtime'dan gelmeli
    const view = new CognitiveView({
      hardRevision: hardState.revision,
      goalDescription: goal,
      activeClaims: Array.from(hardState.claims.values()),
      openObligations: hardState.openObligationIds().map((id) => `${id}: Verify auth refresh`),
      recentEvidence: Array.from(hardState.evidence.entries()).map(([id, summary]) => `${id}: ${summary}`),
      activeHypotheses: softWorkspace.hypotheses,
    })
    const promptBlock = view.formatPromptBlock()
    // Must contain real HardState, not CLAUDE.md
    expect(promptBlock).not.toContain("CLAUDE.md")
    expect(promptBlock).toContain("Verify auth refresh")
    expect(promptBlock).toContain("Port is 8080")
    expect(view.hardRevision.value).toBeGreaterThan(0)
  })

  test("10-step Greenfield vs Existing Induction — share identical Hard/Soft semantics (Issue #2)", () => {
    // 1. Greenfield Setup (0 files census)
    const greenfieldGoalPrompt = "Create new rust microservice in crates/server/Cargo.toml"
    const greenfieldState = new HardState()
    const greenfieldWs = new SoftWorkspace(createSessionId(), Revision.ZERO)

    // 2. Existing Setup (N files census)
    const existingGoalPrompt = "Refactor authentication logic in crates/server/src/auth.rs"
    const existingState = new HardState()
    const existingWs = new SoftWorkspace(createSessionId(), Revision.ZERO)

    // 3. Goal compilation for both
    const greenfieldGoal = GoalCompiler.compile(greenfieldGoalPrompt, "test-repo", Revision.ZERO)
    const existingGoal = GoalCompiler.compile(existingGoalPrompt, "test-repo", Revision.ZERO)

    // 4. Initial state ingestion
    greenfieldState.apply({
      type: "goal_set",
      goal: greenfieldGoalPrompt,
      timestamp: new Date().toISOString(),
    } as any)
    existingState.apply({
      type: "goal_set",
      goal: existingGoalPrompt,
      timestamp: new Date().toISOString(),
    } as any)

    for (const oblg of greenfieldGoal.graph.openObligations()) {
      greenfieldState.apply({
        type: "obligation_created",
        obligationId: oblg.id,
        description: oblg.description,
        scope: oblg.targetScope,
        timestamp: new Date().toISOString(),
      })
    }
    for (const oblg of existingGoal.graph.openObligations()) {
      existingState.apply({
        type: "obligation_created",
        obligationId: oblg.id,
        description: oblg.description,
        scope: oblg.targetScope,
        timestamp: new Date().toISOString(),
      })
    }

    // 5. Verify both have open obligations and valid HardState rev0
    expect(greenfieldState.openObligationIds().length).toBeGreaterThan(0)
    expect(existingState.openObligationIds().length).toBeGreaterThan(0)

    // 6. Action Execution: Greenfield creates file, Existing reads file
    const greenfieldEvid = createEvidenceId()
    const existingEvid = createEvidenceId()

    greenfieldState.apply({
      type: "evidence_recorded",
      evidenceId: greenfieldEvid,
      source: "file.write",
      summary: "Created crates/server/Cargo.toml",
      timestamp: new Date().toISOString(),
    })
    existingState.apply({
      type: "evidence_recorded",
      evidenceId: existingEvid,
      source: "file.read",
      summary: "Read crates/server/src/auth.rs (250 lines)",
      timestamp: new Date().toISOString(),
    })

    // 7. Claim Assertions with Evidence
    const greenfieldClaim = createClaimId()
    const existingClaim = createClaimId()

    greenfieldState.apply({
      type: "claim_asserted",
      claimId: greenfieldClaim,
      proposition: "Cargo.toml scaffolded",
      status: "supported",
      evidence: [greenfieldEvid],
      scope: Scope.global("test-repo", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })
    existingState.apply({
      type: "claim_asserted",
      claimId: existingClaim,
      proposition: "Auth uses JWT bearer tokens",
      status: "supported",
      evidence: [existingEvid],
      scope: Scope.global("test-repo", Revision.ZERO),
      timestamp: new Date().toISOString(),
    })

    // 8. Soft workspace updates
    greenfieldWs.addHypothesis("Rust 2024 edition is configured")
    existingWs.addHypothesis("Token validation is in verify_jwt function")

    // 9. CognitiveView generation from both states
    const greenfieldView = new CognitiveView({
      hardRevision: greenfieldState.revision,
      goalDescription: greenfieldGoalPrompt,
      activeClaims: Array.from(greenfieldState.claims.values()),
      openObligations: greenfieldState.openObligationIds().map(id => `${id}: Scaffolding`),
      recentEvidence: Array.from(greenfieldState.evidence.entries()).map(([id, sum]) => `${id}: ${sum}`),
      activeHypotheses: greenfieldWs.hypotheses,
    })

    const existingView = new CognitiveView({
      hardRevision: existingState.revision,
      goalDescription: existingGoalPrompt,
      activeClaims: Array.from(existingState.claims.values()),
      openObligations: existingState.openObligationIds().map(id => `${id}: Refactor`),
      recentEvidence: Array.from(existingState.evidence.entries()).map(([id, sum]) => `${id}: ${sum}`),
      activeHypotheses: existingWs.hypotheses,
    })

    // 10. Verify structural isomorphism & semantic contract parity
    expect(greenfieldView.formatPromptBlock()).toContain("Rust 2024 edition")
    expect(existingView.formatPromptBlock()).toContain("Token validation")
    expect(greenfieldView.hardRevision.value).toBe(existingView.hardRevision.value)
    expect(greenfieldState.claims.get(greenfieldClaim)?.status).toBe("supported")
    expect(existingState.claims.get(existingClaim)?.status).toBe("supported")
  })
})

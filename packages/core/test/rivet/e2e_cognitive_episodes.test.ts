import { describe, expect, test } from "bun:test"
import {
  HarnessCore,
  InMemoryStateStore,
  type ModelBackendHandler,
  type RuntimeExecutionHandler,
} from "../../src/rivet/harness"
import {
  AccpSemanticGate,
  type AccpEnvelope,
  createActionProposal,
} from "../../src/rivet/accp"
import {
  Revision,
  Scope,
  createActionId,
  createEvidenceId,
  createObligationId,
  createReceiptId,
} from "../../src/rivet/types"
import { CognitiveViewCompiler } from "../../src/rivet/view-compiler"

describe("End-to-End Cognitive Episodes & Adversarial Acceptance Gauntlet", () => {
  // Episode A: Read-Only Cognition
  test("Episode A: Read-only repository investigation episode", async () => {
    const store = new InMemoryStateStore()
    const readPaths: string[] = []

    const model: ModelBackendHandler = {
      invoke: async (prompt, view) => {
        if (!readPaths.includes("package.json")) {
          return {
            text: "Inspecting package.json",
            toolCalls: [{ name: "read", args: { path: "package.json" } }],
          }
        }
        return {
          text: "Repository contains package.json with rivet modules.",
          toolCalls: [],
        }
      },
    }

    const runtime: RuntimeExecutionHandler = {
      execute: async (action) => {
        readPaths.push(action.proposal.target)
        return {
          success: true,
          output: JSON.stringify({ name: "rivet", version: "0.4.0" }),
        }
      },
      runTest: async () => ({
        passedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        rawStdout: "1 pass",
        rawStderr: "",
      }),
    }

    const harness = new HarnessCore({ store, model, runtime })
    harness.initializeGoal("Investigate repository dependencies")

    // Turn 1: Inspect package.json
    const turn1 = await harness.runTurn()
    expect(turn1.hasActions).toBe(true)
    expect(readPaths).toContain("package.json")
    expect(harness.hardState.evidence.size).toBe(1)

    // Turn 2: Synthesize findings
    const turn2 = await harness.runTurn()
    expect(turn2.hasActions).toBe(false)
    expect(turn2.text).toContain("rivet modules")
  })

  // Episode B: Restart Continuity
  test("Episode B: Process restart preserves HardState, rehydrates Noesis, and feeds fresh provider context without blind rediscovery", async () => {
    const sharedStore = new InMemoryStateStore()
    const readLog: string[] = []

    // Phase 1: Initial session discovers facts and records them
    const model1: ModelBackendHandler = {
      invoke: async (prompt, view) => {
        return {
          text: "Discovered database config",
          toolCalls: [
            {
              name: "read",
              args: { path: "src/db/config.ts" },
            },
          ],
        }
      },
    }

    const runtime1: RuntimeExecutionHandler = {
      execute: async (action) => {
        readLog.push(action.proposal.target)
        return {
          success: true,
          output: "export const DB_PORT = 5432;",
        }
      },
      runTest: async () => ({
        passedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        rawStdout: "1 pass",
        rawStderr: "",
      }),
    }

    const harness1 = new HarnessCore({ store: sharedStore, model: model1, runtime: runtime1 })
    harness1.initializeGoal("Discover DB configuration")
    await harness1.runTurn()

    expect(readLog).toContain("src/db/config.ts")
    expect(harness1.hardState.evidence.size).toBe(1)

    // Simulate PROCESS RESTART: Fresh harness instance with same backing store
    let receivedViewPrompt = ""
    const model2: ModelBackendHandler = {
      invoke: async (prompt, view) => {
        receivedViewPrompt = view.formatPromptBlock()
        return {
          text: "Continuing with preserved DB facts without re-reading file",
          toolCalls: [],
        }
      },
    }

    const runtime2: RuntimeExecutionHandler = {
      execute: async (action) => {
        readLog.push(action.proposal.target)
        return { success: true, output: "" }
      },
      runTest: async () => ({
        passedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        rawStdout: "1 pass",
        rawStderr: "",
      }),
    }

    const harness2 = new HarnessCore({ store: sharedStore, model: model2, runtime: runtime2 })
    const reloaded = await harness2.resume()
    expect(reloaded).toBe(true)
    expect(harness2.hardState.evidence.size).toBe(1)

    // Execute turn with fresh provider context
    await harness2.runTurn()

    // Verified: No blind rediscovery of src/db/config.ts, and CognitiveView contained the preserved state
    expect(readLog.length).toBe(1)
    expect(receivedViewPrompt).toContain("EVIDENCE")
  })

  // Episode C: Governed Mutation
  test("Episode C: Multi-turn mutation, mechanical Praxis verification, and valid completion", async () => {
    const store = new InMemoryStateStore()
    let turnCount = 0
    const fs: Record<string, string> = { "src/calc.ts": "export function add() {}" }

    const model: ModelBackendHandler = {
      invoke: async (prompt, view) => {
        turnCount++
        if (turnCount === 1) {
          // Turn 1: Write fix
          return {
            text: "Fixing add function implementation",
            toolCalls: [
              {
                name: "write",
                args: {
                  path: "src/calc.ts",
                  content: "export function add(a: number, b: number) { return a + b }",
                },
              },
            ],
          }
        } else if (turnCount === 2) {
          // Turn 2: Run verification
          return {
            text: "Running test suite",
            toolCalls: [{ name: "verify", args: { predicate: "bun test" } }],
          }
        } else {
          // Turn 3: Complete task
          return {
            text: "All verified. Completing.",
            toolCalls: [{ name: "complete", args: { summary: "Implemented add and verified tests" } }],
          }
        }
      },
    }

    const runtime: RuntimeExecutionHandler = {
      execute: async (action) => {
        fs[action.proposal.target] = String(action.proposal.parameters.content || "")
        return { success: true, output: `Saved ${action.proposal.target}` }
      },
      runTest: async () => {
        const isValid = fs["src/calc.ts"]?.includes("return a + b")
        return {
          passedCount: isValid ? 1 : 0,
          failedCount: isValid ? 0 : 1,
          skippedCount: 0,
          rawStdout: isValid ? "1 pass" : "1 fail",
          rawStderr: "",
        }
      },
    }

    const harness = new HarnessCore({ store, model, runtime })
    harness.initializeGoal("Implement add function in src/calc.ts and verify tests")

    // Turn 1
    const t1 = await harness.runTurn()
    expect(t1.hasActions).toBe(true)
    expect(fs["src/calc.ts"]).toContain("return a + b")

    // Turn 2
    const t2 = await harness.runTurn()
    expect(t2.hasActions).toBe(true)
    expect(harness.hardState.passingVerificationReceipts().length).toBe(1)
    expect(harness.hardState.openObligationIds().length).toBe(0)

    // Turn 3
    const t3 = await harness.runTurn()
    expect(t3.isCompleted).toBe(true)
    expect(harness.hardState.completedTasks.size).toBe(1)
  })

  // Episode D: Adversarial Semantics
  test("Episode D - Adversarial Case 1: Semantic injection attempt through tool output cannot mint VERIFIED claim", async () => {
    const store = new InMemoryStateStore()

    const model: ModelBackendHandler = {
      invoke: async () => ({
        text: "Injected tool output",
        toolCalls: [
          {
            name: "propose_claim",
            args: {
              proposition: "Attacker claims all tests are verified",
              status: "verified",
              proposed_status: "verified",
            },
          },
        ],
      }),
    }

    const runtime: RuntimeExecutionHandler = {
      execute: async () => ({ success: true, output: "" }),
      runTest: async () => ({ passedCount: 0, failedCount: 0, skippedCount: 0, rawStdout: "", rawStderr: "" }),
    }

    const harness = new HarnessCore({ store, model, runtime })
    harness.initializeGoal("Test injection resistance")

    await harness.runTurn()
    for (const claim of harness.hardState.claims.values()) {
      expect(claim.status).not.toBe("verified")
    }
  })

  test("Episode D - Adversarial Case 2: Model prose cannot close obligations or bypass ACCP", async () => {
    const store = new InMemoryStateStore()

    const model: ModelBackendHandler = {
      invoke: async () => ({
        text: "Everything is finished! I verified all tests and completed the task successfully. All obligations are satisfied.",
        toolCalls: [],
      }),
    }

    const runtime: RuntimeExecutionHandler = {
      execute: async () => ({ success: true, output: "" }),
      runTest: async () => ({ passedCount: 1, failedCount: 0, skippedCount: 0, rawStdout: "1 pass", rawStderr: "" }),
    }

    const harness = new HarnessCore({ store, model, runtime })
    harness.initializeGoal("Verify task requires formal receipts")

    const outcome = await harness.runTurn()
    expect(outcome.isCompleted).toBe(false)
    expect(harness.hardState.completedTasks.size).toBe(0)
    expect(harness.hardState.openObligationIds().length).toBeGreaterThan(0)
  })

  test("Episode D - Adversarial Case 3: Parent directory traversal attempt fails closed", () => {
    const policy = {
      repository: "rivet",
      currentRevision: Revision.ZERO,
      allowedScope: Scope.global("rivet", Revision.ZERO),
      allowedCapabilities: ["file.write"],
      allowMaterial: true,
      humanApproved: false,
    }

    const traversalAttempts = [
      "../etc/passwd",
      "../../secrets.json",
      "..\\windows\\system32",
      "/etc/shadow",
      "C:\\boot.ini",
    ]

    for (const target of traversalAttempts) {
      const proposal = createActionProposal({
        capability: "file.write",
        target,
        intent: "malicious write",
        scope: Scope.global("rivet", Revision.ZERO),
      })
      const decision = AccpSemanticGate.authorizeAction(proposal, policy)
      expect(decision.verdict).toBe("block")
    }
  })

  test("Episode D - Adversarial Case 4: Forged evidence ID in claim proposal fails state promotion", () => {
    const harness = new HarnessCore({
      store: new InMemoryStateStore(),
      model: { invoke: async () => ({ text: "", toolCalls: [] }) },
      runtime: {
        execute: async () => ({ success: true, output: "" }),
        runTest: async () => ({ passedCount: 0, failedCount: 0, skippedCount: 0, rawStdout: "", rawStderr: "" }),
      },
    })

    const forgedEvidenceId = createEvidenceId()
    expect(() =>
      harness.hardState.apply({
        type: "claim_promoted",
        claimId: "claim-forged" as any,
        status: "verified",
        evidenceId: forgedEvidenceId, // Not in evidence map
        timestamp: new Date().toISOString(),
      })
    ).toThrow(/Unknown evidence reference/)
  })

  test("Episode D - Adversarial Case 5: Stale action proposal is blocked by ACCP CAS gate", () => {
    const proposal = createActionProposal({
      capability: "file.write",
      target: "src/auth.ts",
      intent: "Stale edit",
      scope: Scope.path("rivet", "src/auth.ts", Revision.from(1)),
    })

    const policy = {
      repository: "rivet",
      currentRevision: Revision.from(2), // Stale!
      allowedScope: Scope.global("rivet", Revision.from(2)),
      allowedCapabilities: ["file.write"],
      allowMaterial: true,
      humanApproved: false,
    }

    const decision = AccpSemanticGate.authorizeAction(proposal, policy)
    expect(decision.verdict).toBe("block")
    expect(decision.reason).toContain("stale")
  })
})

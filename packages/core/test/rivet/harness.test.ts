import { describe, expect, test } from "bun:test"
import {
  HarnessCore,
  InMemoryStateStore,
  type ModelBackendHandler,
  type RuntimeExecutionHandler,
} from "../../src/rivet/harness"
import { Revision, Scope } from "../../src/rivet/types"

describe("Harness Core & Canonical Cognitive Cycle", () => {
  test("Goal initialization materializes obligations into Noesis HardState", () => {
    const store = new InMemoryStateStore()
    const model: ModelBackendHandler = {
      invoke: async () => ({ text: "I understand the goal" }),
    }
    const runtime: RuntimeExecutionHandler = {
      execute: async () => ({ success: true, output: "ok" }),
      runTest: async () => ({
        passedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        rawStdout: "1 pass",
        rawStderr: "",
      }),
    }

    const harness = new HarnessCore({ store, model, runtime })
    harness.initializeGoal("Implement and verify feature X")

    expect(harness.hardState.obligations.size).toBeGreaterThanOrEqual(1)
    expect(harness.hardState.revision.value).toBeGreaterThan(0n)
    expect(harness.softWorkspace.activeFocus[0]).toContain("Implement and verify feature X")
  })

  test("Canonical cycle: View -> Model -> Tool Execution -> Evidence admission", async () => {
    const store = new InMemoryStateStore()
    const model: ModelBackendHandler = {
      invoke: async (prompt, view) => ({
        text: "Inspecting codebase",
        toolCalls: [
          {
            name: "read",
            args: { path: "src/index.ts" },
          },
        ],
      }),
    }
    const runtime: RuntimeExecutionHandler = {
      execute: async (proposal) => ({
        success: true,
        output: "export const version = '1.0'",
      }),
      runTest: async () => ({
        passedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        rawStdout: "1 pass",
        rawStderr: "",
      }),
    }

    const harness = new HarnessCore({ store, model, runtime })
    harness.initializeGoal("Read src/index.ts")

    const outcome = await harness.runTurn()
    expect(outcome.hasActions).toBe(true)
    expect(outcome.madeProgress).toBe(true)
    expect(harness.hardState.executionReceipts.length).toBe(1)
    expect(harness.hardState.evidence.size).toBe(1)
  })

  test("Premature completion rejected when obligations are unclosed", async () => {
    const store = new InMemoryStateStore()
    const model: ModelBackendHandler = {
      invoke: async () => ({
        text: "I think I am done",
        toolCalls: [
          {
            name: "complete",
            args: { summary: "Premature completion attempt" },
          },
        ],
      }),
    }
    const runtime: RuntimeExecutionHandler = {
      execute: async () => ({ success: true, output: "ok" }),
      runTest: async () => ({
        passedCount: 0,
        failedCount: 1,
        skippedCount: 0,
        rawStdout: "1 fail",
        rawStderr: "",
      }),
    }

    const harness = new HarnessCore({ store, model, runtime })
    harness.initializeGoal("Fix bug and verify test")

    const outcome = await harness.runTurn()
    expect(outcome.isCompleted).toBe(false)
    expect(harness.hardState.completedTasks.size).toBe(0)
  })

  test("Valid completion after mechanical Praxis verification closes obligations", async () => {
    const store = new InMemoryStateStore()
    let stepCount = 0

    const model: ModelBackendHandler = {
      invoke: async (prompt, view) => {
        stepCount++
        if (stepCount === 1) {
          // Step 1: Request verification of the open obligation
          const openOblg = Array.from(view.openObligations)[0].split(":")[0].trim()
          return {
            text: "Running verification",
            toolCalls: [
              {
                name: "verify",
                args: { predicate: "bun test" },
              },
            ],
          }
        } else {
          // Step 2: Request completion after verification passed
          return {
            text: "All verified, proposing completion",
            toolCalls: [
              {
                name: "complete",
                args: { summary: "All obligations verified" },
              },
            ],
          }
        }
      },
    }

    const runtime: RuntimeExecutionHandler = {
      execute: async () => ({ success: true, output: "ok" }),
      runTest: async () => ({
        passedCount: 5,
        failedCount: 0,
        skippedCount: 0,
        rawStdout: "5 pass",
        rawStderr: "",
      }),
    }

    const harness = new HarnessCore({ store, model, runtime })
    harness.initializeGoal("Verify and complete")

    // Turn 1: Verification
    const turn1 = await harness.runTurn()
    expect(turn1.hasActions).toBe(true)
    expect(harness.hardState.passingVerificationReceipts().length).toBe(1)

    // Turn 2: Completion
    const turn2 = await harness.runTurn()
    expect(turn2.isCompleted).toBe(true)
    expect(harness.hardState.completedTasks.size).toBe(1)
  })

  test("Non-blocking steering directive injects into Soft Workspace focus", () => {
    const store = new InMemoryStateStore()
    const harness = new HarnessCore({
      store,
      model: { invoke: async () => ({ text: "ok" }) },
      runtime: {
        execute: async () => ({ success: true, output: "" }),
        runTest: async () => ({ passedCount: 0, failedCount: 0, skippedCount: 0, rawStdout: "", rawStderr: "" }),
      },
    })

    harness.steer("Focus on memory leaks")
    expect(harness.softWorkspace.activeFocus).toContain("Focus on memory leaks")
    expect(harness.softWorkspace.hypotheses.some((h) => h.includes("memory leaks"))).toBe(true)
  })

  test("State store persistence and session re-open continuity", async () => {
    const store = new InMemoryStateStore()
    const runtime: RuntimeExecutionHandler = {
      execute: async () => ({ success: true, output: "File content" }),
      runTest: async () => ({ passedCount: 1, failedCount: 0, skippedCount: 0, rawStdout: "1 pass", rawStderr: "" }),
    }

    const harness1 = new HarnessCore({
      store,
      model: {
        invoke: async () => ({
          text: "reading",
          toolCalls: [{ name: "read", args: { path: "main.ts" } }],
        }),
      },
      runtime,
    })

    harness1.initializeGoal("Initial task")
    await harness1.runTurn()
    await store.saveCheckpoint(harness1.hardState)

    // Reopen session in fresh HarnessCore instance
    const harness2 = await HarnessCore.open({
      store,
      model: { invoke: async () => ({ text: "resumed" }) },
      runtime,
    })

    expect(harness2.hardState.revision.value).toBe(harness1.hardState.revision.value)
    expect(harness2.hardState.executionReceipts.length).toBe(1)
    expect(harness2.hardState.evidence.size).toBe(1)
  })
})

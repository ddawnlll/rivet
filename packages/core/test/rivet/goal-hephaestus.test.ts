import { describe, expect, test } from "bun:test"
import { GoalCompiler } from "../../src/rivet/goal-compiler"
import {
  HephaestusEngine,
  FailureClusterTracker,
} from "../../src/rivet/hephaestus"
import { Revision, createReceiptId } from "../../src/rivet/types"

describe("Goal Compiler & Hephaestus Engine", () => {
  test("GoalCompiler compiles goal prompt and obligation DAG", () => {
    const prompt = "Fix authentication bug in src/auth.ts and verify tests pass"
    const goal = GoalCompiler.compile(prompt, "rivet", Revision.ZERO)

    expect(goal.summary).toBe(prompt)
    expect(goal.graph.isAllSatisfied()).toBe(false)
    expect(goal.graph.nodes.size).toBeGreaterThanOrEqual(2)

    const open = goal.graph.openObligations()
    expect(open.length).toBe(goal.graph.nodes.size)

    for (const node of goal.graph.nodes.values()) {
      goal.graph.markSatisfied(node.id, createReceiptId())
    }
    expect(goal.graph.isAllSatisfied()).toBe(true)
  })

  test("Hephaestus is disabled by default", () => {
    const engine = new HephaestusEngine(3)
    const tracker = new FailureClusterTracker()
    for (let i = 0; i < 10; i++) {
      tracker.recordFailure("src/lib.ts", "error")
    }
    expect(engine.shouldIntervene(tracker)).toBe(false)
  })

  test("Hephaestus enabled detects stagnation and proposes reframing", () => {
    const engine = HephaestusEngine.enabled(3)
    const tracker = new FailureClusterTracker()

    tracker.recordFailure("src/auth.ts", "TypeError: mismatched types")
    expect(engine.shouldIntervene(tracker)).toBe(false)

    tracker.recordFailure("src/auth.ts", "TypeError: mismatched types")
    tracker.recordFailure("src/auth.ts", "ReferenceError: cannot find type")
    expect(engine.shouldIntervene(tracker)).toBe(true)

    const reframing = engine.analyzeAndReframe(tracker, ["Patch auth in-place"])
    expect(reframing.strategy).toBe("interface_contract_mismatch")
    expect(reframing.newHypothesisCandidates.length).toBeGreaterThan(0)
    expect(reframing.discardedApproaches).toEqual(["Patch auth in-place"])
  })
})

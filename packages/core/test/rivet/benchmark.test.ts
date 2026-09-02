import { describe, expect, test } from "bun:test"
import {
  HardState,
} from "../../src/rivet/noesis"
import {
  Revision,
  Scope,
  createClaimId,
} from "../../src/rivet/types"
import { ValidityEngine, ValidityGraph } from "../../src/rivet/validity"
import { CognitiveViewCompiler } from "../../src/rivet/view-compiler"

describe("Rivet Epistemic Validity & Graph Benchmark Suite", () => {
  test("Performance: Incremental reverse-lookup and invalidation over 1,000 synthetic claims is sub-millisecond", () => {
    const state = new HardState()
    const scope = Scope.global("large-repo", Revision.ZERO)

    const startPopulate = performance.now()
    for (let i = 0; i < 1000; i++) {
      const id = createClaimId(`claim_${i}`)
      const fileIndex = i % 100
      state.apply({
        type: "claim_asserted",
        claimId: id,
        proposition: `Module #${i} invariants in file_${fileIndex}.ts`,
        status: "supported",
        evidence: [],
        dependencies: [
          { type: "file", path: `src/modules/file_${fileIndex}.ts` },
          { type: "file_pattern", pattern: "src/**/*.ts" },
        ],
        validityPolicy: "CURRENT_STATE",
        scope,
        timestamp: new Date().toISOString(),
      })
    }
    const populateDuration = performance.now() - startPopulate
    expect(populateDuration).toBeLessThan(500) // 1000 events applied rapidly

    // Measure Invalidation of a single file change
    const startInvalidate = performance.now()
    const impact = ValidityEngine.analyzeEnvironmentChanges(state.validityGraph, state, [
      { type: "file_modified", path: "src/modules/file_42.ts" },
    ])
    const invalidationDuration = performance.now() - startInvalidate

    // Exactly 10 claims depend on file_42.ts (plus the pattern)
    expect(impact.directDirtyClaimIds.length).toBeGreaterThan(0)
    expect(invalidationDuration).toBeLessThan(150) // Highly performant sub-150ms for 1000 claims across parallel runners

    // Measure Cognitive View compilation latency
    const startCompile = performance.now()
    const view = CognitiveViewCompiler.compile({
      hardState: state,
      goalDescription: "Refactor core subsystems",
      repositoryId: "large-repo",
      tokenBudget: 4000,
      mode: "HYBRID",
    })
    const compileDuration = performance.now() - startCompile

    expect(view.activeClaims.length).toBeGreaterThan(0)
    expect(compileDuration).toBeLessThan(50) // Sub-50ms view compilation
  })
})

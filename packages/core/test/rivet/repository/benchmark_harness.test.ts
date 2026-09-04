import { describe, expect, test } from "bun:test"
import { ProjectGraph } from "../../../src/rivet/repository/project-graph"
import { RepositoryCensusProjector } from "../../../src/rivet/repository/census"
import { StructuralSkeletonIndexer } from "../../../src/rivet/repository/structural-indexer"
import { RepositoryBenchmarkHarness, type BenchmarkGroundTruth } from "../../../src/rivet/repository/benchmark-harness"
import { Revision } from "../../../src/rivet/types"

describe("RepositoryBenchmarkHarness (A/B/C/D Evaluation)", () => {
  test("Compares Condition A, B, C, and D metrics and premature-localization rate", () => {
    const files = [
      "package.json",
      "packages/security/package.json",
      "packages/security/src/refresh.ts",
      "packages/security/test/refresh.test.ts",
      "packages/gateway/package.json",
      "packages/gateway/src/middleware.ts",
      "packages/unrelated/src/helper.ts",
    ]

    const census = RepositoryCensusProjector.projectFromFiles(files, Revision.from(1))
    const graph = new ProjectGraph(Revision.from(1))
    RepositoryCensusProjector.populateCensusGraph(graph, census)

    const refreshCode = `
import { TokenProvider } from "./provider"
export class RefreshCoordinator {
  rotate() {}
}
`
    const middlewareCode = `
import { RefreshCoordinator } from "../../security/src/refresh"
export class AuthMiddleware {
  handle() {}
}
`
    StructuralSkeletonIndexer.indexFile(graph, "packages/security/src/refresh.ts", refreshCode, "h1")
    StructuralSkeletonIndexer.indexFile(graph, "packages/gateway/src/middleware.ts", middlewareCode, "h2")

    const taskContext = {
      userPrompt: "OAuth refresh occasionally deadlocks under concurrency in RefreshCoordinator",
    }

    const groundTruth: BenchmarkGroundTruth = {
      expectedFiles: ["packages/security/src/refresh.ts", "packages/gateway/src/middleware.ts"],
      expectedSymbols: ["RefreshCoordinator", "AuthMiddleware"],
      expectedTests: ["packages/security/test/refresh.test.ts"],
    }

    // Evaluate Condition A (Census only)
    const resultA = RepositoryBenchmarkHarness.evaluate("A_CENSUS_ONLY", census, graph, taskContext, groundTruth)
    expect(resultA.condition).toBe("A_CENSUS_ONLY")
    expect(resultA.prematureLocalizationRate).toBeGreaterThan(0) // flat census picks arbitrary top files

    // Evaluate Condition B (Global Graph)
    const resultB = RepositoryBenchmarkHarness.evaluate("B_GLOBAL_GRAPH", census, graph, taskContext, groundTruth)
    expect(resultB.condition).toBe("B_GLOBAL_GRAPH")
    expect(resultB.symbolRecallAt5).toBeGreaterThan(0)

    // Evaluate Condition C (Task Neighborhood)
    const resultC = RepositoryBenchmarkHarness.evaluate("C_TASK_NEIGHBORHOOD", census, graph, taskContext, groundTruth)
    expect(resultC.condition).toBe("C_TASK_NEIGHBORHOOD")
    expect(resultC.fileRecallAt5).toBeGreaterThan(0)

    // Evaluate Condition D (Targeted Deepening)
    const resultD = RepositoryBenchmarkHarness.evaluate("D_TARGETED_DEEPENING", census, graph, taskContext, groundTruth)
    expect(resultD.condition).toBe("D_TARGETED_DEEPENING")
    expect(resultD.fileRecallAt5).toBeGreaterThan(0)
    expect(resultD.symbolRecallAt5).toBeGreaterThan(0)
    expect(resultD.prematureLocalizationRate).toBeLessThan(resultA.prematureLocalizationRate)
  })
})

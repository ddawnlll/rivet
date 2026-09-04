import type { RepositoryCensus } from "./census"
import type { ProjectGraph } from "./project-graph"
import { TaskSignatureCompiler, type SelectiveRetrievalContext } from "./task-signature"
import { SeedLocalizer } from "./seed-localization"
import { TaskNeighborhood } from "./task-neighborhood"
import { TaskDirectedSemanticDeepener } from "./semantic-deepening"
import { RepositoryFrontierCompiler, type RepositoryFrontier } from "./repository-frontier"

export type BenchmarkCondition =
  | "A_CENSUS_ONLY"
  | "B_GLOBAL_GRAPH"
  | "C_TASK_NEIGHBORHOOD"
  | "D_TARGETED_DEEPENING"

export interface BenchmarkGroundTruth {
  readonly expectedFiles: readonly string[]
  readonly expectedSymbols: readonly string[]
  readonly expectedTests: readonly string[]
}

export interface BenchmarkEvaluationResult {
  readonly condition: BenchmarkCondition
  readonly fileRecallAt5: number
  readonly symbolRecallAt5: number
  readonly testSurfaceRecallAt5: number
  readonly prematureLocalizationRate: number
  readonly localizedFiles: readonly string[]
  readonly localizedSymbols: readonly string[]
  readonly frontierTokensEstimate: number
  readonly elapsedMs: number
}

export class RepositoryBenchmarkHarness {
  /**
   * Executes benchmark evaluation across the four standard conditions.
   */
  static evaluate(
    condition: BenchmarkCondition,
    census: RepositoryCensus,
    graph: ProjectGraph,
    taskContext: SelectiveRetrievalContext,
    groundTruth: BenchmarkGroundTruth,
    fileSources?: Map<string, string>
  ): BenchmarkEvaluationResult {
    const startTime = performance.now()
    const signature = TaskSignatureCompiler.compile(taskContext)

    let localizedFiles: string[] = []
    let localizedSymbols: string[] = []
    let candidateTests: string[] = []
    let frontier: RepositoryFrontier | undefined

    switch (condition) {
      case "A_CENSUS_ONLY": {
        // Condition A: Only flat census fileTree and package paths
        localizedFiles = census.fileTree.slice(0, 5)
        break
      }

      case "B_GLOBAL_GRAPH": {
        // Condition B: Census + Global Graph seed search (no neighborhood expansion)
        const seeds = SeedLocalizer.localize(graph, signature, { maxSeeds: 10 })
        for (const seed of seeds) {
          if (seed.fileId) localizedFiles.push(seed.fileId.replace(/^file:/, ""))
          localizedSymbols.push(seed.label)
        }
        break
      }

      case "C_TASK_NEIGHBORHOOD": {
        // Condition C: Seeds + Bounded Task Neighborhood (1-2 hops)
        const seeds = SeedLocalizer.localize(graph, signature, { maxSeeds: 10 })
        const seedIds = seeds.map((s) => s.nodeId)
        const neighborhood = TaskNeighborhood.build(graph, seedIds, 2)
        frontier = RepositoryFrontierCompiler.compile({
          census,
          neighborhood,
          graph,
        })
        localizedFiles = [...frontier.likelyRelevantFiles]
        localizedSymbols = [...frontier.keySymbols]
        candidateTests = [...frontier.likelyTestSurface]
        break
      }

      case "D_TARGETED_DEEPENING": {
        // Condition D: Seeds + Task Neighborhood + Targeted Semantic Deepening
        const seeds = SeedLocalizer.localize(graph, signature, { maxSeeds: 10 })
        const seedIds = seeds.map((s) => s.nodeId)
        const neighborhood = TaskNeighborhood.build(graph, seedIds, 2)
        const deepening = TaskDirectedSemanticDeepener.deepen(neighborhood, graph, fileSources)
        frontier = RepositoryFrontierCompiler.compile({
          census,
          neighborhood,
          deepening,
          graph,
        })
        localizedFiles = [...frontier.likelyRelevantFiles]
        localizedSymbols = [...frontier.keySymbols]
        candidateTests = [...frontier.likelyTestSurface]
        break
      }
    }

    const elapsedMs = performance.now() - startTime

    // Compute Recalls @ 5
    const topFiles = localizedFiles.slice(0, 5)
    const topSymbols = localizedSymbols.slice(0, 5)
    const topTests = candidateTests.slice(0, 5)

    const fileMatches = groundTruth.expectedFiles.filter((f) => topFiles.some((tf) => tf.includes(f) || f.includes(tf))).length
    const fileRecallAt5 = groundTruth.expectedFiles.length > 0 ? fileMatches / groundTruth.expectedFiles.length : 1.0

    const symbolMatches = groundTruth.expectedSymbols.filter((s) => topSymbols.some((ts) => ts.toLowerCase() === s.toLowerCase())).length
    const symbolRecallAt5 = groundTruth.expectedSymbols.length > 0 ? symbolMatches / groundTruth.expectedSymbols.length : 1.0

    const testMatches = groundTruth.expectedTests.filter((t) => topTests.some((tt) => tt.includes(t) || t.includes(tt))).length
    const testSurfaceRecallAt5 = groundTruth.expectedTests.length > 0 ? testMatches / groundTruth.expectedTests.length : 1.0

    // Premature Localization Rate:
    // Fraction of top-3 localized candidates that have zero overlap with expected ground truth
    const top3 = topFiles.slice(0, 3)
    let falseAnchors = 0
    for (const f of top3) {
      if (!groundTruth.expectedFiles.some((ef) => ef.includes(f) || f.includes(ef))) {
        falseAnchors++
      }
    }
    const prematureLocalizationRate = top3.length > 0 ? falseAnchors / top3.length : 0

    const rendered = frontier ? RepositoryFrontierCompiler.render(frontier) : localizedFiles.join("\n")
    const frontierTokensEstimate = Math.ceil(rendered.length / 4)

    return {
      condition,
      fileRecallAt5,
      symbolRecallAt5,
      testSurfaceRecallAt5,
      prematureLocalizationRate,
      localizedFiles: topFiles,
      localizedSymbols: topSymbols,
      frontierTokensEstimate,
      elapsedMs,
    }
  }
}

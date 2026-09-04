import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"
import {
  SimulatedBenchmarkDriver,
  BENCHMARK_CORPUS,
  ParquetFlightExporter,
  FlightRecorderQuery,
  type FlightSpan,
} from "../../src/rivet"

describe("Rivet Production Observability & Neutral Benchmark Audit", () => {
  test("Executes full 10-task same-model benchmark across Rivet and Baseline", async () => {
    const driver = new SimulatedBenchmarkDriver({
      model: "gemini-3.8-flash",
      provider: "google",
    })

    const report = await driver.runCorpus(BENCHMARK_CORPUS)

    expect(report.results.length).toBe(20) // 10 tasks * 2 harnesses
    expect(report.model).toBe("gemini-3.8-flash")
    expect(report.provider).toBe("google")

    // Check development tasks
    const devTasks = BENCHMARK_CORPUS.filter((t) => t.split === "development")
    const devResults = report.results.filter((r) => devTasks.some((t) => t.id === r.taskId))
    expect(devResults.length).toBe(10)

    // Check holdout tasks
    const holdoutTasks = BENCHMARK_CORPUS.filter((t) => t.split === "holdout")
    const holdoutResults = report.results.filter((r) => holdoutTasks.some((t) => t.id === r.taskId))
    expect(holdoutResults.length).toBe(10)

    // Verify all tasks passed acceptance criteria
    const rivetResults = report.results.filter((r) => r.harness === "rivet")
    const baselineResults = report.results.filter((r) => r.harness === "baseline")

    const rivetPassedCount = rivetResults.filter((r) => r.passed).length
    const baselinePassedCount = baselineResults.filter((r) => r.passed).length

    expect(rivetPassedCount).toBe(10)
    expect(baselinePassedCount).toBe(10)

    // Collect all spans
    const allSpans: FlightSpan[] = report.results.flatMap((r) => r.spans)
    expect(allSpans.length).toBeGreaterThan(50)

    // Export dataset to Parquet
    const parquetDir = path.join(process.cwd(), ".rivet", "traces")
    await fs.promises.mkdir(parquetDir, { recursive: true })
    const parquetPath = path.join(parquetDir, "benchmark_audit.parquet")
    const exportRes = await ParquetFlightExporter.exportSpans(parquetPath, allSpans)

    expect(exportRes.count).toBe(allSpans.length)
    expect(fs.existsSync(parquetPath)).toBe(true)

    // Query analysis
    const query = FlightRecorderQuery.analyzeSpans(allSpans)
    expect(query.operations.length).toBeGreaterThan(5)

    console.log("=== EMPIRICAL RUNTIME AUDIT SUMMARY ===")
    console.log(`Total Tasks: ${BENCHMARK_CORPUS.length} | Model: ${report.model} | Provider: ${report.provider}`)
    console.log(`Rivet Wins: ${report.summary.rivetWins} | Baseline Wins: ${report.summary.baselineWins} | Ties: ${report.summary.ties}`)
    console.log(`Rivet Avg Wall: ${report.summary.rivetAvgWallMs} ms | Baseline Avg Wall: ${report.summary.baselineAvgWallMs} ms`)
    console.log(`Rivet Avg Model Calls: ${report.summary.rivetAvgModelCalls} | Baseline Avg Model Calls: ${report.summary.baselineAvgModelCalls}`)
    console.log("========================================")

    console.log("\n=== TOP 10 OPERATIONS BY WALL SHARE ===")
    query.operations.slice(0, 10).forEach((op) => {
      console.log(
        `${op.operation.padEnd(28)} | p50: ${op.stats.p50.toFixed(2).padStart(7)} ms | p95: ${op.stats.p95.toFixed(2).padStart(7)} ms | Wall: ${op.wallSharePercent.toFixed(1).padStart(5)}%`,
      )
    })
    console.log("========================================\n")
  }, 120000)
})

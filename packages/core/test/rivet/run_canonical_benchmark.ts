import path from "path"
import fs from "fs"
import { RealBenchmarkDriver, type RealTaskRunResult } from "../../src/rivet/benchmark/real-driver"
import { BENCHMARK_CORPUS } from "../../src/rivet/benchmark/corpus"
import { ParquetFlightExporter } from "../../src/rivet/flight-recorder/parquet"
import type { FlightSpan } from "../../src/rivet/flight-recorder/types"

async function main() {
  console.log("=================================================================")
  console.log("STARTING CANONICAL LIVE GEMINI 3.8 FLASH A/B BENCHMARK")
  console.log("Provider: OpenRouter | Model: google/gemini-3.8-flash")
  console.log("=================================================================\n")

  const driver = new RealBenchmarkDriver()
  const allSpans: FlightSpan[] = []
  const results: RealTaskRunResult[] = []

  // Run 6 canonical tasks (balanced dev & holdout across short, medium, persistence)
  const taskIdsToRun = [
    "dev_locate_config",
    "dev_inspect_version",
    "holdout_fix_syntax_bug",
    "dev_trace_dependency",
    "dev_restart_continuation",
    "holdout_restart_investigation",
  ]

  const tasks = BENCHMARK_CORPUS.filter((t) => taskIdsToRun.includes(t.id))

  for (const task of tasks) {
    console.log(`\n------------------------------------------------------------`)
    console.log(`TASK: [${task.id}] - ${task.name} (${task.split})`)
    console.log(`------------------------------------------------------------`)

    // 1. Run Baseline Harness
    console.log(`--> Running BASELINE harness...`)
    const baseResult = await driver.runTask(task, "baseline")
    results.push(baseResult)
    allSpans.push(...baseResult.spans)
    console.log(`    Result: ${baseResult.passed ? "PASSED" : "FAILED"} | Wall: ${baseResult.wallClockMs.toFixed(1)}ms | ModelCalls: ${baseResult.modelCalls} | ToolCalls: ${baseResult.toolCalls} | TTFT: ${baseResult.providerTtftMs.toFixed(1)}ms | Gen: ${baseResult.providerGenerationMs.toFixed(1)}ms`)
    if (baseResult.failureReason) console.log(`    Failure: ${baseResult.failureReason}`)

    // 2. Run Rivet Harness
    console.log(`--> Running RIVET harness...`)
    const rivetResult = await driver.runTask(task, "rivet")
    results.push(rivetResult)
    allSpans.push(...rivetResult.spans)
    console.log(`    Result: ${rivetResult.passed ? "PASSED" : "FAILED"} | Wall: ${rivetResult.wallClockMs.toFixed(1)}ms | ModelCalls: ${rivetResult.modelCalls} | ToolCalls: ${rivetResult.toolCalls} | RivetOwned: ${rivetResult.rivetOwnedMs.toFixed(1)}ms | TTFT: ${rivetResult.providerTtftMs.toFixed(1)}ms | Gen: ${rivetResult.providerGenerationMs.toFixed(1)}ms`)
    if (rivetResult.failureReason) console.log(`    Failure: ${rivetResult.failureReason}`)
  }

  // Export all real spans to Parquet
  const parquetDir = path.join(process.cwd(), ".rivet", "traces")
  await fs.promises.mkdir(parquetDir, { recursive: true })
  const parquetPath = path.join(parquetDir, "real_benchmark.parquet")
  await ParquetFlightExporter.exportSpans(parquetPath, allSpans)
  console.log(`\nExported ${allSpans.length} real spans to ${parquetPath}`)

  // Save raw results json
  const jsonPath = path.join(parquetDir, "real_benchmark_results.json")
  await fs.promises.writeFile(jsonPath, JSON.stringify(results, null, 2))
  console.log(`Saved execution results to ${jsonPath}`)
}

main().catch(console.error)

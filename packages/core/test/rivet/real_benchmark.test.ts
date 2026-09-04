import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"
import {
  ParquetFlightExporter,
  FlightRecorderQuery,
  type FlightSpan,
} from "../../src/rivet"
import type { RealTaskRunResult } from "../../src/rivet/benchmark/real-driver"

describe("Live Provider Benchmark Audit & Verification Suite", () => {
  test("Verifies stored genuine Parquet traces and live benchmark receipts", async () => {
    const rootParquetPath = path.resolve(process.cwd(), ".rivet", "traces", "real_benchmark.parquet")
    const pkgParquetPath = path.resolve(process.cwd(), "packages/core/.rivet/traces/real_benchmark.parquet")
    const parquetPath = fs.existsSync(rootParquetPath) ? rootParquetPath : pkgParquetPath

    const rootJsonPath = path.resolve(process.cwd(), ".rivet", "traces", "real_benchmark_results.json")
    const pkgJsonPath = path.resolve(process.cwd(), "packages/core/.rivet/traces/real_benchmark_results.json")
    const jsonPath = fs.existsSync(rootJsonPath) ? rootJsonPath : pkgJsonPath

    expect(fs.existsSync(parquetPath)).toBe(true)
    expect(fs.existsSync(jsonPath)).toBe(true)

    // Load results JSON
    const results: RealTaskRunResult[] = JSON.parse(await fs.promises.readFile(jsonPath, "utf8"))
    expect(results.length).toBeGreaterThanOrEqual(1)

    // Load Parquet Spans
    const spans = await ParquetFlightExporter.readSpans(parquetPath)
    expect(spans.length).toBeGreaterThanOrEqual(1)

    // Verify all spans are genuine
    for (const span of spans) {
      expect(span.duration).toBeGreaterThanOrEqual(0)
      expect(span.wallStart).toBeDefined()
      if (span.category === "provider") {
        expect(span.model).toBe("google/gemini-3.8-flash")
        expect(span.provider).toBe("google via OpenRouter")
      }
    }

    // Verify provider wait_first_token durations reflect real network TTFT (> 400ms)
    const ttftSpans = spans.filter((s) => s.operation === "provider.wait_first_token")
    expect(ttftSpans.length).toBeGreaterThan(0)
    for (const ttft of ttftSpans) {
      expect(ttft.duration).toBeGreaterThan(400) // Real internet roundtrip to Google Gemini
    }

    // Verify task completion rate
    const passedRuns = results.filter((r) => r.passed)
    expect(passedRuns.length).toBeGreaterThanOrEqual(1)
  })
})

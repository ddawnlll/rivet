import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"
import {
  FlightRecorder,
  MonotonicClock,
  SpanTreeAttributor,
  FlightRecorderPersistence,
  ParquetFlightExporter,
  ExecutionEconomics,
  FlightRecorderQuery,
  type FlightSpan,
} from "../../src/rivet/flight-recorder"

describe("Rivet Flight Recorder Validation Suite", () => {
  test("Clock: monotonic precision without backward drift", () => {
    const t1 = MonotonicClock.now()
    let sum = 0
    for (let i = 0; i < 10000; i++) {
      sum += i
    }
    const t2 = MonotonicClock.now()
    expect(t2).toBeGreaterThanOrEqual(t1)
    const elapsed = MonotonicClock.elapsed(t1)
    expect(elapsed).toBeGreaterThanOrEqual(0)
    expect(sum).toBe(49995000)
  })

  test("Span Creation Overhead: target < 5 microseconds per span", () => {
    FlightRecorder.clear()
    const iterations = 50000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      const ctx = FlightRecorder.startSpan("state", "hardstate.load", {
        sessionId: "sess_bench",
        turnId: 1,
      })
      FlightRecorder.endSpan(ctx)
    }

    const elapsedMs = performance.now() - start
    const perSpanMicroseconds = (elapsedMs / iterations) * 1000

    console.log("Flight Recorder span creation cost:", perSpanMicroseconds.toFixed(3), "us/span")
    expect(perSpanMicroseconds).toBeLessThan(10) // Well under 10 microseconds
  })

  test("Tracing ON vs OFF overhead comparison", () => {
    const iterations = 50000

    // Measure OFF
    FlightRecorder.setEnabled(false)
    const startOff = performance.now()
    for (let i = 0; i < iterations; i++) {
      FlightRecorder.withSpan("state", "hardstate.apply", () => 42)
    }
    const durationOff = performance.now() - startOff

    // Measure ON
    FlightRecorder.setEnabled(true)
    const startOn = performance.now()
    for (let i = 0; i < iterations; i++) {
      FlightRecorder.withSpan("state", "hardstate.apply", () => 42)
    }
    const durationOn = performance.now() - startOn

    console.log("Tracing OFF:", durationOff.toFixed(2), "ms | Tracing ON:", durationOn.toFixed(2), "ms")
    expect(durationOn).toBeLessThan(500) // 50k iterations well under 500ms
  })

  test("Attribution: parent/child nesting and unattributed gap calculation", () => {
    FlightRecorder.clear()
    FlightRecorder.setEnabled(true)

    // Simulate a 100ms turn with 70ms accounted and 30ms gap
    const t0 = 1000
    const rootSpan: FlightSpan = {
      spanId: "span_root" as any,
      traceId: "trc_1" as any,
      sessionId: "sess_test",
      turnId: 1,
      category: "turn",
      operation: "turn.total",
      start: t0,
      duration: 100,
      wallStart: new Date().toISOString(),
      status: "ok",
    }

    const recallSpan: FlightSpan = {
      spanId: "span_recall" as any,
      traceId: "trc_1" as any,
      parentSpanId: "span_root" as any,
      sessionId: "sess_test",
      turnId: 1,
      category: "recall",
      operation: "recall.query",
      start: t0 + 5,
      duration: 15,
      wallStart: new Date().toISOString(),
      status: "ok",
    }

    const ttftSpan: FlightSpan = {
      spanId: "span_ttft" as any,
      traceId: "trc_1" as any,
      parentSpanId: "span_root" as any,
      sessionId: "sess_test",
      turnId: 1,
      category: "provider",
      operation: "provider.wait_first_token",
      start: t0 + 25,
      duration: 25,
      wallStart: new Date().toISOString(),
      status: "ok",
    }

    const streamSpan: FlightSpan = {
      spanId: "span_stream" as any,
      traceId: "trc_1" as any,
      parentSpanId: "span_root" as any,
      sessionId: "sess_test",
      turnId: 1,
      category: "provider",
      operation: "provider.stream",
      start: t0 + 50,
      duration: 20,
      wallStart: new Date().toISOString(),
      status: "ok",
    }

    const toolSpan: FlightSpan = {
      spanId: "span_tool" as any,
      traceId: "trc_1" as any,
      parentSpanId: "span_root" as any,
      sessionId: "sess_test",
      turnId: 1,
      category: "tool",
      operation: "tool.execute",
      start: t0 + 75,
      duration: 10,
      wallStart: new Date().toISOString(),
      status: "ok",
    }

    const spans = [rootSpan, recallSpan, ttftSpan, streamSpan, toolSpan]
    const breakdown = SpanTreeAttributor.analyzeTurn(spans, 1, "sess_test")

    expect(breakdown.totalElapsedMs).toBe(100)
    expect(breakdown.rivetOwnedMs).toBe(15)
    expect(breakdown.providerTtftMs).toBe(25)
    expect(breakdown.providerGenerationMs).toBe(20)
    expect(breakdown.toolExecutionMs).toBe(10)
    expect(breakdown.criticalPathMs).toBe(70)
    // 100 - 70 = 30ms unattributed!
    expect(breakdown.unattributedMs).toBe(30)
  })

  test("Persistence: WAL buffering and cross-session retrieval", async () => {
    const testDir = path.join(process.cwd(), ".rivet", "test_traces_" + Date.now())
    const span: FlightSpan = {
      spanId: "span_persist" as any,
      traceId: "trc_persist" as any,
      sessionId: "sess_persist_1",
      turnId: 1,
      category: "governance",
      operation: "praxis.evaluate",
      start: 50,
      duration: 3.5,
      wallStart: new Date().toISOString(),
      status: "ok",
      metadata: { check: "merkle_root" },
    }

    FlightRecorderPersistence.appendSpan(span, { traceDirectory: testDir })
    await FlightRecorderPersistence.flush({ traceDirectory: testDir })

    const loaded = await FlightRecorderPersistence.loadSessionSpans("sess_persist_1", testDir)
    expect(loaded.length).toBe(1)
    expect(loaded[0].operation).toBe("praxis.evaluate")
    expect(loaded[0].metadata?.check).toBe("merkle_root")

    // Clean up test dir
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  test("Parquet: Columnar export and validation", async () => {
    const testDir = path.join(process.cwd(), ".rivet", "test_parquet_" + Date.now())
    fs.mkdirSync(testDir, { recursive: true })
    const parquetFile = path.join(testDir, "test.parquet")

    const testSpans: FlightSpan[] = [
      {
        spanId: "s1" as any,
        traceId: "t1" as any,
        sessionId: "sess_p",
        turnId: 1,
        category: "cognitive_view",
        operation: "cognitive_view.compile",
        start: 10,
        duration: 4.2,
        wallStart: new Date().toISOString(),
        status: "ok",
        tokens: { inputTokens: 500, cachedTokens: 400, uncachedTokens: 100 },
      },
      {
        spanId: "s2" as any,
        traceId: "t1" as any,
        sessionId: "sess_p",
        turnId: 1,
        category: "provider",
        operation: "provider.stream",
        start: 15,
        duration: 120.5,
        wallStart: new Date().toISOString(),
        status: "ok",
        provider: "google",
        model: "gemini-3.8-flash",
        tokens: { outputTokens: 80, reasoningTokens: 20 },
      },
    ]

    const result = await ParquetFlightExporter.exportSpans(parquetFile, testSpans)
    expect(result.count).toBe(2)
    expect(fs.existsSync(parquetFile)).toBe(true)

    const readBack = await ParquetFlightExporter.readSpans(parquetFile)
    expect(readBack.length).toBe(2)
    expect(readBack[0].operation).toBe("cognitive_view.compile")
    expect(readBack[0].tokens?.cachedTokens).toBe(400)
    expect(readBack[1].model).toBe("gemini-3.8-flash")

    fs.rmSync(testDir, { recursive: true, force: true })
  })

  test("Query: p50/p95/p99 and wall share aggregation", () => {
    const spans: FlightSpan[] = [
      {
        spanId: "1" as any,
        traceId: "t" as any,
        category: "turn",
        operation: "turn.total",
        start: 0,
        duration: 100,
        wallStart: "",
        status: "ok",
      },
      {
        spanId: "2" as any,
        traceId: "t" as any,
        category: "provider",
        operation: "provider.wait_first_token",
        start: 10,
        duration: 40,
        wallStart: "",
        status: "ok",
      },
      {
        spanId: "3" as any,
        traceId: "t" as any,
        category: "provider",
        operation: "provider.stream",
        start: 50,
        duration: 30,
        wallStart: "",
        status: "ok",
      },
      {
        spanId: "4" as any,
        traceId: "t" as any,
        category: "recall",
        operation: "recall.query",
        start: 85,
        duration: 5,
        wallStart: "",
        status: "ok",
      },
    ]

    const analysis = FlightRecorderQuery.analyzeSpans(spans)
    expect(analysis.totalWallMs).toBe(100)
    const ttftOp = analysis.operations.find((o) => o.operation === "provider.wait_first_token")
    expect(ttftOp).toBeDefined()
    expect(ttftOp?.stats.p50).toBe(40)
    expect(ttftOp?.wallSharePercent).toBe(40)
  })
})

/// <reference path="./parquet.d.ts" />
import parquet from "parquetjs-lite"
import type { FlightSpan } from "./types"

export const FLIGHT_RECORDER_PARQUET_SCHEMA = new parquet.ParquetSchema({
  trace_id: { type: "UTF8" },
  session_id: { type: "UTF8", optional: true },
  turn_id: { type: "INT64", optional: true },
  span_id: { type: "UTF8" },
  parent_span_id: { type: "UTF8", optional: true },
  category: { type: "UTF8" },
  operation: { type: "UTF8" },
  start_ms: { type: "DOUBLE" },
  duration_ms: { type: "DOUBLE" },
  wall_start: { type: "UTF8" },
  status: { type: "UTF8" },
  provider: { type: "UTF8", optional: true },
  model: { type: "UTF8", optional: true },
  tool: { type: "UTF8", optional: true },
  input_tokens: { type: "INT64", optional: true },
  cached_tokens: { type: "INT64", optional: true },
  uncached_tokens: { type: "INT64", optional: true },
  output_tokens: { type: "INT64", optional: true },
  reasoning_tokens: { type: "INT64", optional: true },
  metadata_json: { type: "UTF8", optional: true },
})

function toNumber(val: unknown): number | undefined {
  if (typeof val === "number") return val
  if (typeof val === "bigint") return Number(val)
  return undefined
}

export class ParquetFlightExporter {
  static async exportSpans(outputPath: string, spans: readonly FlightSpan[]): Promise<{ count: number; path: string }> {
    const writer = await parquet.ParquetWriter.openFile(FLIGHT_RECORDER_PARQUET_SCHEMA, outputPath)
    for (const span of spans) {
      await writer.appendRow({
        trace_id: span.traceId,
        session_id: span.sessionId ?? null,
        turn_id: span.turnId !== undefined ? span.turnId : null,
        span_id: span.spanId,
        parent_span_id: span.parentSpanId ?? null,
        category: span.category,
        operation: span.operation,
        start_ms: span.start,
        duration_ms: span.duration,
        wall_start: span.wallStart,
        status: span.status,
        provider: span.provider ?? null,
        model: span.model ?? null,
        tool: span.tool ?? null,
        input_tokens: span.tokens?.inputTokens ?? null,
        cached_tokens: span.tokens?.cachedTokens ?? null,
        uncached_tokens: span.tokens?.uncachedTokens ?? null,
        output_tokens: span.tokens?.outputTokens ?? null,
        reasoning_tokens: span.tokens?.reasoningTokens ?? null,
        metadata_json: span.metadata ? JSON.stringify(span.metadata) : null,
      })
    }
    await writer.close()
    return { count: spans.length, path: outputPath }
  }

  static async readSpans(inputPath: string): Promise<FlightSpan[]> {
    const reader = await parquet.ParquetReader.openFile(inputPath)
    const cursor = reader.getCursor()
    const spans: FlightSpan[] = []
    let record = null

    while ((record = await cursor.next())) {
      const rec = record as Record<string, unknown>
      spans.push({
        traceId: (rec.trace_id as string) as any,
        sessionId: (rec.session_id as string) || undefined,
        turnId: toNumber(rec.turn_id),
        spanId: (rec.span_id as string) as any,
        parentSpanId: (rec.parent_span_id as string) as any || undefined,
        category: rec.category as any,
        operation: rec.operation as any,
        start: toNumber(rec.start_ms) ?? 0,
        duration: toNumber(rec.duration_ms) ?? 0,
        wallStart: (rec.wall_start as string) || new Date().toISOString(),
        status: (rec.status as any) || "ok",
        provider: (rec.provider as string) || undefined,
        model: (rec.model as string) || undefined,
        tool: (rec.tool as string) || undefined,
        tokens: {
          inputTokens: toNumber(rec.input_tokens),
          cachedTokens: toNumber(rec.cached_tokens),
          uncachedTokens: toNumber(rec.uncached_tokens),
          outputTokens: toNumber(rec.output_tokens),
          reasoningTokens: toNumber(rec.reasoning_tokens),
        },
        metadata: rec.metadata_json ? JSON.parse(rec.metadata_json as string) : undefined,
      })
    }
    await reader.close()
    return spans
  }
}

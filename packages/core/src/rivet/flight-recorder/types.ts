export type SpanId = string & { readonly __brand: "SpanId" }
export type TraceId = string & { readonly __brand: "TraceId" }

export function createSpanId(val?: string): SpanId {
  const rand = Math.random().toString(36).substring(2, 10)
  return (val ?? ("span_" + rand)) as SpanId
}

export function createTraceId(val?: string): TraceId {
  const rand = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10)
  return (val ?? ("trc_" + rand)) as TraceId
}

export type SpanCategory =
  | "turn"
  | "state"
  | "recall"
  | "cognitive_view"
  | "provider"
  | "tool"
  | "governance"
  | "runtime"
  | "ui"

export type SpanOperation =
  // Turn
  | "turn.total"
  | "turn.admission"
  | "goal.compile"
  | "controller.decide"
  | "completion.evaluate"
  // State
  | "hardstate.load"
  | "hardstate.apply"
  | "event.append"
  | "state.materialize"
  // Recall / Noesis
  | "recall.query"
  | "recall.score"
  | "recall.index_delta"
  | "noesis.project"
  | "evidence.admit"
  | "claim.promote"
  // Cognitive View
  | "cognitive_view.compile"
  | "memory_frontier.compile"
  | "prompt.assemble"
  | "tool_schema.select"
  | "message.compact"
  | "message.serialize"
  // Provider
  | "provider.prepare"
  | "provider.request"
  | "provider.wait_first_token"
  | "provider.stream"
  | "provider.finalize"
  // Tool
  | "tool.dispatch"
  | "tool.execute"
  | "tool.result_process"
  | "tool.persist"
  // Governance
  | "praxis.evaluate"
  | "obligation.evaluate"
  | "verification.receipt"
  | "accp.evaluate"
  // Runtime / UI
  | "event.persist"
  | "token.accounting"
  | "tui.render"
  | "stream.dispatch"
  | (string & {})

export type SpanStatus = "ok" | "error" | "cancelled"

export interface SpanTokens {
  readonly inputTokens?: number
  readonly cachedTokens?: number
  readonly uncachedTokens?: number
  readonly outputTokens?: number
  readonly reasoningTokens?: number
}

export interface SpanMetadata {
  readonly [key: string]: string | number | boolean | null | undefined
}

export interface FlightSpan {
  readonly spanId: SpanId
  readonly traceId: TraceId
  readonly parentSpanId?: SpanId
  readonly sessionId?: string
  readonly turnId?: number
  readonly category: SpanCategory
  readonly operation: SpanOperation
  readonly start: number
  readonly duration: number
  readonly wallStart: string
  readonly status: SpanStatus
  readonly errorMessage?: string
  readonly goalType?: string
  readonly turnType?: string
  readonly provider?: string
  readonly model?: string
  readonly tool?: string
  readonly tokens?: SpanTokens
  readonly metadata?: SpanMetadata
}

export interface ExclusiveSpan {
  readonly span: FlightSpan
  readonly exclusiveDuration: number
  readonly children: readonly ExclusiveSpan[]
}

export interface TurnAttributionBreakdown {
  readonly turnId: number
  readonly sessionId?: string
  readonly totalElapsedMs: number
  readonly criticalPathMs: number
  readonly rivetOwnedMs: number
  readonly providerTtftMs: number
  readonly providerGenerationMs: number
  readonly providerFinalizeMs: number
  readonly providerTotalMs: number
  readonly toolExecutionMs: number
  readonly unattributedMs: number
  readonly phaseBreakdown: readonly {
    readonly operation: string
    readonly category: SpanCategory
    readonly durationMs: number
    readonly exclusiveDurationMs: number
  }[]
}

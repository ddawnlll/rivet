import { Effect } from "effect"
import { MonotonicClock } from "./clock"
import { SpanTreeAttributor } from "./attribution"
import { FlightRecorderPersistence } from "./persistence"
import {
  createSpanId,
  createTraceId,
  type FlightSpan,
  type SpanCategory,
  type SpanId,
  type SpanMetadata,
  type SpanOperation,
  type SpanStatus,
  type SpanTokens,
  type TraceId,
  type TurnAttributionBreakdown,
} from "./types"

export interface ActiveSpanContext {
  readonly spanId: SpanId
  readonly traceId: TraceId
  readonly parentSpanId?: SpanId
  readonly sessionId?: string
  readonly turnId?: number
  readonly category: SpanCategory
  readonly operation: SpanOperation
  readonly start: number
  readonly wallStart: string
  readonly provider?: string
  readonly model?: string
  readonly tool?: string
  readonly metadata?: SpanMetadata
}

export interface SpanEndOptions {
  readonly status?: SpanStatus
  readonly errorMessage?: string
  readonly tokens?: SpanTokens
  readonly metadata?: SpanMetadata
}

export type SpanListener = (span: FlightSpan) => void
export type ActiveSpanListener = (active: ActiveSpanContext | undefined) => void

export class FlightRecorder {
  private static enabled = true
  private static activeSpans: ActiveSpanContext[] = []
  private static completedSpans: FlightSpan[] = []
  private static maxCompletedSpans = 2000
  private static listeners: SpanListener[] = []
  private static activeListeners: ActiveSpanListener[] = []

  static isEnabled(): boolean {
    return this.enabled
  }

  static setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  static clear(): void {
    this.activeSpans = []
    this.completedSpans = []
  }

  static onSpanCompleted(listener: SpanListener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  static onActiveSpanChanged(listener: ActiveSpanListener): () => void {
    this.activeListeners.push(listener)
    return () => {
      this.activeListeners = this.activeListeners.filter((l) => l !== listener)
    }
  }

  static getActiveSpan(): ActiveSpanContext | undefined {
    return this.activeSpans.length > 0 ? this.activeSpans[this.activeSpans.length - 1] : undefined
  }

  static getCompletedSpans(sessionId?: string): readonly FlightSpan[] {
    if (sessionId) return this.completedSpans.filter((s) => s.sessionId === sessionId)
    return this.completedSpans
  }

  static startSpan(
    category: SpanCategory,
    operation: SpanOperation,
    options?: {
      readonly parentSpanId?: SpanId
      readonly sessionId?: string
      readonly turnId?: number
      readonly traceId?: TraceId
      readonly provider?: string
      readonly model?: string
      readonly tool?: string
      readonly metadata?: SpanMetadata
    },
  ): ActiveSpanContext {
    const parent = options?.parentSpanId ?? this.getActiveSpan()?.spanId
    const traceId = options?.traceId ?? this.getActiveSpan()?.traceId ?? createTraceId()
    const ctx: ActiveSpanContext = {
      spanId: createSpanId(),
      traceId,
      parentSpanId: parent,
      sessionId: options?.sessionId ?? this.getActiveSpan()?.sessionId,
      turnId: options?.turnId ?? this.getActiveSpan()?.turnId,
      category,
      operation,
      start: MonotonicClock.now(),
      wallStart: MonotonicClock.wallNow(),
      provider: options?.provider ?? this.getActiveSpan()?.provider,
      model: options?.model ?? this.getActiveSpan()?.model,
      tool: options?.tool,
      metadata: options?.metadata,
    }

    if (this.enabled) {
      this.activeSpans.push(ctx)
      this.activeListeners.forEach((l) => l(ctx))
    }

    return ctx
  }

  static endSpan(context: ActiveSpanContext, options?: SpanEndOptions): FlightSpan {
    const duration = MonotonicClock.elapsed(context.start)
    const span: FlightSpan = {
      spanId: context.spanId,
      traceId: context.traceId,
      parentSpanId: context.parentSpanId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      category: context.category,
      operation: context.operation,
      start: context.start,
      duration,
      wallStart: context.wallStart,
      status: options?.status ?? "ok",
      errorMessage: options?.errorMessage,
      provider: context.provider,
      model: context.model,
      tool: context.tool,
      tokens: options?.tokens,
      metadata: { ...context.metadata, ...options?.metadata },
    }

    if (this.enabled) {
      this.activeSpans = this.activeSpans.filter((s) => s.spanId !== context.spanId)
      this.completedSpans.push(span)
      if (this.completedSpans.length > this.maxCompletedSpans) {
        this.completedSpans.shift()
      }
      FlightRecorderPersistence.appendSpan(span)
      this.listeners.forEach((l) => l(span))
      this.activeListeners.forEach((l) => l(this.getActiveSpan()))
    }

    return span
  }

  static withSpan<T>(
    category: SpanCategory,
    operation: SpanOperation,
    fn: (ctx: ActiveSpanContext) => T,
    options?: {
      readonly parentSpanId?: SpanId
      readonly sessionId?: string
      readonly turnId?: number
      readonly traceId?: TraceId
      readonly provider?: string
      readonly model?: string
      readonly tool?: string
      readonly metadata?: SpanMetadata
    },
  ): T {
    if (!this.enabled) {
      return fn({
        spanId: createSpanId(),
        traceId: createTraceId(),
        category,
        operation,
        start: 0,
        wallStart: "",
      })
    }

    const ctx = this.startSpan(category, operation, options)
    try {
      const result = fn(ctx)
      if (result instanceof Promise) {
        return (result
          .then((res) => {
            FlightRecorder.endSpan(ctx, { status: "ok" })
            return res
          })
          .catch((err) => {
            FlightRecorder.endSpan(ctx, {
              status: "error",
              errorMessage: err instanceof Error ? err.message : String(err),
            })
            throw err
          })) as T
      }
      this.endSpan(ctx, { status: "ok" })
      return result
    } catch (err) {
      this.endSpan(ctx, {
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  static withSpanEffect<A, E, R>(
    category: SpanCategory,
    operation: SpanOperation,
    effect: Effect.Effect<A, E, R>,
    options?: {
      readonly parentSpanId?: SpanId
      readonly sessionId?: string
      readonly turnId?: number
      readonly traceId?: TraceId
      readonly provider?: string
      readonly model?: string
      readonly tool?: string
      readonly metadata?: SpanMetadata
    },
  ): Effect.Effect<A, E, R> {
    if (!this.enabled) return effect

    return Effect.acquireUseRelease(
      Effect.sync(() => FlightRecorder.startSpan(category, operation, options)),
      () => effect,
      (ctx, exit) =>
        Effect.sync(() => {
          if (exit._tag === "Success") {
            FlightRecorder.endSpan(ctx, { status: "ok" })
          } else {
            FlightRecorder.endSpan(ctx, {
              status: "error",
              errorMessage: JSON.stringify(exit.cause),
            })
          }
        }),
    )
  }

  static getTurnTimeline(turnId: number, sessionId?: string): TurnAttributionBreakdown {
    const relevant = this.completedSpans.filter(
      (s) => (s.turnId === turnId || s.turnId === undefined) && (!sessionId || s.sessionId === sessionId),
    )
    return SpanTreeAttributor.analyzeTurn(relevant, turnId, sessionId)
  }
}

import type { FlightSpan, ExclusiveSpan, TurnAttributionBreakdown, SpanCategory } from "./types"

export class SpanTreeAttributor {
  static buildTree(spans: readonly FlightSpan[]): ExclusiveSpan[] {
    const spanMap = new Map<string, { span: FlightSpan; children: FlightSpan[] }>()
    spans.forEach((s) => spanMap.set(s.spanId, { span: s, children: [] }))

    const roots: FlightSpan[] = []
    spans.forEach((s) => {
      if (s.parentSpanId && spanMap.has(s.parentSpanId)) {
        spanMap.get(s.parentSpanId)!.children.push(s)
      } else {
        roots.push(s)
      }
    })

    const buildExclusive = (node: { span: FlightSpan; children: FlightSpan[] }): ExclusiveSpan => {
      const childExclusive = node.children.map((c) => buildExclusive(spanMap.get(c.spanId)!))
      const directChildrenSum = childExclusive.reduce((acc, c) => acc + c.span.duration, 0)
      const exclusiveDuration = Math.max(0, node.span.duration - directChildrenSum)
      return {
        span: node.span,
        exclusiveDuration,
        children: childExclusive,
      }
    }

    return roots.map((r) => buildExclusive(spanMap.get(r.spanId)!))
  }

  static analyzeTurn(spans: readonly FlightSpan[], turnId: number, sessionId?: string): TurnAttributionBreakdown {
    const turnSpans = spans.filter((s) => s.turnId === undefined || s.turnId === turnId)
    const rootSpan = turnSpans.find((s) => s.operation === "turn.total")

    let totalElapsedMs = rootSpan ? rootSpan.duration : 0
    if (totalElapsedMs === 0 && turnSpans.length > 0) {
      const minStart = Math.min(...turnSpans.map((s) => s.start))
      const maxEnd = Math.max(...turnSpans.map((s) => s.start + s.duration))
      totalElapsedMs = Math.max(0, maxEnd - minStart)
    }

    const tree = this.buildTree(turnSpans)
    const flatExclusive: { span: FlightSpan; exclusiveDuration: number }[] = []

    const flatten = (nodes: readonly ExclusiveSpan[]) => {
      nodes.forEach((n) => {
        flatExclusive.push({ span: n.span, exclusiveDuration: n.exclusiveDuration })
        flatten(n.children)
      })
    }
    flatten(tree)

    let rivetOwnedMs = 0
    let providerTtftMs = 0
    let providerGenerationMs = 0
    let providerFinalizeMs = 0
    let toolExecutionMs = 0

    flatExclusive.forEach(({ span, exclusiveDuration }) => {
      const op = span.operation
      const cat = span.category

      if (op === "provider.wait_first_token") {
        providerTtftMs += exclusiveDuration
      } else if (op === "provider.stream") {
        providerGenerationMs += exclusiveDuration
      } else if (op === "provider.finalize") {
        providerFinalizeMs += exclusiveDuration
      } else if (op === "tool.execute") {
        toolExecutionMs += exclusiveDuration
      } else if (
        cat === "state" ||
        cat === "recall" ||
        cat === "cognitive_view" ||
        cat === "governance" ||
        cat === "runtime" ||
        cat === "ui" ||
        op === "turn.admission" ||
        op === "goal.compile" ||
        op === "controller.decide" ||
        op === "completion.evaluate" ||
        op === "tool.dispatch" ||
        op === "tool.result_process" ||
        op === "tool.persist" ||
        op === "provider.prepare"
      ) {
        rivetOwnedMs += exclusiveDuration
      }
    })

    const providerTotalMs = providerTtftMs + providerGenerationMs + providerFinalizeMs
    const accountedMs = rivetOwnedMs + providerTotalMs + toolExecutionMs
    const unattributedMs = Math.max(0, totalElapsedMs - accountedMs)

    const phaseBreakdown = flatExclusive
      .filter(({ span }) => span.operation !== "turn.total")
      .map(({ span, exclusiveDuration }) => ({
        operation: span.operation,
        category: span.category,
        durationMs: Number(span.duration.toFixed(3)),
        exclusiveDurationMs: Number(exclusiveDuration.toFixed(3)),
      }))

    return {
      turnId,
      sessionId,
      totalElapsedMs: Number(totalElapsedMs.toFixed(3)),
      criticalPathMs: Number(accountedMs.toFixed(3)),
      rivetOwnedMs: Number(rivetOwnedMs.toFixed(3)),
      providerTtftMs: Number(providerTtftMs.toFixed(3)),
      providerGenerationMs: Number(providerGenerationMs.toFixed(3)),
      providerFinalizeMs: Number(providerFinalizeMs.toFixed(3)),
      providerTotalMs: Number(providerTotalMs.toFixed(3)),
      toolExecutionMs: Number(toolExecutionMs.toFixed(3)),
      unattributedMs: Number(unattributedMs.toFixed(3)),
      phaseBreakdown,
    }
  }
}

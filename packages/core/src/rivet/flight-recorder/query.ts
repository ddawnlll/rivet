import type { FlightSpan } from "./types"

export interface PercentileStats {
  readonly count: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly mean: number
  readonly min: number
  readonly max: number
  readonly totalMs: number
}

export interface OperationAggregation {
  readonly operation: string
  readonly category: string
  readonly stats: PercentileStats
  readonly wallSharePercent: number
}

function calculatePercentiles(values: readonly number[]): PercentileStats {
  if (values.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0, totalMs: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const count = sorted.length
  const totalMs = sorted.reduce((acc, v) => acc + v, 0)
  const mean = totalMs / count
  const min = sorted[0]
  const max = sorted[count - 1]

  const p50Index = Math.min(count - 1, Math.floor(count * 0.5))
  const p95Index = Math.min(count - 1, Math.floor(count * 0.95))
  const p99Index = Math.min(count - 1, Math.floor(count * 0.99))

  return {
    count,
    p50: Number(sorted[p50Index].toFixed(3)),
    p95: Number(sorted[p95Index].toFixed(3)),
    p99: Number(sorted[p99Index].toFixed(3)),
    mean: Number(mean.toFixed(3)),
    min: Number(min.toFixed(3)),
    max: Number(max.toFixed(3)),
    totalMs: Number(totalMs.toFixed(3)),
  }
}

export class FlightRecorderQuery {
  static analyzeSpans(spans: readonly FlightSpan[]): {
    operations: readonly OperationAggregation[]
    categories: Record<string, PercentileStats>
    totalWallMs: number
  } {
    const turnTotals = spans.filter((s) => s.operation === "turn.total")
    const totalWallMs = turnTotals.reduce((acc, s) => acc + s.duration, 0) ||
      spans.reduce((acc, s) => acc + s.duration, 0)

    const opGroups = new Map<string, { category: string; durations: number[] }>()
    const catGroups = new Map<string, number[]>()

    spans.forEach((span) => {
      if (!opGroups.has(span.operation)) {
        opGroups.set(span.operation, { category: span.category, durations: [] })
      }
      opGroups.get(span.operation)!.durations.push(span.duration)

      if (!catGroups.has(span.category)) {
        catGroups.set(span.category, [])
      }
      catGroups.get(span.category)!.push(span.duration)
    })

    const operations: OperationAggregation[] = Array.from(opGroups.entries()).map(([op, data]) => {
      const stats = calculatePercentiles(data.durations)
      const wallSharePercent = totalWallMs > 0 ? Number(((stats.totalMs / totalWallMs) * 100).toFixed(2)) : 0
      return {
        operation: op,
        category: data.category,
        stats,
        wallSharePercent,
      }
    })

    operations.sort((a, b) => b.stats.totalMs - a.stats.totalMs)

    const categories: Record<string, PercentileStats> = {}
    Array.from(catGroups.entries()).forEach(([cat, durations]) => {
      categories[cat] = calculatePercentiles(durations)
    })

    return { operations, categories, totalWallMs }
  }
}

import { FlightRecorder } from "./recorder"
import { TokenLedger, type TokenLedgerEntry } from "../token-ledger"
import type { TurnAttributionBreakdown } from "./types"

export interface TurnExecutionEconomics {
  readonly turnId: number
  readonly sessionId?: string
  readonly timing: {
    readonly wallClockMs: number
    readonly rivetOwnedMs: number
    readonly providerTtftMs: number
    readonly providerGenerationMs: number
    readonly providerFinalizeMs: number
    readonly toolExecutionMs: number
    readonly unattributedMs: number
    readonly recallLatencyMs: number
    readonly praxisLatencyMs: number
    readonly hardStateLatencyMs: number
    readonly cognitiveViewLatencyMs: number
  }
  readonly tokens: {
    readonly isSettled: boolean // true = from provider receipt, false = estimated
    readonly inputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
    readonly uncachedTokens: number
    readonly outputTokens: number
    readonly reasoningTokens?: number
    readonly cacheHitRatio: number
  }
  readonly calls: {
    readonly modelCalls: number
    readonly toolCalls: number
  }
}

export class ExecutionEconomics {
  static getTurnEconomics(turnId: number, sessionId?: string): TurnExecutionEconomics {
    const timeline: TurnAttributionBreakdown = FlightRecorder.getTurnTimeline(turnId, sessionId)
    const ledgerEntries = sessionId ? TokenLedger.getEntries(sessionId) : TokenLedger.getEntries()
    const ledgerEntry = ledgerEntries.find((e) => e.turn === turnId)

    const turnSpans = FlightRecorder.getCompletedSpans(sessionId).filter((s) => s.turnId === turnId)
    const modelCalls = turnSpans.filter((s) => s.operation === "provider.request" || s.operation === "provider.stream").length
    const toolCalls = turnSpans.filter((s) => s.operation === "tool.execute").length

    const recallLatencyMs = turnSpans
      .filter((s) => s.category === "recall")
      .reduce((acc, s) => acc + s.duration, 0)
    const praxisLatencyMs = turnSpans
      .filter((s) => s.category === "governance" || s.operation.startsWith("praxis."))
      .reduce((acc, s) => acc + s.duration, 0)
    const hardStateLatencyMs = turnSpans
      .filter((s) => s.category === "state")
      .reduce((acc, s) => acc + s.duration, 0)
    const cognitiveViewLatencyMs = turnSpans
      .filter((s) => s.category === "cognitive_view")
      .reduce((acc, s) => acc + s.duration, 0)

    let isSettled = false
    let inputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let uncachedTokens = 0
    let outputTokens = 0
    let reasoningTokens: number | undefined

    if (ledgerEntry?.usage) {
      isSettled = true
      inputTokens = ledgerEntry.usage.reportedInputTokens
      cacheReadTokens = ledgerEntry.usage.cacheReadTokens
      cacheWriteTokens = ledgerEntry.usage.cacheWriteTokens
      uncachedTokens = Math.max(0, inputTokens - cacheReadTokens)
      outputTokens = ledgerEntry.usage.reportedOutputTokens
      reasoningTokens = ledgerEntry.usage.reasoningTokens
    } else if (ledgerEntry) {
      isSettled = false
      inputTokens = ledgerEntry.decomposition.totalEstimatedTokens
      const prefixTokens = ledgerEntry.prefixComparison?.commonPrefixTokens ?? 0
      cacheReadTokens = prefixTokens
      cacheWriteTokens = 0
      uncachedTokens = Math.max(0, inputTokens - cacheReadTokens)
      outputTokens = 0
    }

    const cacheHitRatio = inputTokens > 0 ? Number((cacheReadTokens / inputTokens).toFixed(4)) : 0

    return {
      turnId,
      sessionId,
      timing: {
        wallClockMs: timeline.totalElapsedMs,
        rivetOwnedMs: timeline.rivetOwnedMs,
        providerTtftMs: timeline.providerTtftMs,
        providerGenerationMs: timeline.providerGenerationMs,
        providerFinalizeMs: timeline.providerFinalizeMs,
        toolExecutionMs: timeline.toolExecutionMs,
        unattributedMs: timeline.unattributedMs,
        recallLatencyMs: Number(recallLatencyMs.toFixed(3)),
        praxisLatencyMs: Number(praxisLatencyMs.toFixed(3)),
        hardStateLatencyMs: Number(hardStateLatencyMs.toFixed(3)),
        cognitiveViewLatencyMs: Number(cognitiveViewLatencyMs.toFixed(3)),
      },
      tokens: {
        isSettled,
        inputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        uncachedTokens,
        outputTokens,
        reasoningTokens,
        cacheHitRatio,
      },
      calls: {
        modelCalls: Math.max(1, modelCalls),
        toolCalls,
      },
    }
  }
}

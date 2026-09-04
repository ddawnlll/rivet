import { Token } from "../util/token"
import type { LLMRequest, Message, ToolDefinition, ContentPart } from "@opencode-ai/llm"
import type { CognitiveView } from "./noesis"

export interface ComponentTokenAttribution {
  readonly bytes: number
  readonly estimatedTokens: number
  readonly percentage: number
}

export interface RequestTokenDecomposition {
  readonly totalBytes: number
  readonly totalEstimatedTokens: number
  readonly staticSystem: ComponentTokenAttribution
  readonly baselineContext: ComponentTokenAttribution
  readonly cognitiveView: ComponentTokenAttribution & {
    readonly hardRevision: number
    readonly goalBytes: number
    readonly activeClaimsCount: number
    readonly activeClaimsBytes: number
    readonly openObligationsCount: number
    readonly openObligationsBytes: number
    readonly recentEvidenceCount: number
    readonly recentEvidenceBytes: number
    readonly memoryFrontierCount: number
    readonly memoryFrontierBytes: number
    readonly directivesBytes: number
  }
  readonly toolSchemas: ComponentTokenAttribution & {
    readonly toolCount: number
    readonly tools: readonly { readonly name: string; readonly bytes: number; readonly estimatedTokens: number }[]
  }
  readonly conversationHistory: ComponentTokenAttribution & {
    readonly messageCount: number
    readonly userMessages: ComponentTokenAttribution
    readonly syntheticDirectives: ComponentTokenAttribution
    readonly assistantText: ComponentTokenAttribution
    readonly assistantReasoning: ComponentTokenAttribution
    readonly toolCalls: ComponentTokenAttribution
    readonly toolResults: ComponentTokenAttribution
  }
}

export interface PrefixComparison {
  readonly commonPrefixBytes: number
  readonly commonPrefixTokens: number
  readonly prefixMatchPercentage: number
  readonly lineOverlapPercentage: number
  readonly contextDeltaRatio: number
  readonly firstDivergentComponent: string
}

export interface TokenLedgerEntry {
  readonly id: string
  readonly sessionID: string
  readonly turn: number
  readonly invocationID: string
  readonly model: string
  readonly provider: string
  readonly timestamp: string
  readonly decomposition: RequestTokenDecomposition
  readonly prefixComparison?: PrefixComparison
  usage?: {
    readonly reportedInputTokens: number
    readonly reportedOutputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
    readonly reasoningTokens: number
  }
}

function computeAttribution(bytes: number, totalBytes: number): ComponentTokenAttribution {
  const estimatedTokens = Token.estimate(" ".repeat(bytes))
  const percentage = totalBytes > 0 ? Number(((bytes / totalBytes) * 100).toFixed(2)) : 0
  return { bytes, estimatedTokens, percentage }
}

export class TokenLedger {
  private static entries: TokenLedgerEntry[] = []
  private static previousRequests = new Map<string, { serialized: string; decomposition: RequestTokenDecomposition }>()

  static clear(): void {
    this.entries = []
    this.previousRequests.clear()
  }

  static getEntries(sessionID?: string): readonly TokenLedgerEntry[] {
    if (sessionID) return this.entries.filter((e) => e.sessionID === sessionID)
    return this.entries
  }

  static analyzeRequest(request: LLMRequest, previousSerialized?: string): {
    decomposition: RequestTokenDecomposition
    serialized: string
    prefixComparison?: PrefixComparison
  } {
    // 1. Analyze System Parts
    let staticSystemBytes = 0
    let baselineContextBytes = 0
    let cognitiveViewBytes = 0
    let cognitiveViewText = ""

    for (let i = 0; i < request.system.length; i++) {
      const part = request.system[i]!
      const textBytes = Buffer.byteLength(part.text, "utf8")
      if (part.text.includes("RIVET COGNITIVE VIEW")) {
        cognitiveViewBytes += textBytes
        cognitiveViewText = part.text
      } else if (i === 0 && request.system.length > 2) {
        staticSystemBytes += textBytes
      } else {
        baselineContextBytes += textBytes
      }
    }

    // Cognitive View internal decomposition
    const cogLines = cognitiveViewText.split("\n")
    let goalBytes = 0
    let activeClaimsBytes = 0
    let activeClaimsCount = 0
    let openObligationsBytes = 0
    let openObligationsCount = 0
    let recentEvidenceBytes = 0
    let recentEvidenceCount = 0
    let memoryFrontierBytes = 0
    let memoryFrontierCount = 0
    let directivesBytes = 0

    let currentSection = "directives"
    for (const line of cogLines) {
      const b = Buffer.byteLength(line, "utf8") + 1
      if (line.startsWith("CRITICAL HARNESS DIRECTIVES") || line.startsWith("=======")) {
        currentSection = "directives"
        directivesBytes += b
      } else if (line.startsWith("### CURRENT GOAL") || line.startsWith("### CONVERSATIONAL MODE")) {
        currentSection = "goal"
        goalBytes += b
      } else if (line.startsWith("### OBLIGATION") || line.startsWith("### OPEN OBLIGATIONS")) {
        currentSection = "obligations"
        openObligationsBytes += b
      } else if (line.startsWith("### AUTHORITATIVE HARD CLAIMS")) {
        currentSection = "claims"
        activeClaimsBytes += b
      } else if (line.startsWith("### RECENT AUTHORITATIVE EVIDENCE")) {
        currentSection = "evidence"
        recentEvidenceBytes += b
      } else if (line.startsWith("### HARNESS MEMORY FRONTIER")) {
        currentSection = "memory"
        memoryFrontierBytes += b
      } else {
        if (currentSection === "directives") directivesBytes += b
        else if (currentSection === "goal") goalBytes += b
        else if (currentSection === "obligations") {
          openObligationsBytes += b
          if (line.trim().startsWith("- [") || line.trim().startsWith("[ ]")) openObligationsCount++
        } else if (currentSection === "claims") {
          activeClaimsBytes += b
          if (line.trim().startsWith("- [")) activeClaimsCount++
        } else if (currentSection === "evidence") {
          recentEvidenceBytes += b
          if (line.trim().startsWith("- [") || line.trim().startsWith("- ev_")) recentEvidenceCount++
        } else if (currentSection === "memory") {
          memoryFrontierBytes += b
          if (line.trim().startsWith("- [")) memoryFrontierCount++
        } else {
          directivesBytes += b
        }
      }
    }

    // 2. Analyze Tool Schemas
    const toolDetails: { name: string; bytes: number; estimatedTokens: number }[] = []
    let totalToolSchemaBytes = 0
    for (const tool of request.tools) {
      const schemaString = JSON.stringify(tool.inputSchema ?? {})
      const toolStr = `${tool.name} ${tool.description ?? ""} ${schemaString}`
      const b = Buffer.byteLength(toolStr, "utf8")
      totalToolSchemaBytes += b
      toolDetails.push({ name: tool.name, bytes: b, estimatedTokens: Token.estimate(toolStr) })
    }

    // 3. Analyze Conversation History (messages)
    let userMessagesBytes = 0
    let syntheticDirectivesBytes = 0
    let assistantTextBytes = 0
    let assistantReasoningBytes = 0
    let toolCallsBytes = 0
    let toolResultsBytes = 0

    for (const m of request.messages) {
      if (typeof m.content === "string") {
        const text = m.content as string
        const b = Buffer.byteLength(text, "utf8")
        if (text.includes("[RIVET COGNITIVE DIRECTIVE]")) syntheticDirectivesBytes += b
        else if (m.role === "user") userMessagesBytes += b
        else assistantTextBytes += b
        continue
      }
      for (const part of m.content) {
        if (part.type === "text") {
          const b = Buffer.byteLength(part.text, "utf8")
          if (part.text.includes("[RIVET COGNITIVE DIRECTIVE]")) syntheticDirectivesBytes += b
          else if (m.role === "user") userMessagesBytes += b
          else assistantTextBytes += b
        } else if (part.type === "reasoning") {
          assistantReasoningBytes += Buffer.byteLength(part.text, "utf8")
        } else if (part.type === "tool-call") {
          const str = `${part.name} ${JSON.stringify(part.input)}`
          toolCallsBytes += Buffer.byteLength(str, "utf8")
        } else if (part.type === "tool-result") {
          const str = JSON.stringify(part.result)
          toolResultsBytes += Buffer.byteLength(str, "utf8")
        }
      }
    }

    const totalHistoryBytes =
      userMessagesBytes +
      syntheticDirectivesBytes +
      assistantTextBytes +
      assistantReasoningBytes +
      toolCallsBytes +
      toolResultsBytes

    const totalBytes =
      staticSystemBytes +
      baselineContextBytes +
      cognitiveViewBytes +
      totalToolSchemaBytes +
      totalHistoryBytes

    const totalEstimatedTokens = Token.estimate(" ".repeat(totalBytes))

    // Build serialized string for prefix comparison
    const serialized = [
      ...request.system.map((s) => s.text),
      ...request.tools.map((t) => `${t.name}:${t.description}:${JSON.stringify(t.inputSchema)}`),
      ...request.messages.map((m) => {
        if (typeof m.content === "string") return `${m.role}:${m.content}`
        return `${m.role}:${JSON.stringify(m.content)}`
      }),
    ].join("\n---\n")

    let prefixComparison: PrefixComparison | undefined
    if (previousSerialized) {
      let commonPrefixBytes = 0
      const minLen = Math.min(serialized.length, previousSerialized.length)
      while (commonPrefixBytes < minLen && serialized[commonPrefixBytes] === previousSerialized[commonPrefixBytes]) {
        commonPrefixBytes++
      }

      const linesCurr = serialized.split("\n")
      const linesPrev = new Set(previousSerialized.split("\n"))
      let sharedLines = 0
      for (const l of linesCurr) {
        if (linesPrev.has(l)) sharedLines++
      }

      const prefixMatchPercentage =
        serialized.length > 0 ? Number(((commonPrefixBytes / serialized.length) * 100).toFixed(2)) : 0
      const lineOverlapPercentage =
        linesCurr.length > 0 ? Number(((sharedLines / linesCurr.length) * 100).toFixed(2)) : 0
      const changedTokens = Token.estimate(" ".repeat(Math.abs(serialized.length - commonPrefixBytes)))
      const contextDeltaRatio =
        totalEstimatedTokens > 0 ? Number((changedTokens / totalEstimatedTokens).toFixed(4)) : 0

      let firstDivergent = "history"
      if (commonPrefixBytes < staticSystemBytes) firstDivergent = "staticSystem"
      else if (commonPrefixBytes < staticSystemBytes + baselineContextBytes) firstDivergent = "baselineContext"
      else if (commonPrefixBytes < staticSystemBytes + baselineContextBytes + cognitiveViewBytes) firstDivergent = "cognitiveView"
      else if (commonPrefixBytes < staticSystemBytes + baselineContextBytes + cognitiveViewBytes + totalToolSchemaBytes) firstDivergent = "toolSchemas"

      prefixComparison = {
        commonPrefixBytes,
        commonPrefixTokens: Token.estimate(" ".repeat(commonPrefixBytes)),
        prefixMatchPercentage,
        lineOverlapPercentage,
        contextDeltaRatio,
        firstDivergentComponent: firstDivergent,
      }
    }

    const hardRev = (request.cognitiveView as CognitiveView)?.hardRevision?.value
    const hardRevNum = typeof hardRev === "bigint" ? Number(hardRev) : Number(hardRev ?? 0)

    const decomposition: RequestTokenDecomposition = {
      totalBytes,
      totalEstimatedTokens,
      staticSystem: computeAttribution(staticSystemBytes, totalBytes),
      baselineContext: computeAttribution(baselineContextBytes, totalBytes),
      cognitiveView: {
        ...computeAttribution(cognitiveViewBytes, totalBytes),
        hardRevision: hardRevNum,
        goalBytes,
        activeClaimsCount,
        activeClaimsBytes,
        openObligationsCount,
        openObligationsBytes,
        recentEvidenceCount,
        recentEvidenceBytes,
        memoryFrontierCount,
        memoryFrontierBytes,
        directivesBytes,
      },
      toolSchemas: {
        ...computeAttribution(totalToolSchemaBytes, totalBytes),
        toolCount: request.tools.length,
        tools: toolDetails,
      },
      conversationHistory: {
        ...computeAttribution(totalHistoryBytes, totalBytes),
        messageCount: request.messages.length,
        userMessages: computeAttribution(userMessagesBytes, totalBytes),
        syntheticDirectives: computeAttribution(syntheticDirectivesBytes, totalBytes),
        assistantText: computeAttribution(assistantTextBytes, totalBytes),
        assistantReasoning: computeAttribution(assistantReasoningBytes, totalBytes),
        toolCalls: computeAttribution(toolCallsBytes, totalBytes),
        toolResults: computeAttribution(toolResultsBytes, totalBytes),
      },
    }

    return { decomposition, serialized, prefixComparison }
  }

  static record(input: {
    readonly sessionID: string
    readonly step: number
    readonly invocationID: string
    readonly model: string
    readonly provider: string
    readonly request: LLMRequest
  }): TokenLedgerEntry {
    const prev = this.previousRequests.get(input.sessionID)
    const analysis = this.analyzeRequest(input.request, prev?.serialized)

    const entry: TokenLedgerEntry = {
      id: `${input.sessionID}:${input.step}`,
      sessionID: input.sessionID,
      turn: input.step,
      invocationID: input.invocationID,
      model: input.model,
      provider: input.provider,
      timestamp: new Date().toISOString(),
      decomposition: analysis.decomposition,
      prefixComparison: analysis.prefixComparison,
    }

    this.entries.push(entry)
    this.previousRequests.set(input.sessionID, {
      serialized: analysis.serialized,
      decomposition: analysis.decomposition,
    })

    return entry
  }

  static recordUsage(
    sessionID: string,
    step: number,
    usage: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    },
  ): void {
    const entry = this.entries.find((e) => e.sessionID === sessionID && e.turn === step)
    if (entry) {
      entry.usage = {
        reportedInputTokens: usage.input,
        reportedOutputTokens: usage.output,
        cacheReadTokens: usage.cache.read,
        cacheWriteTokens: usage.cache.write,
        reasoningTokens: usage.reasoning,
      }
    }
  }
}

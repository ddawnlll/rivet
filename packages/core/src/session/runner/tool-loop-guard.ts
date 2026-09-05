import path from "path"
import { DateTime, Effect } from "effect"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import type { SessionSchema } from "../schema"
import type { EventV2 } from "../../event"
import type { Settlement } from "../../tool/registry"

export interface ToolLoopCheckResult {
  readonly shouldSuppress: boolean
  readonly suppressionMessage?: string
  readonly normalizedFingerprint: string
  readonly isDeterministic: boolean
}

export interface TrajectoryEvaluationResult {
  readonly shouldStall: boolean
  readonly stallReason?: string
  readonly warningEmitted: boolean
  readonly warningMessage?: string
}

export interface RecentActionRecord {
  readonly tool: string
  readonly target: string
  readonly normalizedFingerprint: string
  readonly outputHash: string
  readonly stateVersion: number
  readonly hardStateRevision: string
  readonly madeProgress: boolean
  readonly wasSuppressed: boolean
}

const DETERMINISTIC_INSPECTION_TOOLS = new Set([
  "read",
  "view_file",
  "grep",
  "glob",
  "find",
  "list",
  "query_epistemic_state",
  "retrieve_memory",
  "echo",
])

const MUTATING_TOOLS = new Set([
  "edit",
  "write",
  "replace_file_content",
  "write_to_file",
  "patch",
  "bash",
  "run_command",
  "exec",
])

export function normalizePath(p: string): string {
  const normalized = path.normalize(p).replace(/\\/g, "/")
  if (normalized.startsWith("./") && normalized.length > 2) {
    return normalized.slice(2)
  }
  return normalized
}

function stableToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableToolValue)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableToolValue(child)]),
  )
}

export function normalizeToolParameters(name: string, input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input
  }
  const record = { ...(input as Record<string, unknown>) }

  if (["read", "view_file", "edit", "write", "replace_file_content", "write_to_file"].includes(name)) {
    for (const key of ["path", "filePath", "target", "file"]) {
      if (typeof record[key] === "string") {
        record[key] = normalizePath(record[key] as string)
      }
    }
  } else if (name === "grep") {
    if (typeof record.pattern === "string") {
      record.pattern = (record.pattern as string).trim()
    }
    if (typeof record.query === "string") {
      record.query = (record.query as string).trim()
    }
    if (record.path === "." || record.path === "./") {
      record.path = ""
    } else if (typeof record.path === "string") {
      record.path = normalizePath(record.path as string)
    }
  } else if (["glob", "find", "list"].includes(name)) {
    for (const key of ["path", "directory", "dir"]) {
      if (record[key] === "." || record[key] === "./") {
        record[key] = ""
      } else if (typeof record[key] === "string") {
        record[key] = normalizePath(record[key] as string)
      }
    }
  } else if (["bash", "run_command", "exec"].includes(name)) {
    if (typeof record.command === "string") {
      record.command = (record.command as string).trim()
    }
  }

  return stableToolValue(record)
}

export function normalizeToolFingerprint(name: string, input: unknown): string {
  const normalizedInput = normalizeToolParameters(name, input)
  return `${name}:${JSON.stringify(normalizedInput)}`
}

function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash.toString(36)
}

function targetForTool(name: string, input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return name
  const record = input as Record<string, unknown>
  const target =
    record.path ??
    record.filePath ??
    record.target ??
    record.file ??
    record.pattern ??
    record.query ??
    record.command ??
    record.text ??
    name
  return String(target)
}

export class ToolLoopGuard {
  private workspaceVersion = 0
  private hardStateRevision = "r0"
  private readonly executedDeterministicTools = new Map<
    string,
    {
      stateVersion: number
      hardStateRevision: string
      outputSummaryHash: string
      executionCount: number
    }
  >()
  private readonly recentActions: RecentActionRecord[] = []
  private consecutiveNoProgressCount = 0
  private correctiveWarningIssued = false
  private correctiveTurnStep: number | undefined
  private suppressedActionsCount = 0
  private totalCyclesDetected = 0
  private isStalled = false
  private lastStallReason: string | undefined

  constructor(
    private readonly sessionID: SessionSchema.ID,
    private readonly maxRecentActions = 8,
    private readonly noProgressThreshold = 3,
  ) {}

  setHardStateRevision(rev: string) {
    this.hardStateRevision = rev
  }

  notifyWorkspaceMutation() {
    this.workspaceVersion++
  }

  isDeterministic(name: string): boolean {
    return DETERMINISTIC_INSPECTION_TOOLS.has(name)
  }

  checkAction(name: string, input: unknown): ToolLoopCheckResult {
    const isDet = this.isDeterministic(name)
    const normalizedFingerprint = normalizeToolFingerprint(name, input)

    if (!isDet) {
      return {
        shouldSuppress: false,
        normalizedFingerprint,
        isDeterministic: false,
      }
    }

    const previous = this.executedDeterministicTools.get(normalizedFingerprint)
    if (previous) {
      const isEpistemic = name === "query_epistemic_state" || name === "retrieve_memory"
      const stateUnchanged = isEpistemic
        ? previous.hardStateRevision === this.hardStateRevision
        : previous.stateVersion === this.workspaceVersion

      if (stateUnchanged) {
        this.suppressedActionsCount++
        this.consecutiveNoProgressCount++
        const target = targetForTool(name, input)

        this.recentActions.push({
          tool: name,
          target,
          normalizedFingerprint,
          outputHash: previous.outputSummaryHash,
          stateVersion: this.workspaceVersion,
          hardStateRevision: this.hardStateRevision,
          madeProgress: false,
          wasSuppressed: true,
        })
        if (this.recentActions.length > this.maxRecentActions) {
          this.recentActions.shift()
        }

        const suppressionMessage = [
          "Repeated action blocked.",
          "",
          "This operation has already completed with the same effective input and no relevant state change.",
          "Use the existing result or choose a materially different next action.",
        ].join("\n")

        return {
          shouldSuppress: true,
          suppressionMessage,
          normalizedFingerprint,
          isDeterministic: true,
        }
      }
    }

    return {
      shouldSuppress: false,
      normalizedFingerprint,
      isDeterministic: true,
    }
  }

  recordSettlement(name: string, input: unknown, settlement: Settlement) {
    const isDet = this.isDeterministic(name)
    const normalizedFingerprint = normalizeToolFingerprint(name, input)
    const outputSummary = settlement.receipt?.outputSummary ?? JSON.stringify(settlement.result)
    const outputHash = hashString(outputSummary)
    const target = targetForTool(name, input)

    if (MUTATING_TOOLS.has(name) && settlement.receipt?.success !== false) {
      this.workspaceVersion++
    }

    let madeProgress = false
    const previous = this.executedDeterministicTools.get(normalizedFingerprint)

    if (MUTATING_TOOLS.has(name)) {
      madeProgress = true
    } else if (!previous) {
      const isNewTargetOrOutput = !this.recentActions.some(
        (a) => a.outputHash === outputHash && a.target === target,
      )
      madeProgress = isNewTargetOrOutput
    } else {
      const stateChanged =
        name === "query_epistemic_state" || name === "retrieve_memory"
          ? previous.hardStateRevision !== this.hardStateRevision
          : previous.stateVersion !== this.workspaceVersion
      const outputChanged = previous.outputSummaryHash !== outputHash
      madeProgress = stateChanged || outputChanged
    }

    if (madeProgress) {
      this.consecutiveNoProgressCount = 0
      if (this.correctiveWarningIssued) {
        this.correctiveWarningIssued = false
        this.correctiveTurnStep = undefined
      }
    } else {
      this.consecutiveNoProgressCount++
    }

    if (isDet) {
      const prevCount = previous?.executionCount ?? 0
      this.executedDeterministicTools.set(normalizedFingerprint, {
        stateVersion: this.workspaceVersion,
        hardStateRevision: this.hardStateRevision,
        outputSummaryHash: outputHash,
        executionCount: prevCount + 1,
      })
    }

    this.recentActions.push({
      tool: name,
      target,
      normalizedFingerprint,
      outputHash,
      stateVersion: this.workspaceVersion,
      hardStateRevision: this.hardStateRevision,
      madeProgress,
      wasSuppressed: false,
    })
    if (this.recentActions.length > this.maxRecentActions) {
      this.recentActions.shift()
    }
  }

  detectCycle(): { period: number; cycle: string[] } | undefined {
    const n = this.recentActions.length
    for (const period of [1, 2, 3]) {
      if (n < period * 2) continue
      let isCycle = true
      for (let i = 0; i < period; i++) {
        const first = this.recentActions[n - period * 2 + i]
        const second = this.recentActions[n - period + i]
        if (!first || !second || first.normalizedFingerprint !== second.normalizedFingerprint) {
          isCycle = false
          break
        }
      }
      if (isCycle) {
        const recentCycleActions = this.recentActions.slice(n - period)
        const allNoProgress = recentCycleActions.every((a) => !a.madeProgress)
        if (allNoProgress) {
          return {
            period,
            cycle: recentCycleActions.map((a) => a.tool),
          }
        }
      }
    }
    return undefined
  }

  evaluateTurn(currentStep: number): TrajectoryEvaluationResult {
    if (this.isStalled) {
      return {
        shouldStall: true,
        stallReason: this.lastStallReason,
        warningEmitted: false,
      }
    }

    const cycle = this.detectCycle()
    const hasCycle = cycle !== undefined
    const exceedsThreshold = this.consecutiveNoProgressCount >= this.noProgressThreshold

    if (hasCycle) {
      this.totalCyclesDetected++
    }

    if (!hasCycle && !exceedsThreshold) {
      return {
        shouldStall: false,
        warningEmitted: false,
      }
    }

    if (!this.correctiveWarningIssued) {
      this.correctiveWarningIssued = true
      this.correctiveTurnStep = currentStep
      const warningMessage = [
        "Trajectory warning:",
        "Recent tool actions are repeating without measurable progress.",
        "Use the results already obtained and choose a materially different action,",
        "or answer the user if further execution is not justified.",
      ].join("\n")

      return {
        shouldStall: false,
        warningEmitted: true,
        warningMessage,
      }
    }

    if (this.correctiveTurnStep !== undefined && currentStep > this.correctiveTurnStep) {
      this.isStalled = true
      const reason = hasCycle
        ? `Autonomous execution stalled: repeating ${cycle.period}-action cycle (${cycle.cycle.join(" -> ")}) produced no measurable progress`
        : "Autonomous execution stalled: repeated tool actions made no observable progress"
      this.lastStallReason = reason

      return {
        shouldStall: true,
        stallReason: reason,
        warningEmitted: false,
      }
    }

    return {
      shouldStall: false,
      warningEmitted: false,
    }
  }

  getMetrics() {
    return {
      workspaceVersion: this.workspaceVersion,
      consecutiveNoProgressCount: this.consecutiveNoProgressCount,
      suppressedActionsCount: this.suppressedActionsCount,
      totalCyclesDetected: this.totalCyclesDetected,
      correctiveWarningIssued: this.correctiveWarningIssued,
      isStalled: this.isStalled,
      recentActionsCount: this.recentActions.length,
    }
  }

  deliverUserFacingStallResponse(
    events: EventV2.Interface,
    details: {
      readonly agent: (typeof SessionEvent.Step.Started.Type)["data"]["agent"]
      readonly model: (typeof SessionEvent.Step.Started.Type)["data"]["model"]
      readonly snapshot?: (typeof SessionEvent.Step.Started.Type)["data"]["snapshot"]
    },
    reason: string,
  ): Effect.Effect<void> {
    const sessionID = this.sessionID
    return Effect.gen(function* () {
      const now = yield* DateTime.now
      const assistantMessageID = SessionMessage.ID.create()
      const textID = `text-stall-${Date.now()}`
      const stallText = `Autonomous execution has been halted because recent tool actions repeated without observable progress.\n\nReason: ${reason}\n\nPlease inspect the results already obtained or provide further instructions.`

      yield* events.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: details.agent,
        model: details.model,
        snapshot: details.snapshot,
        timestamp: now,
      })
      yield* events.publish(SessionEvent.Text.Started, {
        sessionID,
        assistantMessageID,
        timestamp: now,
        textID,
      })
      yield* events.publish(SessionEvent.Text.Delta, {
        sessionID,
        assistantMessageID,
        timestamp: now,
        textID,
        delta: stallText,
      })
      yield* events.publish(SessionEvent.Text.Ended, {
        sessionID,
        assistantMessageID,
        timestamp: now,
        textID,
        text: stallText,
      })
      yield* events.publish(SessionEvent.Step.Ended, {
        sessionID,
        assistantMessageID,
        timestamp: now,
        finish: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })
    })
  }
}

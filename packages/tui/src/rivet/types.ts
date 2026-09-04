export type UiClaimStatus = "verified" | "supported" | "dirty" | "superseded" | "rejected"

export interface UiHardClaim {
  readonly id: string
  readonly proposition: string
  readonly status: UiClaimStatus
  readonly sinceRevision: string
  readonly validToRevision?: string
  readonly reason?: string
  readonly evidence: readonly string[]
  readonly sourceRefs?: readonly string[]
  readonly dependencies?: readonly string[]
  readonly scope?: string
  readonly updatedAt?: string
}

export interface UiWorkspace {
  readonly hypotheses: readonly string[]
  readonly unknowns: readonly string[]
  readonly plan: readonly string[]
  readonly candidateActions: readonly string[]
  readonly activeFocus: readonly string[]
}

export type UiMemoryKind = "procedure" | "episode" | "provisional" | "historical"

export interface UiMemoryItem {
  readonly id: string
  readonly kind: UiMemoryKind
  readonly summary: string
  readonly relevance?: "high" | "medium" | "low"
  readonly used: boolean
  readonly whyIgnored?: readonly string[]
  readonly symbols?: readonly string[]
  readonly details?: {
    readonly sourceRefs?: readonly string[]
    readonly revision?: string
    readonly horizon?: string
    readonly decision?: string
    readonly score?: number
    readonly canonicalResolution?: string
  }
}

export interface UiRelevantFile {
  readonly path: string
  readonly starred?: boolean
  readonly symbols?: readonly string[]
}

export interface UiSymbolRelation {
  readonly from: string
  readonly to: string
  readonly relation: string
}

export interface UiTestFile {
  readonly file: string
  readonly status: "passed" | "failed" | "pending" | "running"
  readonly details?: string
}

export interface UiCodeFrontier {
  readonly relevantFiles: readonly UiRelevantFile[]
  readonly relatedSymbols: readonly string[]
  readonly relations: readonly UiSymbolRelation[]
  readonly tests: readonly UiTestFile[]
  readonly uncertain: readonly string[]
}

export type UiObligationStatus = "passed" | "running" | "pending" | "failed" | "outdated"

export interface UiObligation {
  readonly id: string
  readonly description: string
  readonly status: UiObligationStatus
  readonly required: boolean
  readonly receiptId?: string
  readonly diagnostics?: string
}

export interface UiTestResult {
  readonly name: string
  readonly passed: number
  readonly failed: number
  readonly skipped?: number
  readonly status: "passed" | "failed" | "running"
  readonly durationMs?: number
  readonly rawStdout?: string
}

export type UiCompletionStatus = "ready" | "blocked" | "outdated"

export interface UiCompletionState {
  readonly status: UiCompletionStatus
  readonly message: string
  readonly remainingCount: number
  readonly taskId?: string
}

export interface UiHistoryEntry {
  readonly revision: string
  readonly summary: string
  readonly detail?: string
  readonly timestamp?: string
}

export type UiTaskPhase = "orientation" | "diagnosis" | "planning" | "implementing" | "verifying" | "idle"

export interface UiTimelinePhase {
  readonly operation: string
  readonly label: string
  readonly category: string
  readonly durationMs: number
  readonly exclusiveMs?: number
}

export interface UiFlightTimeline {
  readonly turnId: number
  readonly totalElapsedMs: number
  readonly rivetOwnedMs: number
  readonly providerTtftMs: number
  readonly providerGenerationMs: number
  readonly providerFinalizeMs: number
  readonly toolExecutionMs: number
  readonly unattributedMs: number
  readonly phases: readonly UiTimelinePhase[]
}

export interface UiActiveSpan {
  readonly operation: string
  readonly label: string
  readonly category: string
  readonly elapsedMs: number
  readonly startTimestamp: number
}

export interface UiRivetStatus {
  readonly revision: string
  readonly phase: UiTaskPhase
  readonly taskCount: number
  readonly changedFileCount: number
  readonly verifyStatus: "ready" | "pending" | "blocked" | "outdated"
  readonly cacheHitRatio?: number
  readonly totalTokens?: number
  readonly cachedTokens?: number
  readonly recallLatencyMs?: number
  readonly flightTimeline?: UiFlightTimeline
  readonly activeSpan?: UiActiveSpan
  // Runtime provenance — set once at process startup, never changes
  readonly gitBranch: string
  readonly gitSha: string
  readonly isDirty: boolean
  readonly pid: number
  readonly processStartTime: string
}

export interface UiSemanticEvent {
  readonly id: string
  readonly type: "inspected" | "changed" | "test_passed" | "test_failed" | "claim" | "verification" | "memory_ignored" | "memory_recalled" | "stale_warning"
  readonly icon: string
  readonly title: string
  readonly detail?: string
  readonly protocolDetail?: Record<string, unknown>
  readonly timestamp?: string
}

export interface UiChangedFile {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status?: string
  readonly why?: string
  readonly verified?: boolean
}

export interface UiChangesContext {
  readonly goal?: string
  readonly whyChanged?: string
  readonly verificationStatus?: readonly {
    readonly name: string
    readonly passed: boolean
  }[]
}

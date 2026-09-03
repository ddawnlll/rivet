import { Effect } from "effect"
import type { Revision, Scope } from "../types"

export type EpistemicKind =
  | "hard_claim"
  | "observation"
  | "evidence_reference"
  | "decision"
  | "verification_history"
  | "rejected_approach"
  | "procedure"
  | "episode"
  | "soft_hypothesis"
  | "soft_unknown"
  | "soft_strategy"
  | "tool_outcome"

export type AuthorityClass =
  | "authoritative"
  | "historical"
  | "provisional"
  | "rejected"
  | "non_authoritative"

export interface MemoryIngressRecord {
  readonly id: string
  readonly kind: EpistemicKind
  readonly authority: AuthorityClass
  readonly revision: Revision
  readonly scope: Scope
  readonly timestamp: number
  readonly content: string
  readonly provenance?: readonly string[]
  readonly relatedSymbols?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

export interface MemoryQuery {
  readonly prompt: string
  readonly goal: string
  readonly scope: Scope
  readonly revision: Revision
  readonly activeSymbols?: readonly string[]
  readonly activeClaims?: readonly string[]
  readonly limit?: number
}

export interface MemoryCandidate {
  readonly id: string
  readonly content: string
  readonly score: number
  readonly kind: EpistemicKind
  readonly authority: AuthorityClass
  readonly revision: Revision
  readonly scope?: Scope
  readonly relatedSymbols?: readonly string[]
  readonly metadata: Record<string, unknown>
}

export interface MemoryBackendStats {
  readonly itemCount: number
  readonly storageBytes?: number
  readonly writeTokens?: number
  readonly extractionTokens?: number
  readonly consolidationTokens?: number
  readonly recallCount?: number
}

export interface AgentMemoryBackend {
  readonly name: string
  readonly mode: "controlled" | "native"

  ingest(records: readonly MemoryIngressRecord[]): Effect.Effect<void, Error>
  recall(query: MemoryQuery): Effect.Effect<readonly MemoryCandidate[], Error>
  reset(): Effect.Effect<void, Error>
  stats(): Effect.Effect<MemoryBackendStats, Error>
}

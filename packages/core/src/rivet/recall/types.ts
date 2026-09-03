import { Effect } from "effect"
import {
  type EpistemicStatus,
  type Revision,
  type Scope,
  type WorkspaceId,
  type ClaimId,
  type EvidenceId,
} from "../types"
import { type NoesisEvent, type HardState } from "../noesis"

export type MemoryId = string & { readonly __brand: "MemoryId" }

export function createMemoryId(val?: string): MemoryId {
  if (val) return val as MemoryId
  const suffix = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10)
  return `mem_${suffix}` as MemoryId
}

export type MemoryKind =
  | "episode"
  | "claim"
  | "decision"
  | "failure"
  | "procedure"
  | "artifact"

export type RelationshipKind =
  | "SUPPORTS"
  | "CONTRADICTS"
  | "SUPERSEDES"
  | "FAILED_BECAUSE"
  | "RESOLVED_BY"
  | "TOUCHED"
  | "DEPENDS_ON"
  | "TESTED_BY"
  | "OCCURRED_IN"

export interface RecallRelationship {
  readonly targetId: MemoryId
  readonly kind: RelationshipKind
  readonly weight?: number
}

export interface RecallDocument {
  readonly id: MemoryId
  readonly kind: MemoryKind
  readonly text: string
  readonly summary?: string
  readonly workspaceId: WorkspaceId
  readonly scope: Scope
  readonly sourceRefs: readonly string[]
  readonly relatedSymbols: readonly string[]
  readonly epistemicStatus: EpistemicStatus
  readonly validFromRevision?: Revision
  readonly validToRevision?: Revision
  readonly observedAt: number
  readonly relationships?: readonly RecallRelationship[]
  readonly metadata?: Record<string, unknown>
}

export interface RecallQuery {
  readonly prompt: string
  readonly goal: string
  readonly scope: Scope
  readonly revision: Revision
  readonly activeSymbols: readonly string[]
  readonly activeClaims: readonly string[]
  readonly limit: number
}

export interface RecallChannelScores {
  readonly semanticScore: number
  readonly lexicalScore: number
  readonly graphScore: number
  readonly temporalScore: number
  readonly scopeScore: number
  readonly compositeScore: number
}

export interface RecallCandidate {
  readonly document: RecallDocument
  readonly scores: RecallChannelScores
}

export interface RecallSource {
  readonly hardState?: HardState
  readonly events?: readonly NoesisEvent[]
  readonly documents?: readonly RecallDocument[]
}

export class RecallError {
  readonly _tag = "RecallError"
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export interface RecallStore {
  readonly index: (documents: readonly RecallDocument[]) => Effect.Effect<void, RecallError>
  readonly remove: (ids: readonly MemoryId[]) => Effect.Effect<void, RecallError>
  readonly recall: (query: RecallQuery) => Effect.Effect<readonly RecallCandidate[], RecallError>
  readonly rebuild: (source: RecallSource) => Effect.Effect<void, RecallError>
  readonly count: () => Effect.Effect<number, RecallError>
}

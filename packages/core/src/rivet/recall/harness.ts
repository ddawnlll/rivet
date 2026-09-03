import { Effect } from "effect"
import {
  type HardState,
} from "../noesis"
import {
  type MemoryFrontier,
  type MemoryRef,
  type Revision,
  Scope,
} from "../types"
import {
  type RecallCandidate,
  type RecallQuery,
  type RecallStore,
  RecallError,
} from "./types"

export interface RecallAdmissionContext {
  readonly hardState: HardState
  readonly recallStore: RecallStore
  readonly userPrompt: string
  readonly goalDescription: string
  readonly repositoryId: string
  readonly focusSymbols?: readonly string[]
  readonly limit?: number
}

/**
 * AutomaticRecallAdmissionHook executes proactive associative recall during prompt admission
 * and applies the Noesis Read-Time Validity Barrier to ensure zero leakage of stale authority.
 */
export class AutomaticRecallAdmissionHook {
  /**
   * Executes proactive recall and filters candidates into a hardened MemoryFrontier.
   */
  static admitRecall(
    ctx: RecallAdmissionContext,
  ): Effect.Effect<MemoryFrontier, RecallError> {
    return Effect.gen(function* () {
      const activeClaimIds = Array.from(ctx.hardState.claims.keys())
      const query: RecallQuery = {
        prompt: ctx.userPrompt,
        goal: ctx.goalDescription,
        scope: Scope.global(ctx.repositoryId, ctx.hardState.revision),
        revision: ctx.hardState.revision,
        activeSymbols: ctx.focusSymbols ?? [],
        activeClaims: activeClaimIds,
        limit: ctx.limit ?? 10,
      }

      const candidates = yield* ctx.recallStore.recall(query)

      const active: MemoryRef[] = []
      const episodic: MemoryRef[] = []
      const procedural: MemoryRef[] = []
      const rejected: MemoryRef[] = []
      const pinned: MemoryRef[] = []
      const relatedSymbols: string[] = [...(ctx.focusSymbols ?? [])]

      // Filter each candidate through the Read-Time Validity Barrier
      for (const candidate of candidates) {
        const doc = candidate.document
        const status = doc.epistemicStatus

        // Check for symbols to attach to relatedSymbols
        for (const sym of doc.relatedSymbols) {
          if (!relatedSymbols.includes(sym)) relatedSymbols.push(sym)
        }

        // 1. REJECTED & FAILURES -> Failure Avoidance
        if (doc.kind === "failure" || status === "rejected" || status === "invalidated") {
          rejected.push({
            id: doc.id,
            type: "failure",
            summary: doc.summary ?? doc.text,
            status,
            revision: doc.validFromRevision,
          })
          continue
        }

        // 2. PROCEDURAL & DECISIONS -> Procedural Context
        if (doc.kind === "procedure" || doc.kind === "decision") {
          procedural.push({
            id: doc.id,
            type: "claim",
            summary: doc.summary ?? doc.text,
            status,
            revision: doc.validFromRevision,
          })
          continue
        }

        // 3. STALE / SUPERSEDED / HISTORICAL -> History Only (No current operational authority)
        if (status === "superseded" || status === "stale" || status === "dirty" || doc.kind === "episode") {
          // Skip current turn's own goal to only surface genuine prior episodes
          if (doc.kind === "episode" && (doc.text.trim() === ctx.goalDescription.trim() || doc.text.trim() === ctx.userPrompt.trim())) {
            continue
          }
          episodic.push({
            id: doc.id,
            type: doc.kind === "episode" ? "observation" : "claim",
            summary: doc.kind === "episode" ? `Relevant prior episode: ${doc.text}` : doc.summary ?? doc.text,
            status,
            revision: doc.validFromRevision,
          })
          continue
        }

        // 4. ACTIVE VALID CLAIMS -> Active Frontier
        if (status === "supported" || status === "verified") {
          // If it's a historical verification from an older revision, note that historical != current
          if (doc.validFromRevision && doc.validFromRevision.value < ctx.hardState.revision.value) {
            episodic.push({
              id: doc.id,
              type: "claim",
              summary: `${doc.summary ?? doc.text} (Historical verification at ${doc.validFromRevision.toString()} - Note: Historical verification != current verification)`,
              status,
              revision: doc.validFromRevision,
            })
          } else {
            active.push({
              id: doc.id,
              type: "claim",
              summary: doc.summary ?? doc.text,
              status,
              revision: doc.validFromRevision,
            })
          }
        }
      }

      return {
        revision: ctx.hardState.revision,
        pinned,
        active: active.slice(0, 8),
        episodic: episodic.slice(0, 8),
        procedural: procedural.slice(0, 8),
        rejected: rejected.slice(0, 8),
        relatedSymbols,
      }
    })
  }
}

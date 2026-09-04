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
  readonly recallStore?: RecallStore
  readonly userPrompt: string
  readonly goalDescription: string
  readonly repositoryId?: string
  readonly scope?: Scope
  readonly revision?: Revision
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
    storeOrCtx: RecallStore | RecallAdmissionContext,
    maybeCtx?: Omit<RecallAdmissionContext, "recallStore">,
  ): Effect.Effect<MemoryFrontier, RecallError> {
    return Effect.gen(function* () {
      let store: RecallStore
      let ctx: RecallAdmissionContext

      if (maybeCtx !== undefined) {
        store = storeOrCtx as RecallStore
        ctx = { ...maybeCtx, recallStore: store }
      } else {
        ctx = storeOrCtx as RecallAdmissionContext
        if (!ctx.recallStore) {
          return yield* Effect.fail(new RecallError("RecallStore is required in RecallAdmissionContext"))
        }
        store = ctx.recallStore
      }

      const activeClaimIds = Array.from(ctx.hardState.claims.keys())
      const repoId = ctx.repositoryId ?? ctx.scope?.repository ?? "repo"
      const revision = ctx.revision ?? ctx.hardState.revision

      const query: RecallQuery = {
        prompt: ctx.userPrompt,
        goal: ctx.goalDescription,
        scope: ctx.scope ?? Scope.global(repoId, revision),
        revision,
        activeSymbols: ctx.focusSymbols ?? [],
        activeClaims: activeClaimIds,
        limit: ctx.limit ?? 10,
      }

      const candidates = yield* store.recall(query)

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

          // Unpack structured episode relationships into respective frontiers
          if (doc.kind === "episode" && doc.metadata?.structuredEpisode) {
            const ep = doc.metadata.structuredEpisode as any
            if (Array.isArray(ep.decisions)) {
              for (const dec of ep.decisions) {
                if (!procedural.some((p) => p.id === dec.claimId)) {
                  procedural.push({
                    id: dec.claimId,
                    type: "claim",
                    summary: `Previous decision: ${dec.proposition}`,
                    status: "supported",
                    revision: doc.validFromRevision,
                  })
                }
              }
            }
            if (Array.isArray(ep.rejectedApproaches)) {
              for (const rej of ep.rejectedApproaches) {
                if (!rejected.some((r) => r.id === rej.claimId)) {
                  rejected.push({
                    id: rej.claimId,
                    type: "failure",
                    summary: `Previous rejected approach: ${rej.reason}`,
                    status: "rejected",
                    revision: doc.validFromRevision,
                  })
                }
              }
            }
          }
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

      // If no memory candidates were matched but HardState has active claims, populate active frontier from canonical claims
      if (active.length === 0 && episodic.length === 0 && procedural.length === 0 && ctx.hardState.claims.size > 0) {
        for (const [claimId, claim] of ctx.hardState.claims) {
          if (claim.status === "supported" || claim.status === "verified") {
            active.push({
              id: claimId,
              type: "claim",
              summary: claim.proposition,
              status: claim.status,
              revision: claim.validFromRevision,
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

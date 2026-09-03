import { Effect } from "effect"
import type { HardState } from "../noesis"
import type { MemoryFrontier, MemoryRef } from "../types"
import type { AgentMemoryBackend, MemoryCandidate, MemoryQuery } from "./agent-memory-backend"

export interface AgentRecallAdmissionContext {
  readonly hardState: HardState
  readonly backend: AgentMemoryBackend
  readonly query: MemoryQuery
}

/**
 * AgentMemoryValidityBarrier enforces strict epistemic quarantine on raw memory candidates
 * retrieved from external memory backends (Hindsight / agentmemory).
 *
 * Invariants:
 * 1. Memory != Evidence
 * 2. Memory != Verification
 * 3. Memory != Current Truth
 * 4. Memory Rank != Authority
 * 5. SoftWorkspace hypothesis != HardState
 */
export class AgentMemoryValidityBarrier {
  static admitRecall(ctx: AgentRecallAdmissionContext): Effect.Effect<MemoryFrontier, Error> {
    return Effect.gen(function* () {
      const candidates = yield* ctx.backend.recall(ctx.query)

      const active: MemoryRef[] = []
      const episodic: MemoryRef[] = []
      const procedural: MemoryRef[] = []
      const rejected: MemoryRef[] = []
      const relatedSymbols: string[] = [...(ctx.query.activeSymbols ?? [])]

      for (const candidate of candidates) {
        if (candidate.relatedSymbols) {
          for (const sym of candidate.relatedSymbols) {
            if (!relatedSymbols.includes(sym)) relatedSymbols.push(sym)
          }
        }

        // 1. REJECTED / FAILURES -> Failure Avoidance Frontier
        if (candidate.authority === "rejected" || candidate.kind === "rejected_approach") {
          rejected.push({
            id: candidate.id as any,
            type: "failure",
            summary: `[FAILURE AVOIDANCE] ${candidate.content}`,
            status: "rejected",
            revision: candidate.revision,
          })
          continue
        }

        // 2. PROVISIONAL SOFTWORKSPACE HYPOTHESES -> Strictly quarantined from HardState
        if (candidate.authority === "provisional" || candidate.kind === "soft_hypothesis" || candidate.kind === "soft_unknown") {
          episodic.push({
            id: candidate.id as any,
            type: "claim",
            summary: `[PROVISIONAL HYPOTHESIS - NOT HARD FACT] ${candidate.content}`,
            status: "provisional" as any,
            revision: candidate.revision,
          })
          continue
        }

        // 3. SUPERSEDED / HISTORICAL ONLY -> Quarantined with explicit warning
        if (candidate.authority === "historical" || candidate.metadata.epistemicStatus === "superseded") {
          episodic.push({
            id: candidate.id as any,
            type: "observation",
            summary: `[SUPERSEDED / HISTORICAL - DO NOT USE AS ACTIVE TRUTH] ${candidate.content}`,
            status: "superseded",
            revision: candidate.revision,
          })
          continue
        }

        // 4. PROCEDURAL / DECISIONS -> Procedural Context
        if (candidate.kind === "procedure" || candidate.kind === "decision") {
          procedural.push({
            id: candidate.id as any,
            type: "claim",
            summary: candidate.content,
            status: "supported",
            revision: candidate.revision,
          })
          continue
        }

        // 5. AUTHORITATIVE OBSERVATIONS / HARD CLAIMS
        if (candidate.authority === "authoritative") {
          active.push({
            id: candidate.id as any,
            type: candidate.kind === "hard_claim" ? "claim" : "observation",
            summary: candidate.content,
            status: "verified",
            revision: candidate.revision,
          })
          continue
        }

        // Default fallback: Episodic history
        episodic.push({
          id: candidate.id as any,
          type: "observation",
          summary: `[PRIOR EPISODE] ${candidate.content}`,
          status: "supported",
          revision: candidate.revision,
        })
      }

      return {
        active,
        episodic,
        procedural,
        rejected,
        pinned: [],
        relatedSymbols,
        version: 1,
        revision: ctx.query.revision,
      }
    })
  }
}

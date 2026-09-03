import { Effect } from "effect"
import { Noesis, type HardState, type TaskPhase } from "../noesis"
import type { MemoryFrontier, MemoryRef } from "../types"
import type { AgentMemoryBackend, MemoryQuery } from "./agent-memory-backend"

export interface AgentRecallAdmissionContext {
  readonly hardState: HardState
  readonly backend: AgentMemoryBackend
  readonly query: MemoryQuery
  readonly taskPhase?: TaskPhase
}

export function inferTaskPhase(query: MemoryQuery): TaskPhase {
  const text = `${query.prompt} ${query.goal}`.toLowerCase()
  if (text.includes("orient") || text.includes("overview") || text.includes("onboard") || text.includes("explain repo") || text.includes("explain architecture")) {
    return "orientation"
  }
  if (text.includes("plan") || text.includes("rfc") || text.includes("roadmap") || text.includes("design spec")) {
    return "planning"
  }
  if (text.includes("brainstorm") || text.includes("hypothes") || text.includes("explore possible")) {
    return "brainstorming"
  }
  if (text.includes("verify") || text.includes("compaction suite") || text.includes("skip test") || text.includes("check verification")) {
    return "verification"
  }
  if (
    text.includes("diagnos") ||
    text.includes("investigat") ||
    text.includes("timeout") ||
    text.includes("504") ||
    text.includes("leak") ||
    text.includes("starvat") ||
    text.includes("alert") ||
    text.includes("error") ||
    text.includes("why") ||
    text.includes("bug")
  ) {
    return "diagnosis"
  }
  return "implementation"
}

/**
 * AgentMemoryValidityBarrier delegates candidate admission to Noesis Cognitive Admission Policy.
 *
 * Invariants Enforced:
 * 1. Retrievable != Admissible
 * 2. Memory engine cannot report authority; authority is derived strictly via canonical sourceRefs in HardState.
 * 3. Memory candidates never mint "verified" status.
 * 4. SoftWorkspace provisional hypotheses are strictly SUPPRESSED during active diagnosis & implementation.
 * 5. Long-term memory (H2/H3) requires stronger evidence or matching active symbols.
 */
export class AgentMemoryValidityBarrier {
  static admitRecall(ctx: AgentRecallAdmissionContext): Effect.Effect<MemoryFrontier, Error> {
    return Effect.gen(function* () {
      const candidates = yield* ctx.backend.recall(ctx.query)
      const taskPhase = ctx.taskPhase ?? inferTaskPhase(ctx.query)

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

        const candidateSourceRefs = candidate.metadata?.sourceRefs as string[] | undefined

        // Delegate to Noesis Cognitive Admission Policy
        const decision = Noesis.admitMemory(
          {
            id: candidate.id,
            content: candidate.content,
            score: candidate.score,
            sourceRefs: candidateSourceRefs ?? [],
            proposedKind: candidate.kind,
            revision: candidate.revision,
            scope: candidate.scope,
            relatedSymbols: candidate.relatedSymbols,
            metadata: candidate.metadata,
          },
          {
            hardState: ctx.hardState,
            taskPhase,
            currentRevision: ctx.query.revision,
            scope: ctx.query.scope,
            activeSymbols: ctx.query.activeSymbols,
            userPrompt: ctx.query.prompt,
            goalDescription: ctx.query.goal,
          }
        )

        // Dispatch according to admission decision
        switch (decision.kind) {
          case "ADMIT_CURRENT":
            active.push(decision.ref)
            break
          case "ADMIT_PROCEDURAL":
            procedural.push(decision.ref)
            break
          case "ADMIT_FAILURE_AVOIDANCE":
            rejected.push(decision.ref)
            break
          case "ADMIT_HISTORICAL":
            episodic.push(decision.ref)
            break
          case "SUPPRESS":
          case "QUARANTINE":
            // Suppressed by Noesis Cognitive Admission Policy
            break
        }
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

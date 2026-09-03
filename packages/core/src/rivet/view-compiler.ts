import {
  SoftWorkspace,
  type ClaimRecord,
  type ContradictionRecord,
  type HardState,
  type RejectionRecord,
} from "./noesis"
import {
  createSessionId,
  type EpistemicStatus,
  type EvidenceId,
  type MemoryFrontier,
  type ObligationId,
  type PremiseConflict,
  type Revision,
  Scope,
} from "./types"
import { ValidityEngine } from "./validity"

export type RepresentationMode = "RAW_TEXT" | "TRIPLES" | "PATHS" | "HYBRID"

export interface KnowledgeTriple {
  readonly subject: string
  readonly predicate: string
  readonly object: string
}

export function formatTriple(t: KnowledgeTriple): string {
  return `(${t.subject}, ${t.predicate}, ${t.object})`
}

export interface ProvenancePath {
  readonly steps: readonly string[]
}

export function formatProvenancePath(p: ProvenancePath): string {
  return p.steps.join(" -> ")
}

export interface OmittedSummary {
  readonly deferredTrees: number
  readonly tokenBudget: number
  readonly omittedClaimsCount: number
  readonly omittedEvidenceCount: number
  readonly omittedSignalsCount: number
}

export interface CompilationContext {
  readonly hardState: HardState
  readonly softWorkspace?: SoftWorkspace
  readonly goalDescription: string
  readonly repositoryId: string
  readonly relevantFiles?: readonly string[]
  readonly repositorySignals?: readonly string[]
  readonly userPrompt?: string
  readonly currentEnvironmentLanguage?: string
  readonly focusSymbols?: readonly string[]
  readonly memoryFrontier?: MemoryFrontier
  readonly scope?: Scope
  readonly tokenBudget: number
  readonly mode: RepresentationMode
  readonly deferredTreesCount?: number
}

export interface CompiledViewPayload {
  readonly hardRevision: Revision
  readonly workspaceRevision: Revision
  readonly repositoryId: string
  readonly goalDescription: string
  readonly activeFocus: readonly string[]
  readonly hypotheses: readonly string[]
  readonly unknowns: readonly string[]
  readonly candidateActions: readonly string[]
  readonly activeClaims: readonly ClaimRecord[]
  readonly historicalClaims: readonly ClaimRecord[]
  readonly dirtyClaims: readonly ClaimRecord[]
  readonly contradictions: readonly ContradictionRecord[]
  readonly rejectedClaims: readonly RejectionRecord[]
  readonly openObligations: readonly [ObligationId, string, Scope][]
  readonly recentEvidence: readonly [EvidenceId, string, string][]
  readonly relevantFiles: readonly string[]
  readonly repositorySignals: readonly string[]
  readonly premiseConflicts: readonly PremiseConflict[]
  readonly memoryFrontier: MemoryFrontier
  readonly omittedSummary: OmittedSummary
  readonly triples: readonly KnowledgeTriple[]
  readonly provenancePaths: readonly ProvenancePath[]
  readonly mode: RepresentationMode
}

type ResolvedCompilationContext = CompilationContext & {
  readonly softWorkspace: SoftWorkspace
  readonly relevantFiles: readonly string[]
  readonly repositorySignals: readonly string[]
}

export class CognitiveViewCompiler {
  static compile(ctxInput: CompilationContext): CompiledViewPayload {
    const softWorkspace = ctxInput.softWorkspace ?? new SoftWorkspace(createSessionId(), ctxInput.hardState.revision)
    const ctx: ResolvedCompilationContext = {
      ...ctxInput,
      softWorkspace,
      relevantFiles: ctxInput.relevantFiles ?? [],
      repositorySignals: ctxInput.repositorySignals ?? [],
    }

    // Stage 1: Deterministic Eligibility & Read-Time Validity Barrier
    const {
      eligibleClaims,
      historicalClaims,
      dirtyClaims,
      eligibleObligations,
      eligibleEvidence,
    } = this.stageEligibilityFilter(ctx)

    // Stage 2: Provenance Path Expansion
    const { triples, provenancePaths } = this.stageProvenanceExpansion(
      ctx,
      eligibleClaims,
      eligibleObligations,
      eligibleEvidence,
    )

    // Stage 3 & 4: Relevance Ranking & Semantic Compression
    const { compressedClaims, compressedEvidence, compressedSignals, omitted } =
      this.stageRelevanceAndCompression(
        ctx,
        eligibleClaims,
        eligibleEvidence,
        ctx.repositorySignals,
      )

    // Stage 5: Contradiction and Rejected Beliefs Inclusion
    const { contradictions, rejectedClaims } = this.stageContradictionInclusion(ctx)

    // Stage 6: Premise Conflict Detection & Proactive Memory Frontier Compilation
    const premiseConflict = ctx.userPrompt
      ? ValidityEngine.detectPremiseConflict(
          ctx.hardState,
          ctx.userPrompt,
          ctx.currentEnvironmentLanguage,
        )
      : null

    const premiseConflicts: PremiseConflict[] = [
      ...ctx.hardState.premiseConflicts,
      ...(premiseConflict ? [premiseConflict] : []),
    ]

    const memoryFrontier =
      ctx.memoryFrontier ??
      ValidityEngine.compileMemoryFrontier(
        ctx.hardState,
        ctx.focusSymbols ?? [],
      )

    // Stage 7: Assemble compiled payload (Zero-copy pass-through)
    return {
      hardRevision: ctx.hardState.revision,
      workspaceRevision: ctx.softWorkspace.baseHardRevision,
      repositoryId: ctx.repositoryId,
      goalDescription: ctx.goalDescription,
      activeFocus: ctx.softWorkspace.activeFocus,
      hypotheses: ctx.softWorkspace.hypotheses,
      unknowns: ctx.softWorkspace.unknowns,
      candidateActions: ctx.softWorkspace.candidateActions,
      activeClaims: compressedClaims,
      historicalClaims,
      dirtyClaims,
      contradictions,
      rejectedClaims,
      openObligations: eligibleObligations,
      recentEvidence: compressedEvidence,
      relevantFiles: ctx.relevantFiles,
      repositorySignals: compressedSignals,
      premiseConflicts,
      memoryFrontier,
      omittedSummary: omitted,
      triples,
      provenancePaths,
      mode: ctx.mode,
    }
  }

  private static stageEligibilityFilter(ctx: ResolvedCompilationContext) {
    // Enforce Read-Time Validity Barrier: DIRTY, STALE, and SUPERSEDED claims have ZERO operational authority
    const barrier = ValidityEngine.applyReadTimeBarrier(ctx.hardState, ctx.scope)

    const eligibleObligations: [ObligationId, string, Scope][] = []
    for (const [id, desc] of ctx.hardState.obligations) {
      const scope =
        ctx.hardState.obligationScopes.get(id) ??
        Scope.global(ctx.repositoryId, ctx.hardState.revision)
      eligibleObligations.push([id, desc, scope])
    }
    eligibleObligations.sort((a, b) => a[0].localeCompare(b[0]))

    const eligibleEvidence: [EvidenceId, string, string][] = []
    for (const [id, summary] of ctx.hardState.evidence) {
      eligibleEvidence.push([id, "observation", summary])
    }
    eligibleEvidence.sort((a, b) => b[0].localeCompare(a[0]))

    return {
      eligibleClaims: [...barrier.activeClaims],
      historicalClaims: [...barrier.historicalClaims],
      dirtyClaims: [...barrier.dirtyClaims],
      eligibleObligations,
      eligibleEvidence,
    }
  }

  private static stageProvenanceExpansion(
    ctx: ResolvedCompilationContext,
    claims: readonly ClaimRecord[],
    obligations: readonly [ObligationId, string, Scope][],
    evidence: readonly [EvidenceId, string, string][],
  ) {
    const triples: KnowledgeTriple[] = []
    const provenancePaths: ProvenancePath[] = []

    for (const [obId, desc, scope] of obligations) {
      triples.push({
        subject: `Goal#${ctx.repositoryId}`,
        predicate: "requires_obligation",
        object: `Obligation#${obId}`,
      })
      triples.push({
        subject: `Obligation#${obId}`,
        predicate: "has_scope",
        object: `Scope(${scope.repository}@${scope.revision})`,
      })
      triples.push({
        subject: `Obligation#${obId}`,
        predicate: "description",
        object: desc,
      })

      provenancePaths.push({
        steps: [
          `Goal(${ctx.goalDescription})`,
          `Obligation(${obId}: ${desc})`,
          `Scope(${scope.repository}@${scope.revision})`,
        ],
      })
    }

    const evidenceMap = new Map<EvidenceId, [string, string]>()
    for (const [id, src, sum] of evidence) {
      evidenceMap.set(id, [src, sum])
    }

    for (const claim of claims) {
      triples.push({
        subject: `Claim#${claim.id}`,
        predicate: "epistemic_status",
        object: claim.status,
      })
      triples.push({
        subject: `Claim#${claim.id}`,
        predicate: "proposition",
        object: claim.proposition,
      })

      for (const evidId of (claim.supportingEvidence ?? [])) {
        triples.push({
          subject: `Claim#${claim.id}`,
          predicate: "supported_by",
          object: `Evidence#${evidId}`,
        })

        const evid = evidenceMap.get(evidId)
        if (evid) {
          provenancePaths.push({
            steps: [
              `Claim(${claim.id}: ${claim.proposition})`,
              `Status(${claim.status})`,
              `Evidence(${evidId}: ${evid[1]})`,
              `Source(${evid[0]})`,
            ],
          })
        }
      }
    }

    for (const [claimId, cRec] of ctx.hardState.contradictions) {
      triples.push({
        subject: `Claim#${claimId}`,
        predicate: "contradicted_by",
        object: JSON.stringify(cRec.contradictedBy),
      })
      triples.push({
        subject: `Claim#${claimId}`,
        predicate: "contradiction_reason",
        object: cRec.reason,
      })
    }

    return { triples, provenancePaths }
  }

  private static stageRelevanceAndCompression(
    ctx: ResolvedCompilationContext,
    claims: ClaimRecord[],
    evidence: [EvidenceId, string, string][],
    signals: readonly string[],
  ) {
    const goalLower = ctx.goalDescription.toLowerCase()
    const focusLower = ctx.softWorkspace.activeFocus.map((f) => f.toLowerCase())

    claims.sort((a, b) => {
      let scoreA = 0
      let scoreB = 0
      const propA = a.proposition.toLowerCase()
      const propB = b.proposition.toLowerCase()

      if (focusLower.some((f) => propA.includes(f))) scoreA += 50
      if (focusLower.some((f) => propB.includes(f))) scoreB += 50

      if (goalLower.split(/\s+/).some((w) => w.length > 3 && propA.includes(w))) scoreA += 30
      if (goalLower.split(/\s+/).some((w) => w.length > 3 && propB.includes(w))) scoreB += 30

      if (a.status === "verified") scoreA += 20
      if (b.status === "verified") scoreB += 20

      return scoreB - scoreA
    })

    const maxClaims = Math.max(5, Math.min(30, Math.floor(ctx.tokenBudget / 200)))
    const totalClaims = claims.length
    const compressedClaims = claims.slice(0, maxClaims)
    const omittedClaimsCount = Math.max(0, totalClaims - compressedClaims.length)

    const maxEvidence = Math.max(3, Math.min(15, Math.floor(ctx.tokenBudget / 300)))
    const totalEvidence = evidence.length
    const compressedEvidence = evidence.slice(0, maxEvidence)
    const omittedEvidenceCount = Math.max(0, totalEvidence - compressedEvidence.length)

    const maxSignals = 10
    const totalSignals = signals.length
    const compressedSignals = signals.slice(0, maxSignals)
    const omittedSignalsCount = Math.max(0, totalSignals - compressedSignals.length)

    const omitted: OmittedSummary = {
      deferredTrees: ctx.deferredTreesCount ?? 0,
      tokenBudget: ctx.tokenBudget,
      omittedClaimsCount,
      omittedEvidenceCount,
      omittedSignalsCount,
    }

    return { compressedClaims, compressedEvidence, compressedSignals, omitted }
  }

  private static stageContradictionInclusion(ctx: CompilationContext) {
    const contradictions = Array.from(ctx.hardState.contradictions.values()).sort((a, b) =>
      a.claimId.localeCompare(b.claimId),
    )
    const rejectedClaims = Array.from(ctx.hardState.rejectedClaims.values()).sort((a, b) =>
      a.claimId.localeCompare(b.claimId),
    )
    return { contradictions, rejectedClaims }
  }

  static render(payload: CompiledViewPayload): string {
    switch (payload.mode) {
      case "RAW_TEXT":
        return this.renderRawText(payload)
      case "TRIPLES":
        return this.renderTriples(payload)
      case "PATHS":
        return this.renderPaths(payload)
      case "HYBRID":
        return this.renderHybrid(payload)
    }
  }

  private static renderRawText(p: CompiledViewPayload): string {
    const lines: string[] = []
    lines.push("=== COGNITIVE STATE (RAW TEXT) ===")
    lines.push(`Repository: ${p.repositoryId} | Revision: ${p.hardRevision}`)
    lines.push(`Goal: ${p.goalDescription}\n`)

    if (p.premiseConflicts.length > 0) {
      lines.push("--- Premise Conflicts ---")
      for (const pc of p.premiseConflicts) {
        lines.push(`- Conflict: User premise "${pc.userPremise}" conflicts with "${pc.currentValidState}"`)
      }
    }

    if (p.activeFocus.length > 0) {
      lines.push(`Active Focus: ${p.activeFocus.join(", ")}`)
    }
    if (p.hypotheses.length > 0) {
      lines.push(`Hypotheses: ${p.hypotheses.join("; ")}`)
    }
    if (p.unknowns.length > 0) {
      lines.push(`Unknowns: ${p.unknowns.join("; ")}`)
    }

    lines.push("\n--- Active Valid Claims ---")
    for (const c of p.activeClaims) {
      lines.push(
        `- [${c.id}] ${c.status}: ${c.proposition} (support: ${JSON.stringify(c.supportingEvidence)})`,
      )
    }

    if (p.contradictions.length > 0) {
      lines.push("\n--- Contradictions ---")
      for (const c of p.contradictions) {
        lines.push(
          `- Contradiction on [${c.claimId}]: ${c.reason} (contradicted by: ${JSON.stringify(c.contradictedBy)})`,
        )
      }
    }

    if (p.rejectedClaims.length > 0) {
      lines.push("\n--- Rejected Beliefs ---")
      for (const r of p.rejectedClaims) {
        lines.push(
          `- Rejected [${r.claimId}]: ${r.reason} (evidence: ${JSON.stringify(r.evidence)})`,
        )
      }
    }

    lines.push("\n--- Open Obligations ---")
    for (const [id, desc, scope] of p.openObligations) {
      lines.push(`- [${id}] ${desc} (scope: ${scope.repository}@${scope.revision})`)
    }

    if (p.recentEvidence.length > 0) {
      lines.push("\n--- Recent Evidence ---")
      for (const [id, src, sum] of p.recentEvidence) {
        lines.push(`- [${id}] ${src}: ${sum}`)
      }
    }

    if (p.relevantFiles.length > 0) {
      lines.push(`\nRelevant Files: ${p.relevantFiles.join(", ")}`)
    }

    lines.push(
      `\nOmitted Summary: ${p.omittedSummary.deferredTrees} deferred trees, token budget: ${p.omittedSummary.tokenBudget}`,
    )
    return lines.join("\n")
  }

  private static renderTriples(p: CompiledViewPayload): string {
    const lines: string[] = []
    lines.push("# COGNITIVE VIEW (TRIPLES MODE - KNOWLEDGE GRAPH)")
    lines.push(`# Revision: ${p.hardRevision} | Repo: ${p.repositoryId}\n`)

    for (const triple of p.triples) {
      lines.push(formatTriple(triple))
    }

    lines.push(`\n# (Meta#Omitted, deferred_trees, ${p.omittedSummary.deferredTrees})`)
    lines.push(`# (Meta#Omitted, token_budget, ${p.omittedSummary.tokenBudget})`)
    return lines.join("\n")
  }

  private static renderPaths(p: CompiledViewPayload): string {
    const lines: string[] = []
    lines.push("# COGNITIVE VIEW (PATHS MODE - PROVENANCE GRAPH)")
    lines.push(`# Revision: ${p.hardRevision} | Repo: ${p.repositoryId}\n`)

    for (const path of p.provenancePaths) {
      lines.push(formatProvenancePath(path))
    }

    lines.push(
      `\n[OmittedSummary: deferred_trees=${p.omittedSummary.deferredTrees}, token_budget=${p.omittedSummary.tokenBudget}]`,
    )
    return lines.join("\n")
  }

  private static renderHybrid(p: CompiledViewPayload): string {
    return [
      "```yaml",
      `cognitive_view:`,
      `  hard_revision: "${p.hardRevision}"`,
      `  repository_id: "${p.repositoryId}"`,
      `  goal_description: "${p.goalDescription}"`,
      `  active_focus: ${JSON.stringify(p.activeFocus)}`,
      `  hypotheses: ${JSON.stringify(p.hypotheses)}`,
      `  active_claims_count: ${p.activeClaims.length}`,
      `  open_obligations_count: ${p.openObligations.length}`,
      `  contradictions_count: ${p.contradictions.length}`,
      `  premise_conflicts_count: ${p.premiseConflicts.length}`,
      `  omitted_summary:`,
      `    deferred_trees: ${p.omittedSummary.deferredTrees}`,
      `    token_budget: ${p.omittedSummary.tokenBudget}`,
      "```",
    ].join("\n")
  }
}

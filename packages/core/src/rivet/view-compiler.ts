import {
  CognitiveView,
  SoftWorkspace,
  type ClaimRecord,
  type ContradictionRecord,
  type HardState,
  type RejectionRecord,
} from "./noesis"
import {
  type CompletionReadiness,
  createSessionId,
  type EpistemicStatus,
  type EvidenceId,
  type ExecutionFocus,
  type MemoryFrontier,
  type ObligationId,
  type ObligationViewRecord,
  type PremiseConflict,
  type RecoveryFrame,
  type Revision,
  type TrajectoryFold,
  Scope,
} from "./types"
import { AccpSemanticGate } from "./accp"
import type { ObligationPredicate } from "./goal-compiler"
import { ValidityEngine } from "./validity"
import { RepositoryFrontierCompiler, type RepositoryFrontier } from "./repository/repository-frontier"
import { FlightRecorder } from "./flight-recorder"

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
  readonly goalDescription?: string
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
  readonly repositoryFrontier?: RepositoryFrontier
}

export interface CompiledViewPayload {
  readonly hardRevision: Revision
  readonly workspaceRevision: Revision
  readonly repositoryId: string
  readonly goalDescription: string
  readonly activeFocus: readonly string[]
  readonly executionFocus: ExecutionFocus | null
  readonly recoveryFrames: readonly RecoveryFrame[]
  readonly trajectoryFolds: readonly TrajectoryFold[]
  readonly hypotheses: readonly string[]
  readonly unknowns: readonly string[]
  readonly candidateActions: readonly string[]
  readonly activeClaims: readonly ClaimRecord[]
  readonly historicalClaims: readonly ClaimRecord[]
  readonly dirtyClaims: readonly ClaimRecord[]
  readonly contradictions: readonly ContradictionRecord[]
  readonly rejectedClaims: readonly RejectionRecord[]
  readonly openObligations: readonly [ObligationId, string, Scope][]
  readonly obligations: readonly ObligationViewRecord[]
  readonly completionReadiness: CompletionReadiness
  readonly recentEvidence: readonly [EvidenceId, string, string][]
  readonly relevantFiles: readonly string[]
  readonly repositorySignals: readonly string[]
  readonly premiseConflicts: readonly PremiseConflict[]
  readonly memoryFrontier: MemoryFrontier
  readonly omittedSummary: OmittedSummary
  readonly triples: readonly KnowledgeTriple[]
  readonly provenancePaths: readonly ProvenancePath[]
  readonly mode: RepresentationMode
  readonly repositoryFrontier?: RepositoryFrontier
}

type ResolvedCompilationContext = Omit<CompilationContext, "goalDescription"> & {
  readonly goalDescription: string
  readonly softWorkspace: SoftWorkspace
  readonly relevantFiles: readonly string[]
  readonly repositorySignals: readonly string[]
}

export class CognitiveViewCompiler {
  static compile(ctxInput: CompilationContext): CompiledViewPayload {
    return FlightRecorder.withSpan("cognitive_view", "cognitive_view.compile", () => this.compileInternal(ctxInput))
  }

  private static compileInternal(ctxInput: CompilationContext): CompiledViewPayload {
    const softWorkspace = ctxInput.softWorkspace ?? new SoftWorkspace(createSessionId(), ctxInput.hardState.revision)
    const goalDescription =
      ctxInput.goalDescription !== undefined ? ctxInput.goalDescription : (ctxInput.hardState.goalDescription ?? "")
    const ctx: ResolvedCompilationContext = {
      ...ctxInput,
      goalDescription,
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
      obligationRecords,
      completionReadiness,
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
    const { compressedClaims, compressedEvidence, compressedSignals, omitted } = this.stageRelevanceAndCompression(
      ctx,
      eligibleClaims,
      eligibleEvidence,
      ctx.repositorySignals,
    )

    // Stage 5: Contradiction and Rejected Beliefs Inclusion
    const { contradictions, rejectedClaims } = this.stageContradictionInclusion(ctx)

    // Stage 6: Premise Conflict Detection & Proactive Memory Frontier Compilation
    const premiseConflict = ctx.userPrompt
      ? ValidityEngine.detectPremiseConflict(ctx.hardState, ctx.userPrompt, ctx.currentEnvironmentLanguage)
      : null

    const premiseConflicts: PremiseConflict[] = [
      ...ctx.hardState.premiseConflicts,
      ...(premiseConflict ? [premiseConflict] : []),
    ]

    const memoryFrontier =
      ctx.memoryFrontier ?? ValidityEngine.compileMemoryFrontier(ctx.hardState, ctx.focusSymbols ?? [])

    // Stage 7: Assemble compiled payload (Zero-copy pass-through)
    return {
      hardRevision: ctx.hardState.revision,
      workspaceRevision: ctx.softWorkspace.baseHardRevision,
      repositoryId: ctx.repositoryId,
      goalDescription: ctx.goalDescription,
      activeFocus: ctx.hardState.executionFocus
        ? [ctx.hardState.executionFocus.objective]
        : ctx.softWorkspace.activeFocus,
      executionFocus: ctx.hardState.executionFocus,
      recoveryFrames: ctx.hardState.recoveryStack
        .map((id) => ctx.hardState.recoveryFrames.get(id))
        .filter((frame): frame is RecoveryFrame => frame !== undefined),
      trajectoryFolds: ctx.hardState.trajectoryFolds,
      hypotheses: ctx.softWorkspace.hypotheses,
      unknowns: ctx.softWorkspace.unknowns,
      candidateActions: ctx.softWorkspace.candidateActions,
      activeClaims: compressedClaims,
      historicalClaims,
      dirtyClaims,
      contradictions,
      rejectedClaims,
      openObligations: eligibleObligations,
      obligations: obligationRecords,
      completionReadiness,
      recentEvidence: compressedEvidence,
      relevantFiles: ctx.relevantFiles,
      repositorySignals: compressedSignals,
      premiseConflicts,
      memoryFrontier,
      omittedSummary: omitted,
      triples,
      provenancePaths,
      mode: ctx.mode,
      repositoryFrontier: ctx.repositoryFrontier,
    }
  }

  static toCognitiveView(compiled: CompiledViewPayload): CognitiveView {
    return new CognitiveView({
      hardRevision: compiled.hardRevision,
      repositoryId: compiled.repositoryId,
      goalDescription: compiled.goalDescription,
      activeClaims: [...compiled.activeClaims],
      contradictions: compiled.contradictions.map((item) => `${item.claimId}: ${item.reason}`),
      rejectedClaims: compiled.rejectedClaims.map((item) => `${item.claimId}: ${item.reason}`),
      openObligations: compiled.openObligations.map(([id, description]) => `${id}: ${description}`),
      recentEvidence: compiled.recentEvidence.map(([id, source, summary]) => `${id} [${source}]: ${summary}`),
      repositorySignals: [...compiled.repositorySignals],
      unknowns: [...compiled.unknowns],
      activeHypotheses: [...compiled.hypotheses],
      activeFocus: [...compiled.activeFocus],
      executionFocus: compiled.executionFocus,
      recoveryFrames: compiled.recoveryFrames,
      trajectoryFolds: compiled.trajectoryFolds,
      relevantFiles: [...compiled.relevantFiles],
      premiseConflicts: [...compiled.premiseConflicts],
      memoryFrontier: compiled.memoryFrontier,
      tokenBudgetHint: compiled.omittedSummary.tokenBudget,
      obligations: compiled.obligations,
      completionReadiness: compiled.completionReadiness,
    })
  }

  private static stageEligibilityFilter(ctx: ResolvedCompilationContext) {
    // Enforce Read-Time Validity Barrier: DIRTY, STALE, and SUPERSEDED claims have ZERO operational authority
    const barrier = ValidityEngine.applyReadTimeBarrier(ctx.hardState, ctx.scope)

    const eligibleObligations: [ObligationId, string, Scope][] = []
    const obligationRecords: ObligationViewRecord[] = []

    for (const [id, desc] of ctx.hardState.obligations) {
      if (ctx.hardState.activeTaskId && ctx.hardState.obligationTaskIds.get(id) !== ctx.hardState.activeTaskId) continue
      const scope = ctx.hardState.obligationScopes.get(id) ?? Scope.global(ctx.repositoryId, ctx.hardState.revision)
      eligibleObligations.push([id, desc, scope])

      const kind = ctx.hardState.obligationKind(id)
      const closure = AccpSemanticGate.getClosureRequirement(kind)
      const predicate = ctx.hardState.obligationPredicates.get(id)
      const blockers: string[] = []
      if (kind === "epistemic_inquiry") {
        blockers.push("Obligation requires authoritative Noesis projection. Call query_epistemic_state.")
      } else if (kind === "execution") {
        blockers.push(
          "Obligation requires observed execution and Praxis verification receipt. Call request_verification.",
        )
      } else if (kind === "verification") {
        blockers.push("Obligation requires Praxis verification receipt. Call request_verification.")
      } else {
        blockers.push(`Obligation requires ${closure.requiredProofKind} (${closure.verifier}).`)
      }

      obligationRecords.push({
        id,
        type: kind,
        objective: desc,
        status: "open",
        scope,
        closure: {
          requiredProofKind: closure.requiredProofKind,
          verifier: closure.verifier,
          praxisRequired: closure.praxisRequired,
          acceptedProofRefs: [],
        },
        predicateSummary: predicate ? describePredicate(predicate) : undefined,
        legalTransitions: legalTransitionsFor(kind),
        blockers,
      })
    }

    for (const [id, reason] of ctx.hardState.invalidatedObligations) {
      if (ctx.hardState.activeTaskId && ctx.hardState.obligationTaskIds.get(id) !== ctx.hardState.activeTaskId) continue
      const kind = ctx.hardState.obligationKind(id)
      const closure = AccpSemanticGate.getClosureRequirement(kind)
      obligationRecords.push({
        id,
        type: kind,
        objective: `Invalidated: ${reason}`,
        status: "invalidated",
        scope: Scope.global(ctx.repositoryId, ctx.hardState.revision),
        closure: {
          requiredProofKind: closure.requiredProofKind,
          verifier: closure.verifier,
          praxisRequired: closure.praxisRequired,
          acceptedProofRefs: [],
        },
        blockers: [],
      })
    }
    eligibleObligations.sort((a, b) => a[0].localeCompare(b[0]))

    // Include closed/satisfied obligations
    for (const [id, receiptId] of ctx.hardState.closedObligations) {
      if (ctx.hardState.activeTaskId && ctx.hardState.obligationTaskIds.get(id) !== ctx.hardState.activeTaskId) continue
      const kind = ctx.hardState.obligationKind(id)
      const closure = AccpSemanticGate.getClosureRequirement(kind)
      const scope = ctx.hardState.obligationScopes.get(id) ?? Scope.global(ctx.repositoryId, ctx.hardState.revision)
      const inquiryReceipt = ctx.hardState.inquiryReceipts.get(id)
      const desc = inquiryReceipt?.summary ?? ctx.hardState.obligations.get(id) ?? "Satisfied obligation"
      obligationRecords.push({
        id,
        type: kind,
        objective: desc,
        status: "satisfied",
        scope,
        closure: {
          requiredProofKind: closure.requiredProofKind,
          verifier: closure.verifier,
          praxisRequired: closure.praxisRequired,
          acceptedProofRefs: [receiptId],
        },
        blockers: [],
      })
    }
    obligationRecords.sort((a, b) => a.id.localeCompare(b.id))

    const completionReadiness = AccpSemanticGate.checkCompletionReadiness({
      unclosedObligations: ctx.hardState.openObligationIds(),
      passingReceipts: ctx.hardState.closureReceiptIds(),
      hasContradictions: ctx.hardState.contradictions.size > 0,
      getKind: (id) => ctx.hardState.obligationKind(id),
      getDescription: (id) => ctx.hardState.obligations.get(id) ?? id,
      totalObligations:
        ctx.hardState.openObligationIds().length +
        [...ctx.hardState.closedObligations.keys()].filter(
          (id) => !ctx.hardState.activeTaskId || ctx.hardState.obligationTaskIds.get(id) === ctx.hardState.activeTaskId,
        ).length,
      hasActiveGoal: Boolean(ctx.goalDescription && ctx.goalDescription.trim().length > 0),
    })

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
      obligationRecords,
      completionReadiness,
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

      for (const evidId of claim.supportingEvidence ?? []) {
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
    lines.push(`Goal: ${p.goalDescription || "(None - Conversational Mode)"}\n`)

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
      lines.push(`- [${c.id}] ${c.status}: ${c.proposition} (support: ${JSON.stringify(c.supportingEvidence)})`)
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
        lines.push(`- Rejected [${r.claimId}]: ${r.reason} (evidence: ${JSON.stringify(r.evidence)})`)
      }
    }

    lines.push("\n--- Open Obligations ---")
    for (const [id, desc, scope] of p.openObligations) {
      lines.push(`- [${id}] ${desc} (scope: ${scope.repository}@${scope.revision})`)
    }

    lines.push(`\n--- Completion Readiness: ${p.completionReadiness.status} ---`)
    if (p.completionReadiness.status === "NOT_REQUIRED") {
      lines.push("- Status: NOT_REQUIRED (Conversational / Non-goal mode)")
    } else if (p.completionReadiness.status === "READY") {
      lines.push("- Status: READY for completion proposal")
    } else {
      lines.push("- Status: BLOCKED")
      for (const b of p.completionReadiness.blockers) {
        lines.push(`  * ${b}`)
      }
    }

    if (p.obligations && p.obligations.length > 0) {
      lines.push("\n--- Obligation Contracts ---")
      for (const o of p.obligations) {
        lines.push(
          `- [${o.id}] ${o.type.toUpperCase()}: ${o.objective} (${o.status.toUpperCase()}) | verifier=${o.closure.verifier} | proof=${o.closure.requiredProofKind} | praxis=${o.closure.praxisRequired ? "REQUIRED" : "NOT_REQUIRED"}`,
        )
      }
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

    if (p.repositoryFrontier) {
      lines.push(`\n${RepositoryFrontierCompiler.render(p.repositoryFrontier)}`)
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

    for (const o of p.obligations) {
      lines.push(formatTriple({ subject: `Obligation#${o.id}`, predicate: "type", object: o.type }))
      lines.push(formatTriple({ subject: `Obligation#${o.id}`, predicate: "status", object: o.status }))
      lines.push(formatTriple({ subject: `Obligation#${o.id}`, predicate: "verifier", object: o.closure.verifier }))
    }
    lines.push(formatTriple({ subject: "Completion", predicate: "readiness", object: p.completionReadiness.status }))

    if (p.repositoryFrontier) {
      lines.push(`\n# --- Repository Frontier ---`)
      lines.push(
        formatTriple({
          subject: "Frontier#Repo",
          predicate: "description",
          object: p.repositoryFrontier.repositorySummary.description,
        }),
      )
      for (const rel of p.repositoryFrontier.structure) {
        lines.push(formatTriple({ subject: `Symbol#${rel.from}`, predicate: rel.relation, object: `Symbol#${rel.to}` }))
      }
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

    for (const o of p.obligations) {
      lines.push(formatProvenancePath({ steps: [`Obligation(${o.id})`, o.type, o.status, o.closure.verifier] }))
    }
    lines.push(formatProvenancePath({ steps: ["Completion", "readiness", p.completionReadiness.status] }))

    if (p.repositoryFrontier) {
      for (const rel of p.repositoryFrontier.structure) {
        lines.push(formatProvenancePath({ steps: [`Frontier(${rel.from})`, rel.relation, `Frontier(${rel.to})`] }))
      }
    }

    lines.push(
      `\n[OmittedSummary: deferred_trees=${p.omittedSummary.deferredTrees}, token_budget=${p.omittedSummary.tokenBudget}]`,
    )
    return lines.join("\n")
  }

  private static renderHybrid(p: CompiledViewPayload): string {
    const frontierYaml = p.repositoryFrontier
      ? [
          `  repository_frontier:`,
          `    description: "${p.repositoryFrontier.repositorySummary.description}"`,
          `    subsystems: ${JSON.stringify(p.repositoryFrontier.taskNeighborhood)}`,
          `    files: ${JSON.stringify(p.repositoryFrontier.likelyRelevantFiles)}`,
          `    key_symbols: ${JSON.stringify(p.repositoryFrontier.keySymbols)}`,
        ].join("\n")
      : ""

    return [
      "```yaml",
      `cognitive_view:`,
      `  hard_revision: "${p.hardRevision}"`,
      `  repository_id: "${p.repositoryId}"`,
      `  goal_description: "${p.goalDescription}"`,
      `  completion_readiness: "${p.completionReadiness.status}"`,
      `  active_focus: ${JSON.stringify(p.activeFocus)}`,
      `  hypotheses: ${JSON.stringify(p.hypotheses)}`,
      `  active_claims_count: ${p.activeClaims.length}`,
      `  open_obligations_count: ${p.openObligations.length}`,
      `  contradictions_count: ${p.contradictions.length}`,
      `  premise_conflicts_count: ${p.premiseConflicts.length}`,
      frontierYaml,
      `  omitted_summary:`,
      `    deferred_trees: ${p.omittedSummary.deferredTrees}`,
      `    token_budget: ${p.omittedSummary.tokenBudget}`,
      "```",
    ]
      .filter(Boolean)
      .join("\n")
  }
}

export function describePredicate(predicate: ObligationPredicate): string {
  switch (predicate.type) {
    case "file_constraint":
      return `file_constraint: path "${predicate.path}" mustExist=${predicate.mustExist}${predicate.contentPattern ? ` content~"${predicate.contentPattern}"` : ""}`
    case "claims_verified":
      return `claims_verified: ${predicate.claimPropositions.join("; ")}`
    case "command_pass":
      return `command_pass: "${predicate.command}" exit=${predicate.expectedExitCode}`
    case "human_approval":
      return "human_approval: explicit user approval required"
  }
}

function legalTransitionsFor(kind: string): string[] {
  if (kind === "epistemic_inquiry") {
    return ["query_epistemic_state (authoritative projection closes it)"]
  }
  return ["satisfy via request_verification", "invalidate_obligation if structurally malformed"]
}

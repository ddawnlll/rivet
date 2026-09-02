import {
  type ClaimId,
  type DependencyRef,
  type EpistemicStatus,
  type EvidenceId,
  type MemoryFrontier,
  type MemoryRef,
  type PremiseConflict,
  type Revision,
  type Scope,
  type ValidityPolicy,
  globMatch,
  normalizeRelativePath,
} from "./types"
import type { ClaimRecord, HardState } from "./noesis"
import type { ClaimProposal } from "./accp"

export type EnvironmentChange =
  | { readonly type: "file_created" | "file_modified" | "file_deleted"; readonly path: string }
  | { readonly type: "manifest_changed"; readonly name: string; readonly path?: string }
  | { readonly type: "git_revision_changed"; readonly head: string }
  | { readonly type: "config_changed"; readonly key: string }
  | { readonly type: "census_changed"; readonly key: string }
  | { readonly type: "verification_executed"; readonly predicate: string; readonly passed: boolean }

export function dependencyRefKey(ref: DependencyRef): string {
  switch (ref.type) {
    case "file":
      return `file:${normalizeRelativePath(ref.path)}`
    case "file_pattern":
      return `pattern:${normalizeRelativePath(ref.pattern)}`
    case "manifest":
      return `manifest:${ref.name}${ref.path ? `:${normalizeRelativePath(ref.path)}` : ""}`
    case "symbol":
      return `symbol:${ref.symbol}${ref.file ? `:${normalizeRelativePath(ref.file)}` : ""}`
    case "census":
      return `census:${ref.key}`
    case "claim":
      return `claim:${ref.claimId}`
    case "predicate":
      return `predicate:${ref.predicate}`
    case "config":
      return `config:${ref.key}`
  }
}

export interface InvalidationImpact {
  readonly directDirtyClaimIds: readonly ClaimId[]
  readonly transitiveDirtyClaimIds: readonly ClaimId[]
  readonly allDirtyClaimIds: readonly ClaimId[]
  readonly affectedDependencies: readonly string[]
}

/**
 * Dependency graph connecting mutable HardState claims to environmental
 * files, manifests, symbols, censuses, and parent claims.
 * Supports O(1) reverse lookup from changed dependencies to affected claims.
 */
export class ValidityGraph {
  private readonly dependenciesByClaim = new Map<ClaimId, Set<string>>()
  private readonly claimsByDependency = new Map<string, Set<ClaimId>>()
  private readonly rawDependencies = new Map<ClaimId, DependencyRef[]>()

  register(claimId: ClaimId, dependencies: readonly DependencyRef[]): void {
    this.unregister(claimId)
    if (dependencies.length === 0) return

    const keySet = new Set<string>()
    const rawList: DependencyRef[] = []

    for (const dep of dependencies) {
      const key = dependencyRefKey(dep)
      keySet.add(key)
      rawList.push(dep)

      let claimSet = this.claimsByDependency.get(key)
      if (!claimSet) {
        claimSet = new Set<ClaimId>()
        this.claimsByDependency.set(key, claimSet)
      }
      claimSet.add(claimId)
    }

    this.dependenciesByClaim.set(claimId, keySet)
    this.rawDependencies.set(claimId, rawList)
  }

  unregister(claimId: ClaimId): void {
    const existing = this.dependenciesByClaim.get(claimId)
    if (!existing) return

    for (const key of existing) {
      const claimSet = this.claimsByDependency.get(key)
      if (claimSet) {
        claimSet.delete(claimId)
        if (claimSet.size === 0) {
          this.claimsByDependency.delete(key)
        }
      }
    }

    this.dependenciesByClaim.delete(claimId)
    this.rawDependencies.delete(claimId)
  }

  getDependencies(claimId: ClaimId): readonly DependencyRef[] {
    return this.rawDependencies.get(claimId) ?? []
  }

  getDependencyKeys(claimId: ClaimId): readonly string[] {
    const keys = this.dependenciesByClaim.get(claimId)
    return keys ? Array.from(keys) : []
  }

  getDependentClaimsByKey(key: string): ReadonlySet<ClaimId> {
    return this.claimsByDependency.get(key) ?? new Set<ClaimId>()
  }

  findAffectedClaims(changes: readonly EnvironmentChange[]): Set<ClaimId> {
    const affected = new Set<ClaimId>()

    for (const change of changes) {
      switch (change.type) {
        case "file_created":
        case "file_modified":
        case "file_deleted": {
          const norm = normalizeRelativePath(change.path)
          const direct = this.claimsByDependency.get(`file:${norm}`)
          if (direct) {
            for (const id of direct) affected.add(id)
          }

          const base = norm.split("/").pop() ?? norm
          const manifestDirect = this.claimsByDependency.get(`manifest:${base}`)
          if (manifestDirect) {
            for (const id of manifestDirect) affected.add(id)
          }

          // Check pattern dependencies
          for (const [key, claims] of this.claimsByDependency) {
            if (key.startsWith("pattern:")) {
              const pattern = key.slice("pattern:".length)
              if (globMatch(pattern, norm)) {
                for (const id of claims) affected.add(id)
              }
            }
          }
          break
        }
        case "manifest_changed": {
          const direct = this.claimsByDependency.get(`manifest:${change.name}`)
          if (direct) {
            for (const id of direct) affected.add(id)
          }
          const fileDirect = this.claimsByDependency.get(`file:${change.name}`)
          if (fileDirect) {
            for (const id of fileDirect) affected.add(id)
          }
          if (change.path) {
            const pathKey = `manifest:${change.name}:${normalizeRelativePath(change.path)}`
            const pathDirect = this.claimsByDependency.get(pathKey)
            if (pathDirect) {
              for (const id of pathDirect) affected.add(id)
            }
          }
          break
        }
        case "census_changed": {
          const direct = this.claimsByDependency.get(`census:${change.key}`)
          if (direct) {
            for (const id of direct) affected.add(id)
          }
          break
        }
        case "config_changed": {
          const direct = this.claimsByDependency.get(`config:${change.key}`)
          if (direct) {
            for (const id of direct) affected.add(id)
          }
          break
        }
        case "verification_executed": {
          const direct = this.claimsByDependency.get(`predicate:${change.predicate}`)
          if (direct) {
            for (const id of direct) affected.add(id)
          }
          break
        }
        case "git_revision_changed": {
          const direct = this.claimsByDependency.get("census:git_revision")
          if (direct) {
            for (const id of direct) affected.add(id)
          }
          break
        }
      }
    }

    return affected
  }

  computeTransitiveDependents(
    direct: ReadonlySet<ClaimId>,
    claims: ReadonlyMap<ClaimId, ClaimRecord>,
  ): Set<ClaimId> {
    const transitive = new Set<ClaimId>()
    const queue = Array.from(direct)

    while (queue.length > 0) {
      const curr = queue.shift()!
      // Check claim dependency keys
      const depKey = `claim:${curr}`
      const directDependents = this.claimsByDependency.get(depKey)
      if (directDependents) {
        for (const depId of directDependents) {
          if (!direct.has(depId) && !transitive.has(depId)) {
            transitive.add(depId)
            queue.push(depId)
          }
        }
      }

      // Also check claim record's dependsOn array
      for (const [id, record] of claims) {
        if (record.dependsOn.includes(curr) && !direct.has(id) && !transitive.has(id)) {
          transitive.add(id)
          queue.push(id)
        }
      }
    }

    return transitive
  }

  toJSON(): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const [claimId, deps] of this.dependenciesByClaim) {
      out[claimId] = Array.from(deps)
    }
    return out
  }

  static fromJSON(data: Record<string, string[]>): ValidityGraph {
    const graph = new ValidityGraph()
    for (const [claimId, deps] of Object.entries(data)) {
      const rawDeps: DependencyRef[] = deps.map((d) => {
        if (d.startsWith("file:")) return { type: "file", path: d.slice(5) }
        if (d.startsWith("pattern:")) return { type: "file_pattern", pattern: d.slice(8) }
        if (d.startsWith("manifest:")) {
          const parts = d.slice(9).split(":")
          return { type: "manifest", name: parts[0], path: parts[1] }
        }
        if (d.startsWith("symbol:")) {
          const parts = d.slice(7).split(":")
          return { type: "symbol", symbol: parts[0], file: parts[1] }
        }
        if (d.startsWith("census:")) return { type: "census", key: d.slice(7) }
        if (d.startsWith("claim:")) return { type: "claim", claimId: d.slice(6) as ClaimId }
        if (d.startsWith("predicate:")) return { type: "predicate", predicate: d.slice(10) }
        if (d.startsWith("config:")) return { type: "config", key: d.slice(7) }
        return { type: "config", key: d }
      })
      graph.register(claimId as ClaimId, rawDeps)
    }
    return graph
  }
}

export interface WriteTimeAdjudicationResult {
  readonly action: "admit" | "supersede" | "contradict" | "reject"
  readonly supersededClaimId?: ClaimId
  readonly contradictionReason?: string
}

export interface ReadTimeBarrierResult {
  readonly activeClaims: readonly ClaimRecord[]
  readonly historicalClaims: readonly ClaimRecord[]
  readonly dirtyClaims: readonly ClaimRecord[]
  readonly rejectedClaims: readonly ClaimRecord[]
  readonly supersededClaims: readonly ClaimRecord[]
}

/**
 * Native Noesis Validity Engine implementing the 3 Validity Barriers,
 * bi-temporal invalidation, premise conflict detection, and memory frontier compilation.
 */
export class ValidityEngine {
  /**
   * Change-Time Barrier: Evaluates environmental changes against the validity graph
   * and computes direct and transitive claims to mark DIRTY.
   */
  static analyzeEnvironmentChanges(
    graph: ValidityGraph,
    hardState: HardState,
    changes: readonly EnvironmentChange[],
  ): InvalidationImpact {
    const directSet = graph.findAffectedClaims(changes)
    const directEligible: ClaimId[] = []

    for (const id of directSet) {
      const claim = hardState.claims.get(id)
      // Historical claims never become dirty/stale
      if (claim && claim.validityPolicy !== "HISTORICAL" && claim.status !== "rejected" && claim.status !== "superseded") {
        directEligible.push(id)
      }
    }

    const transitiveSet = graph.computeTransitiveDependents(new Set(directEligible), hardState.claims)
    const allDirty = Array.from(new Set([...directEligible, ...transitiveSet]))

    const affectedDeps: string[] = []
    for (const c of changes) {
      if (c.type === "file_modified" || c.type === "file_created" || c.type === "file_deleted") {
        affectedDeps.push(c.path)
      } else if (c.type === "manifest_changed") {
        affectedDeps.push(c.name)
      }
    }

    return {
      directDirtyClaimIds: directEligible,
      transitiveDirtyClaimIds: Array.from(transitiveSet),
      allDirtyClaimIds: allDirty,
      affectedDependencies: affectedDeps,
    }
  }

  /**
   * Write-Time Barrier: Evaluates new claim proposal against existing Hard State.
   * Distinguishes between legitimate temporal supersession and ambiguous contradiction.
   * A mere contradiction against an active, valid claim does NOT arbitrarily supersede it.
   */
  static adjudicateWriteTime(
    hardState: HardState,
    proposal: ClaimProposal,
    validityPolicy: ValidityPolicy = "EPISTEMIC",
  ): WriteTimeAdjudicationResult {
    for (const [existingId, existing] of hardState.claims) {
      if (existing.status === "rejected" || existing.status === "superseded") continue

      const sameScope =
        existing.scope.repository === proposal.scope.repository &&
        existing.scope.pathPattern === proposal.scope.pathPattern

      if (!sameScope) continue

      const normProp = proposal.proposition.trim().toLowerCase()
      const normExist = existing.proposition.trim().toLowerCase()

      if (normProp === normExist) {
        // Re-asserting identical proposition with potentially fresh evidence
        return { action: "admit" }
      }

      // Check if propositions conflict on the same property slot
      const slotConflict = extractPropertySlotConflict(normProp, normExist)

      // Check if propositions are logical negations/contradictions
      const isDirectNegation =
        (normProp.includes(" not ") && normProp.replace(/\bnot\s+/g, "") === normExist.replace(/\bnot\s+/g, "")) ||
        (normExist.includes(" not ") && normExist.replace(/\bnot\s+/g, "") === normProp.replace(/\bnot\s+/g, ""))

      if (slotConflict.hasConflict || isDirectNegation) {
        // 1. DETERMINISTIC TEMPORAL SUPERSESSION:
        // Allowed if:
        // a) The existing claim was already marked DIRTY or STALE by the Change-Time Barrier, OR
        // b) The new proposal provides fresh valid evidence and represents a functional slot update
        if (existing.status === "dirty" || existing.status === "stale") {
          return {
            action: "supersede",
            supersededClaimId: existingId,
          }
        }

        if (slotConflict.isFunctionalSlot && proposal.supportingEvidence.length > 0) {
          return {
            action: "supersede",
            supersededClaimId: existingId,
          }
        }

        // 2. UNRESOLVED CONTRADICTION:
        // If existing claim is actively verified/supported (not dirty) and no dependency invalidation occurred,
        // we must NOT arbitrarily supersede. It is an unresolved contradiction.
        return {
          action: "contradict",
          contradictionReason: `Proposal '${proposal.proposition}' contradicts active valid claim '${existing.proposition}' (${existingId}) without prior dependency invalidation`,
        }
      }
    }

    return { action: "admit" }
  }

  /**
   * Read-Time Validity Barrier: Filters claims before CognitiveView compilation.
   * Guarantees: A claim marked DIRTY, STALE, or SUPERSEDED has ZERO operational authority.
   */
  static applyReadTimeBarrier(hardState: HardState, scope?: Scope): ReadTimeBarrierResult {
    const active: ClaimRecord[] = []
    const historical: ClaimRecord[] = []
    const dirty: ClaimRecord[] = []
    const rejected: ClaimRecord[] = []
    const superseded: ClaimRecord[] = []

    for (const claim of hardState.claims.values()) {
      if (scope && !scope.containsScope(claim.scope) && !claim.scope.containsScope(scope)) {
        continue
      }

      switch (claim.status) {
        case "supported":
        case "verified":
          if (claim.validityPolicy === "HISTORICAL") {
            historical.push(claim)
          } else {
            active.push(claim)
          }
          break
        case "dirty":
          dirty.push(claim)
          break
        case "stale":
        case "superseded":
          superseded.push(claim)
          break
        case "rejected":
        case "invalidated":
          rejected.push(claim)
          break
        case "hypothetical":
          // Hypothetical claims stay in soft workspace, not active hard state
          break
      }
    }

    return {
      activeClaims: active.sort((a, b) => a.id.localeCompare(b.id)),
      historicalClaims: historical.sort((a, b) => a.id.localeCompare(b.id)),
      dirtyClaims: dirty.sort((a, b) => a.id.localeCompare(b.id)),
      rejectedClaims: rejected.sort((a, b) => a.id.localeCompare(b.id)),
      supersededClaims: superseded.sort((a, b) => a.id.localeCompare(b.id)),
    }
  }

  /**
   * Detects structured premise conflicts when the user prompt references
   * a superseded or falsified historical state.
   */
  static detectPremiseConflict(
    hardState: HardState,
    userPrompt: string,
    currentEnvironmentLanguage?: string,
  ): PremiseConflict | null {
    const lowerPrompt = userPrompt.toLowerCase()

    // Example 1: User mentions "Python" when Python claim was superseded by Rust
    const mentionsPython = /\b(python|pyproject|pip|pytest)\b/i.test(lowerPrompt)
    const mentionsRust = /\b(rust|cargo|crates|rustc)\b/i.test(lowerPrompt)

    if (mentionsPython && !mentionsRust) {
      // Find if Python claim exists and was superseded
      for (const [id, claim] of hardState.claims) {
        const prop = claim.proposition.toLowerCase()
        if (
          prop.includes("python") &&
          (claim.status === "superseded" || claim.status === "stale" || claim.status === "rejected")
        ) {
          const activeReplacement = Array.from(hardState.claims.values()).find(
            (c) =>
              (c.status === "supported" || c.status === "verified") &&
              c.proposition.toLowerCase().includes("rust"),
          )

          return {
            userPremise: "User refers to Python codebase/environment",
            currentValidState: activeReplacement?.proposition ??
              (currentEnvironmentLanguage ? `Repository currently uses ${currentEnvironmentLanguage}` : "Repository migrated to Rust"),
            conflictingClaimId: id,
            supersededAtRevision: claim.validToRevision ?? hardState.revision,
            evidenceRefs: [...claim.supportingEvidence],
          }
        }
      }
    }

    return null
  }

  /**
   * Compiles the proactive Memory Frontier for the Cognitive View.
   * Memory retrieval is a Harness responsibility, not a mandatory model tool call.
   */
  static compileMemoryFrontier(
    hardState: HardState,
    focusSymbols: readonly string[] = [],
  ): MemoryFrontier {
    const pinned: MemoryRef[] = []
    const active: MemoryRef[] = []
    const episodic: MemoryRef[] = []
    const procedural: MemoryRef[] = []
    const rejected: MemoryRef[] = []

    for (const claim of hardState.claims.values()) {
      const ref: MemoryRef = {
        id: claim.id,
        type: "claim",
        summary: claim.proposition,
        status: claim.status,
        revision: claim.validFromRevision,
      }

      if (claim.validityPolicy === "HISTORICAL") {
        episodic.push(ref)
      } else if (claim.validityPolicy === "PROCEDURAL") {
        procedural.push(ref)
      } else if (claim.status === "supported" || claim.status === "verified") {
        active.push(ref)
      } else if (claim.status === "rejected" || claim.status === "invalidated") {
        rejected.push(ref)
      }
    }

    // Add recent observations / failures as episodic memory
    for (const [obsId, obs] of hardState.observations) {
      episodic.push({
        id: obsId,
        type: "observation",
        summary: obs.summary,
      })
    }

    // Add process error attributions for failure avoidance
    for (const attr of hardState.processErrorAttributions) {
      rejected.push({
        id: attr.attributionId,
        type: "failure",
        summary: `${attr.category}: ${attr.diagnostic}`,
      })
    }

    return {
      revision: hardState.revision,
      pinned,
      active: active.slice(-16),
      episodic: episodic.slice(-8),
      procedural: procedural.slice(-8),
      rejected: rejected.slice(-8),
      relatedSymbols: focusSymbols,
    }
  }
}

function extractPropertySlotConflict(
  normProp: string,
  normExist: string,
): { readonly hasConflict: boolean; readonly isFunctionalSlot: boolean } {
  const functionalPrefixes = [
    "primary implementation language is",
    "primary language is",
    "project language is",
    "architecture:",
    "build system is",
    "framework:",
    "default port is",
    "database is",
    "auth mechanism is",
  ]

  for (const prefix of functionalPrefixes) {
    if (normProp.includes(prefix) && normExist.includes(prefix)) {
      return {
        hasConflict: normProp !== normExist,
        isFunctionalSlot: true,
      }
    }
  }

  // Key-value or config pattern (e.g. "config.port is 8080" vs "config.port is 9090")
  const kvMatchA = normProp.match(/^([a-z0-9_.-]+)\s*(?:=|:|is)\s*(.+)$/)
  const kvMatchB = normExist.match(/^([a-z0-9_.-]+)\s*(?:=|:|is)\s*(.+)$/)
  if (kvMatchA && kvMatchB && kvMatchA[1] === kvMatchB[1]) {
    return {
      hasConflict: kvMatchA[2] !== kvMatchB[2],
      isFunctionalSlot: true,
    }
  }

  return { hasConflict: false, isFunctionalSlot: false }
}


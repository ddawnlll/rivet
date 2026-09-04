import type { HardState } from "../noesis"
import { ValidityEngine, type ValidityGraph, type InvalidationImpact, type EnvironmentChange } from "../validity"
import type { RepositoryCensus } from "./census"
import type { ProjectGraph } from "./project-graph"
import type { RepositoryFrontier } from "./repository-frontier"

export type ArchitectureDiscontinuityType =
  | "LANGUAGE_MIGRATION"
  | "PACKAGE_SPLIT"
  | "PACKAGE_MERGE"
  | "MAJOR_SYMBOL_REMOVED"
  | "BUILD_SYSTEM_REPLACED"
  | "ENTRYPOINT_REPLACED"

export interface ArchitectureChangeSignal {
  readonly type: ArchitectureDiscontinuityType
  readonly description: string
  readonly severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  readonly affectedPaths: readonly string[]
  readonly suggestedEpochName?: string
}

export class ArchitectureSignalDetector {
  /**
   * Compares prior census and current graph state to detect structural discontinuities.
   */
  static detectDiscontinuities(
    previousCensus: RepositoryCensus | undefined,
    currentCensus: RepositoryCensus,
    removedNodeIds: readonly string[] = []
  ): readonly ArchitectureChangeSignal[] {
    const signals: ArchitectureChangeSignal[] = []
    if (!previousCensus) return signals

    // 1. Language Migration (e.g. Python -> Rust or TS -> Go)
    const prevLangs = new Set(previousCensus.primaryLanguages)
    const currLangs = new Set(currentCensus.primaryLanguages)

    for (const curr of currLangs) {
      if (!prevLangs.has(curr) && prevLangs.size > 0) {
        signals.push({
          type: "LANGUAGE_MIGRATION",
          description: `Primary language migration detected: Added ${curr}, previous was [${Array.from(prevLangs).join(", ")}]`,
          severity: "CRITICAL",
          affectedPaths: currentCensus.sourceRoots,
          suggestedEpochName: `Migration to ${curr}`,
        })
      }
    }

    // 2. Build System Replacement
    const prevBuilds = new Set(previousCensus.buildSystems)
    const currBuilds = new Set(currentCensus.buildSystems)
    for (const curr of currBuilds) {
      if (!prevBuilds.has(curr) && prevBuilds.size > 0) {
        signals.push({
          type: "BUILD_SYSTEM_REPLACED",
          description: `Build system replaced or augmented with ${curr}`,
          severity: "HIGH",
          affectedPaths: currentCensus.manifestFiles,
        })
      }
    }

    // 3. Package Split / Merge
    const prevPkgNames = new Set(previousCensus.workspaces.map((w) => w.name))
    const currPkgNames = new Set(currentCensus.workspaces.map((w) => w.name))

    if (currPkgNames.size > prevPkgNames.size + 2) {
      signals.push({
        type: "PACKAGE_SPLIT",
        description: `Package split detected: Package count increased from ${prevPkgNames.size} to ${currPkgNames.size}`,
        severity: "MEDIUM",
        affectedPaths: currentCensus.workspaces.map((w) => w.path),
      })
    } else if (currPkgNames.size < prevPkgNames.size && prevPkgNames.size > 1) {
      signals.push({
        type: "PACKAGE_MERGE",
        description: `Package consolidation detected: Package count reduced from ${prevPkgNames.size} to ${currPkgNames.size}`,
        severity: "MEDIUM",
        affectedPaths: currentCensus.workspaces.map((w) => w.path),
      })
    }

    // 4. Major Symbol Removal
    const removedMajorSymbols = removedNodeIds.filter((id) => id.startsWith("symbol:") && !id.includes(".test."))
    if (removedMajorSymbols.length > 5) {
      signals.push({
        type: "MAJOR_SYMBOL_REMOVED",
        description: `${removedMajorSymbols.length} major symbols were removed or renamed in recent changes`,
        severity: "HIGH",
        affectedPaths: removedMajorSymbols,
      })
    }

    return signals
  }
}

export class NoesisRepositoryIntegrator {
  /**
   * Translates ProjectGraph file and symbol modifications directly into Noesis ValidityGraph invalidations.
   * Marks dependent HardState claims as DIRTY.
   */
  static applyGraphDeltaToValidity(
    validityGraph: ValidityGraph,
    hardState: HardState,
    modifiedFiles: readonly string[],
    removedSymbols: readonly string[] = []
  ): InvalidationImpact {
    const changes: EnvironmentChange[] = modifiedFiles.map((f) => ({
      type: "file_modified" as const,
      path: f,
    }))

    for (const sym of removedSymbols) {
      const symName = sym.replace(/^symbol:/, "")
      changes.push({
        type: "file_modified",
        path: symName,
      })
    }

    return ValidityEngine.analyzeEnvironmentChanges(validityGraph, hardState, changes)
  }

  /**
   * Evaluates whether an associative memory item suffers from architectural drift.
   * If drift is detected, Noesis Cognitive Admission raises the admission threshold.
   */
  static evaluateDriftForMemory(
    memoryProposition: string,
    graph: ProjectGraph,
    census: RepositoryCensus
  ): { readonly isDrifted: boolean; readonly penaltyScore: number; readonly reason?: string } {
    const propLower = memoryProposition.toLowerCase()

    const knownLanguages = ["python", "rust", "typescript", "javascript", "go", "ruby", "java", "csharp", "kotlin", "swift", "c++", "c"]
    const mentionedLang = knownLanguages.find((lang) => propLower.includes(lang))
    if (
      mentionedLang &&
      !census.primaryLanguages.some((l) => l.toLowerCase() === mentionedLang) &&
      census.primaryLanguages.length > 0
    ) {
      const capLang = mentionedLang.charAt(0).toUpperCase() + mentionedLang.slice(1)
      return {
        isDrifted: true,
        penaltyScore: 0.8,
        reason: `Memory refers to ${capLang} architecture, but active repository migrated to ${census.primaryLanguages.join(", ")}.`,
      }
    }

    // Check if proposition mentions a symbol that was completely removed
    const words = memoryProposition.split(/[^a-zA-Z0-9_]+/).filter((w) => w.length > 4 && /^[A-Z]/.test(w))
    for (const word of words) {
      let found = false
      for (const node of graph.nodes.values()) {
        if (node.label === word) {
          found = true
          break
        }
      }
      if (!found && graph.nodes.size > 20) {
        return {
          isDrifted: true,
          penaltyScore: 0.5,
          reason: `Symbol '${word}' referenced in memory no longer exists in repository graph.`,
        }
      }
    }

    return { isDrifted: false, penaltyScore: 0 }
  }

  /**
   * Provides candidate test surface for Praxis pipeline hypothesis verification.
   * Invariant: likely relevant test != verification.
   */
  static suggestTestTargetsForPraxis(frontier: RepositoryFrontier): readonly string[] {
    return frontier.likelyTestSurface
  }
}

import type { ProjectGraph } from "./project-graph"
import type { TaskNeighborhood } from "./task-neighborhood"
import type { SemanticDeepeningResult } from "./semantic-deepening"
import type { RepositoryCensus } from "./census"

export interface StructuralRelation {
  readonly from: string
  readonly to: string
  readonly relation: string
}

export interface RepositoryFrontier {
  readonly repositorySummary: {
    readonly description: string
    readonly revision: string
    readonly packageCount?: number
  }
  readonly taskNeighborhood: readonly string[]
  readonly likelyRelevantFiles: readonly string[]
  readonly keySymbols: readonly string[]
  readonly structure: readonly StructuralRelation[]
  readonly likelyTestSurface: readonly string[]
  readonly recentRelevantChanges: readonly string[]
  readonly unresolvedAmbiguities: readonly string[]
}

export class RepositoryFrontierCompiler {
  /**
   * Compiles the bounded RepositoryFrontier from census, neighborhood, and deepening results.
   */
  static compile(input: {
    readonly census?: RepositoryCensus
    readonly neighborhood: TaskNeighborhood
    readonly deepening?: SemanticDeepeningResult
    readonly graph: ProjectGraph
    readonly recentChanges?: readonly string[]
    readonly maxFiles?: number
    readonly maxSymbols?: number
  }): RepositoryFrontier {
    const maxFiles = input.maxFiles ?? 12
    const maxSymbols = input.maxSymbols ?? 15

    // 1. Repository Summary
    const languages = input.census?.primaryLanguages.join(", ") ?? "Polyglot"
    const buildSys = input.census?.buildSystems.join(", ") ?? "Standard"
    const rev = input.graph.repositoryRevision.toString()
    const pkgCount = input.census?.workspaces.length

    const repoDesc = `${languages} repository (${buildSys})${pkgCount ? `, ${pkgCount} packages` : ""}`

    // 2. Subsystems in task neighborhood
    const subsystems = input.neighborhood.getPackages()

    // 3. Prioritized Files
    const files = input.neighborhood.getFiles().slice(0, maxFiles)

    // 4. Key Symbols
    const keySymbols = input.neighborhood
      .getSymbols()
      .map((s) => s.label)
      .slice(0, maxSymbols)

    // 5. Structure relations (structure-preserving caller -> callee, implements, defines)
    const structure: StructuralRelation[] = []

    if (input.deepening) {
      for (const call of input.deepening.resolvedCalls) {
        structure.push({
          from: call.callerId.replace(/^symbol:/, "").replace(/^file:/, ""),
          to: call.calleeName,
          relation: call.isDynamicDispatch ? "dispatches_to" : "calls",
        })
      }

      for (const th of input.deepening.typeHierarchies) {
        for (const impl of th.implementations) {
          structure.push({
            from: impl,
            to: th.interfaceOrBase,
            relation: "implements",
          })
        }
      }
    }

    // Include neighborhood edge relations if deepening did not already add them
    for (const edge of input.neighborhood.edges) {
      if (structure.length >= 20) break
      if (edge.kind === "implements" || edge.kind === "tests" || edge.kind === "configures") {
        const fromLabel = input.graph.getNode(edge.from)?.label ?? edge.from
        const toLabel = input.graph.getNode(edge.to)?.label ?? edge.to
        if (!structure.some((s) => s.from === fromLabel && s.to === toLabel)) {
          structure.push({
            from: fromLabel,
            to: toLabel,
            relation: edge.kind,
          })
        }
      }
    }

    // 6. Likely Test Surface
    const testSurface = Array.from(
      new Set([
        ...(input.deepening?.affectedTests ?? []),
        ...input.neighborhood.getTests().map((t) => t.label),
      ])
    ).slice(0, 8)

    // 7. Recent Relevant Changes
    const recentChanges: string[] = []
    if (input.recentChanges) {
      for (const change of input.recentChanges) {
        if (files.some((f) => change.includes(f)) || keySymbols.some((s) => change.includes(s))) {
          recentChanges.push(change)
        }
      }
    }

    // 8. Unresolved Ambiguities
    const ambiguities = input.deepening?.unresolvedAmbiguities ?? []

    return {
      repositorySummary: {
        description: repoDesc,
        revision: rev,
        packageCount: pkgCount,
      },
      taskNeighborhood: subsystems,
      likelyRelevantFiles: files,
      keySymbols,
      structure,
      likelyTestSurface: testSurface,
      recentRelevantChanges: recentChanges,
      unresolvedAmbiguities: ambiguities,
    }
  }

  /**
   * Serializes the RepositoryFrontier in a structure-preserving format for LLM cognitive context.
   */
  static render(frontier: RepositoryFrontier): string {
    const lines: string[] = []
    lines.push("### REPOSITORY FRONTIER")
    lines.push(`REPOSITORY: ${frontier.repositorySummary.description} | Revision: ${frontier.repositorySummary.revision}`)

    if (frontier.taskNeighborhood.length > 0) {
      lines.push(`TASK NEIGHBORHOOD: ${frontier.taskNeighborhood.join(", ")}`)
    }

    if (frontier.likelyRelevantFiles.length > 0) {
      lines.push("\nLIKELY RELEVANT FILES:")
      for (const file of frontier.likelyRelevantFiles) {
        lines.push(`- ${file}`)
      }
    }

    if (frontier.keySymbols.length > 0) {
      lines.push(`\nKEY SYMBOLS: ${frontier.keySymbols.join(", ")}`)
    }

    if (frontier.structure.length > 0) {
      lines.push("\nSTRUCTURE (Relations):")
      for (const rel of frontier.structure) {
        lines.push(`  ${rel.from} -> [${rel.relation}] -> ${rel.to}`)
      }
    }

    if (frontier.likelyTestSurface.length > 0) {
      lines.push("\nLIKELY TEST SURFACE:")
      for (const test of frontier.likelyTestSurface) {
        lines.push(`- ${test}`)
      }
    }

    if (frontier.recentRelevantChanges.length > 0) {
      lines.push("\nRECENT RELEVANT CHANGES:")
      for (const change of frontier.recentRelevantChanges) {
        lines.push(`- ${change}`)
      }
    }

    if (frontier.unresolvedAmbiguities.length > 0) {
      lines.push("\nUNRESOLVED AMBIGUITIES:")
      for (const amb of frontier.unresolvedAmbiguities) {
        lines.push(`- ${amb}`)
      }
    }

    return lines.join("\n")
  }
}

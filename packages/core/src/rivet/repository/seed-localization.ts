import type { ProjectGraph, ProjectNode } from "./project-graph"
import type { TaskSignature } from "./task-signature"

export interface SeedCandidate {
  readonly nodeId: string
  readonly label: string
  readonly kind: string
  readonly fileId?: string
  readonly rrfScore: number
  readonly channels: readonly string[]
}

export interface LocalizationOptions {
  readonly maxSeeds?: number
  readonly recentChangedFiles?: readonly string[]
  readonly rrfConstantK?: number
}

export class SeedLocalizer {
  static readonly DEFAULT_RRF_K = 60
  static readonly DEFAULT_MAX_SEEDS = 50

  /**
   * Runs multi-channel seed localization and merges results via Reciprocal Rank Fusion (RRF).
   */
  static localize(
    graph: ProjectGraph,
    signature: TaskSignature,
    options: LocalizationOptions = {}
  ): readonly SeedCandidate[] {
    const k = options.rrfConstantK ?? this.DEFAULT_RRF_K
    const maxSeeds = options.maxSeeds ?? this.DEFAULT_MAX_SEEDS

    const channelRankings: Map<string, string[]> = new Map()

    // Channel 1: Exact symbol / reference search
    channelRankings.set("exact_symbol", this.channelExactSymbol(graph, signature))

    // Channel 2: Path / module lexical search
    channelRankings.set("path_lexical", this.channelPathLexical(graph, signature))

    // Channel 3: Lexical / BM25 token matching
    channelRankings.set("lexical_bm25", this.channelLexicalBM25(graph, signature))

    // Channel 4: Dense semantic similarity / token overlap
    channelRankings.set("semantic_overlap", this.channelSemanticOverlap(graph, signature))

    // Channel 5: ProjectGraph structural proximity (hub nodes & focus connections)
    channelRankings.set("structural_proximity", this.channelStructuralProximity(graph, signature))

    // Channel 6: Recent-change proximity
    if (options.recentChangedFiles && options.recentChangedFiles.length > 0) {
      channelRankings.set("recent_changes", this.channelRecentChanges(graph, options.recentChangedFiles))
    }

    // Channel 7: Test relationship proximity
    channelRankings.set("test_relationships", this.channelTestRelationships(graph, signature))

    // Fuse via Reciprocal Rank Fusion (RRF)
    const fusedScores = new Map<string, number>()
    const channelContributions = new Map<string, Set<string>>()

    for (const [channel, rankedIds] of channelRankings) {
      for (let rank = 0; rank < rankedIds.length; rank++) {
        const id = rankedIds[rank]!
        const rrfIncrement = 1 / (k + (rank + 1))
        fusedScores.set(id, (fusedScores.get(id) ?? 0) + rrfIncrement)

        let contribs = channelContributions.get(id)
        if (!contribs) {
          contribs = new Set()
          channelContributions.set(id, contribs)
        }
        contribs.add(channel)
      }
    }

    const sortedCandidates = Array.from(fusedScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxSeeds)
      .map(([nodeId, rrfScore]) => {
        const node = graph.getNode(nodeId)
        return {
          nodeId,
          label: node?.label ?? nodeId,
          kind: node?.kind ?? "unknown",
          fileId: node?.fileId,
          rrfScore,
          channels: Array.from(channelContributions.get(nodeId) ?? []),
        }
      })

    return sortedCandidates
  }

  private static channelExactSymbol(graph: ProjectGraph, signature: TaskSignature): string[] {
    const matched: string[] = []
    const symbolsLower = signature.possibleSymbols.map((s) => s.toLowerCase())

    for (const [id, node] of graph.nodes) {
      const labelLower = node.label.toLowerCase()
      if (symbolsLower.includes(labelLower) || symbolsLower.some((s) => labelLower.endsWith(`.${s}`))) {
        matched.push(id)
      }
    }
    return matched
  }

  private static channelPathLexical(graph: ProjectGraph, signature: TaskSignature): string[] {
    const scored: Array<{ id: string; hits: number }> = []

    for (const [id, node] of graph.nodes) {
      if (node.kind === "source_file" || node.kind === "module" || node.kind === "package") {
        const idLower = id.toLowerCase()
        let hits = 0
        for (const c of signature.concepts) {
          if (idLower.includes(c)) hits++
        }
        if (hits > 0) scored.push({ id, hits })
      }
    }

    return scored.sort((a, b) => b.hits - a.hits).map((s) => s.id)
  }

  private static channelLexicalBM25(graph: ProjectGraph, signature: TaskSignature): string[] {
    const scored: Array<{ id: string; score: number }> = []

    for (const [id, node] of graph.nodes) {
      let score = 0
      const text = `${node.label} ${JSON.stringify(node.metadata ?? {})}`.toLowerCase()

      for (const concept of signature.concepts) {
        if (text.includes(concept)) {
          // Approximate term frequency
          const matches = text.split(concept).length - 1
          score += matches * (concept.length > 4 ? 2 : 1)
        }
      }

      if (score > 0) scored.push({ id, score })
    }

    return scored.sort((a, b) => b.score - a.score).map((s) => s.id)
  }

  private static channelSemanticOverlap(graph: ProjectGraph, signature: TaskSignature): string[] {
    const scored: Array<{ id: string; score: number }> = []
    const allQueryTokens = new Set([...signature.concepts, ...signature.possibleSymbols.map((s) => s.toLowerCase())])

    for (const [id, node] of graph.nodes) {
      const nodeTokens = node.label.toLowerCase().split(/[^a-zA-Z0-9_]+/)
      let intersectCount = 0
      for (const t of nodeTokens) {
        if (t.length > 2 && allQueryTokens.has(t)) intersectCount++
      }

      if (intersectCount > 0) {
        const jaccard = intersectCount / (allQueryTokens.size + nodeTokens.length - intersectCount)
        scored.push({ id, score: jaccard })
      }
    }

    return scored.sort((a, b) => b.score - a.score).map((s) => s.id)
  }

  private static channelStructuralProximity(graph: ProjectGraph, signature: TaskSignature): string[] {
    const scored: Array<{ id: string; degree: number }> = []
    const focusSet = new Set(signature.softWorkspaceFocus.map((f) => f.toLowerCase()))

    for (const [id, node] of graph.nodes) {
      const outDeg = graph.outgoingEdges(id).length
      const inDeg = graph.incomingEdges(id).length
      let degreeScore = outDeg + inDeg

      if (focusSet.has(node.label.toLowerCase())) {
        degreeScore += 50
      }

      if (node.kind === "entrypoint") {
        degreeScore += 20
      }

      if (degreeScore > 0) scored.push({ id, degree: degreeScore })
    }

    return scored.sort((a, b) => b.degree - a.degree).map((s) => s.id)
  }

  private static channelRecentChanges(graph: ProjectGraph, recentFiles: readonly string[]): string[] {
    const ids: string[] = []
    for (const file of recentFiles) {
      const fileId = `file:${file}`
      if (graph.getNode(fileId)) {
        ids.push(fileId)
      }
      // Also include symbols defined in recent files
      for (const sym of graph.symbolsInFile(fileId)) {
        ids.push(sym)
      }
    }
    return ids
  }

  private static channelTestRelationships(graph: ProjectGraph, signature: TaskSignature): string[] {
    const testIds: string[] = []
    const conceptTerms = signature.concepts

    for (const [id, node] of graph.nodes) {
      if (node.kind === "test" || node.kind === "test_target") {
        const covers = graph.dependenciesOf(id)
        const coveredConcepts = covers.some((c) => conceptTerms.some((t) => c.toLowerCase().includes(t)))
        if (coveredConcepts) {
          testIds.push(id)
        }
      }
    }

    return testIds
  }
}

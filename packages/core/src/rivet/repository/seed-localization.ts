import { Effect } from "effect"
import type { ProjectGraph, ProjectNode } from "./project-graph"
import type { TaskSignature } from "./task-signature"
import { AssociativeRetrievalEngine } from "../recall/engine"
import { DeterministicHashEmbeddingProvider, type EmbeddingProvider } from "../recall/embedding"

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
  readonly embeddingProvider?: EmbeddingProvider
  readonly nodeEmbeddings?: Map<string, Float32Array>
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

    // Channel 3: True Robertson BM25 lexical retrieval (with IDF & length normalization)
    channelRankings.set("lexical_bm25", this.channelLexicalBM25(graph, signature))

    // Channel 4: Dense semantic vector retrieval (Cosine similarity over embeddings)
    channelRankings.set("semantic_vector", this.channelDenseSemantic(graph, signature, options))

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
    const totalDocs = graph.nodes.size
    if (totalDocs === 0) return []

    const queryTokens = Array.from(new Set(signature.concepts))
    if (queryTokens.length === 0) return []

    const docTokensMap = new Map<string, string[]>()
    const termDocFreqs = new Map<string, number>()
    let totalLen = 0

    for (const [id, node] of graph.nodes) {
      const text = `${node.label} ${node.kind} ${JSON.stringify(node.metadata ?? {})}`.toLowerCase()
      const tokens = text.split(/[^a-z0-9_.-]+/).filter((t) => t.length > 1)
      docTokensMap.set(id, tokens)
      totalLen += tokens.length

      const seen = new Set(tokens)
      for (const t of seen) {
        termDocFreqs.set(t, (termDocFreqs.get(t) ?? 0) + 1)
      }
    }

    const avgDocLen = totalLen / totalDocs
    const scored: Array<{ id: string; score: number }> = []

    for (const [id, tokens] of docTokensMap) {
      const score = AssociativeRetrievalEngine.computeBM25Score(
        queryTokens,
        tokens,
        avgDocLen,
        totalDocs,
        termDocFreqs
      )
      if (score > 0) {
        scored.push({ id, score })
      }
    }

    return scored.sort((a, b) => b.score - a.score).map((s) => s.id)
  }

  private static channelDenseSemantic(
    graph: ProjectGraph,
    signature: TaskSignature,
    options: LocalizationOptions
  ): string[] {
    const queryText = `${signature.rawPrompt} ${signature.concepts.join(" ")} ${signature.possibleSymbols.join(" ")}`
    const scored: Array<{ id: string; score: number }> = []

    const hashProvider = new DeterministicHashEmbeddingProvider(128)
    const queryResult = Effect.runSync(hashProvider.embed([queryText]))
    const queryVec = queryResult[0]?.values
    if (!queryVec) return []

    for (const [id, node] of graph.nodes) {
      let docVec = options.nodeEmbeddings?.get(id)
      if (!docVec) {
        const text = `${node.label} ${node.kind} ${node.fileId ?? ""}`
        const res = Effect.runSync(hashProvider.embed([text]))
        docVec = res[0]?.values
      }

      if (docVec) {
        const sim = AssociativeRetrievalEngine.cosineSimilarity(queryVec, docVec)
        if (sim > 0.05) {
          scored.push({ id, score: sim })
        }
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

import {
  type RecallCandidate,
  type RecallChannelScores,
  type RecallDocument,
  type RecallQuery,
  type RelationshipKind,
} from "./types"

export interface RetrievalWeights {
  readonly semantic: number
  readonly lexical: number
  readonly graph: number
  readonly temporal: number
  readonly scope: number
}

export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = {
  semantic: 0.35,
  lexical: 0.30,
  graph: 0.20,
  temporal: 0.10,
  scope: 0.05,
}

export interface RankOptions {
  readonly docEmbeddings?: Map<string, Float32Array>
  readonly queryEmbedding?: Float32Array
  readonly maxGraphHop?: number
}

const RELATIONSHIP_WEIGHTS: Record<RelationshipKind, number> = {
  FAILED_BECAUSE: 0.9,
  RESOLVED_BY: 0.9,
  SUPERSEDES: 0.8,
  CONTRADICTS: 0.8,
  SUPPORTS: 0.6,
  DEPENDS_ON: 0.6,
  TOUCHED: 0.5,
  TESTED_BY: 0.5,
  OCCURRED_IN: 0.4,
}

/**
 * AssociativeRetrievalEngine implements true multi-channel retrieval:
 * 1. Dense Semantic Vector Channel (Cosine distance over real embedding vectors)
 * 2. Lexical Channel (BM25 term matching with IDF and length normalization)
 * 3. Topological Graph Channel (0-hop, 1-hop, and bounded 2-hop relationship expansion)
 * 4. Temporal Decay Channel (Exponential revision/time decay)
 * 5. Scope Channel (Repository & path pattern boundary relevance)
 * 6. Multi-Channel Fusion & Pruning
 */
export class AssociativeRetrievalEngine {
  /**
   * Computes cosine similarity between two float vectors.
   */
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!
      normA += a[i]! * a[i]!
      normB += b[i]! * b[i]!
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0
    return Math.max(0, Math.min(1, dot / denom))
  }

  /**
   * Computes BM25 lexical score for document against query tokens.
   */
  static computeBM25Score(
    queryTokens: readonly string[],
    docTokens: readonly string[],
    avgDocLen: number,
    totalDocs: number,
    termDocFreqs: Map<string, number>,
  ): number {
    if (queryTokens.length === 0 || docTokens.length === 0) return 0

    const k1 = 1.2
    const b = 0.75
    const docLen = docTokens.length

    const docFreqs = new Map<string, number>()
    for (const t of docTokens) {
      docFreqs.set(t, (docFreqs.get(t) ?? 0) + 1)
    }

    let score = 0
    for (const token of queryTokens) {
      const f = docFreqs.get(token) ?? 0
      if (f === 0) continue

      const df = termDocFreqs.get(token) ?? 1
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5))
      const tf = (f * (k1 + 1)) / (f + k1 * (1 - b + b * (docLen / (avgDocLen || 1))))
      score += Math.max(0, idf) * tf
    }

    // Normalize to 0..1 scale
    return Math.min(1.0, score / (queryTokens.length * 2.5 || 1.0))
  }

  /**
   * Evaluates graph neighborhood relevance:
   * - 0-hop direct symbol / claim match
   * - 1-hop typed edge traversal
   * - Bounded 2-hop transitive neighbor expansion
   */
  static computeGraphScore(
    doc: RecallDocument,
    query: RecallQuery,
    allDocsMap: Map<string, RecallDocument>,
    maxHop: number = 2,
  ): number {
    let score = 0

    // 0-Hop: Direct symbol intersection
    const activeSymbols = query.activeSymbols ?? []
    const docSymbolSet = new Set((doc.relatedSymbols ?? []).map((s) => s.toLowerCase()))
    for (const qSym of activeSymbols) {
      if (docSymbolSet.has(qSym.toLowerCase())) {
        score += 0.4
      }
    }

    // 0-Hop: Direct claim reference
    const activeClaims = query.activeClaims ?? []
    const docSourceSet = new Set((doc.sourceRefs ?? []).map((s) => s.toLowerCase()))
    for (const qClaim of activeClaims) {
      if (docSourceSet.has(qClaim.toLowerCase())) {
        score += 0.5
      }
    }

    // 1-Hop: Direct relationship edge traversal
    const visitedHop1 = new Set<string>()
    if (doc.relationships) {
      for (const rel of doc.relationships) {
        visitedHop1.add(rel.targetId)
        if (activeClaims.includes(rel.targetId)) {
          const edgeWeight = RELATIONSHIP_WEIGHTS[rel.kind] ?? 0.5
          score += edgeWeight * 0.7
        }
      }
    }

    // 2-Hop: Bounded transitive neighborhood traversal
    if (maxHop >= 2 && doc.relationships) {
      for (const rel of doc.relationships) {
        const neighbor = allDocsMap.get(rel.targetId)
        if (!neighbor || !neighbor.relationships) continue

        for (const neighborRel of neighbor.relationships) {
          if (visitedHop1.has(neighborRel.targetId)) continue
          if (activeClaims.includes(neighborRel.targetId)) {
            const edge1Weight = RELATIONSHIP_WEIGHTS[rel.kind] ?? 0.5
            const edge2Weight = RELATIONSHIP_WEIGHTS[neighborRel.kind] ?? 0.5
            // 2-hop distance decay (0.4x factor)
            score += edge1Weight * edge2Weight * 0.4
          }
        }
      }
    }

    return Math.min(1.0, score)
  }

  /**
   * Evaluates temporal recency decay based on revision and observed time.
   */
  static computeTemporalScore(doc: RecallDocument, query: RecallQuery): number {
    const docRev = doc.validFromRevision?.value ?? 0n
    const queryRev = query.revision?.value ?? 0n
    const revDelta = Number(queryRev > docRev ? queryRev - docRev : 0n)

    // Exponential decay by revision distance
    const revScore = Math.exp(-revDelta / 20.0)

    // Age decay by hours
    const ageHours = Math.max(0, (Date.now() - doc.observedAt) / (1000 * 60 * 60))
    const ageScore = Math.exp(-ageHours / 168.0) // 1-week half-ish life

    return 0.7 * revScore + 0.3 * ageScore
  }

  /**
   * Evaluates scope relevance (repository and path hierarchy).
   */
  static computeScopeScore(doc: RecallDocument, query: RecallQuery): number {
    if (!query.scope || doc.scope.repository !== query.scope.repository) return 0.0
    if (!doc.scope.pathPattern || !query.scope.pathPattern) return 0.8
    const cleanDoc = doc.scope.pathPattern.replace(/[\*\/]+$/, "")
    const cleanQuery = query.scope.pathPattern.replace(/[\*\/]+$/, "")
    if (cleanDoc === cleanQuery) return 1.0
    if (cleanQuery.startsWith(cleanDoc) || cleanDoc.startsWith(cleanQuery)) {
      return 0.7
    }
    return 0.2
  }

  /**
   * Ranks documents across all channels for a given query.
   */
  static rank(
    documents: readonly RecallDocument[],
    query: RecallQuery,
    weights: RetrievalWeights = DEFAULT_RETRIEVAL_WEIGHTS,
    options: RankOptions = {},
  ): readonly RecallCandidate[] {
    if (documents.length === 0) return []

    const prompt = query.prompt ?? (query as any).query ?? ""
    const goal = query.goal ?? ""
    const queryText = `${prompt} ${goal}`.trim()
    const queryTokens = tokenize(queryText)
    const maxGraphHop = options.maxGraphHop ?? 2

    // Build document token cache & term document frequencies
    const docTokensList: string[][] = []
    const termDocFreqs = new Map<string, number>()
    const docMap = new Map<string, RecallDocument>()
    let totalTokenCount = 0

    for (const doc of documents) {
      docMap.set(doc.id, doc)
      const tokens = tokenize(`${doc.text} ${doc.summary ?? ""} ${(doc.relatedSymbols ?? []).join(" ")}`)
      docTokensList.push(tokens)
      totalTokenCount += tokens.length

      const uniqueTokensInDoc = new Set(tokens)
      for (const t of uniqueTokensInDoc) {
        termDocFreqs.set(t, (termDocFreqs.get(t) ?? 0) + 1)
      }
    }

    const avgDocLen = totalTokenCount / (documents.length || 1)
    const candidates: RecallCandidate[] = []

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!
      const docTokens = docTokensList[i]!

      // 1. Semantic channel
      let semanticScore = 0
      if (options.queryEmbedding && options.docEmbeddings?.has(doc.id)) {
        const docVec = options.docEmbeddings.get(doc.id)!
        semanticScore = this.cosineSimilarity(options.queryEmbedding, docVec)
      }

      // 2. Lexical channel (BM25)
      const lexicalScore = this.computeBM25Score(queryTokens, docTokens, avgDocLen, documents.length, termDocFreqs)

      // 3. Graph channel (0-hop, 1-hop, 2-hop)
      const graphScore = this.computeGraphScore(doc, query, docMap, maxGraphHop)

      // 4. Temporal decay channel
      const temporalScore = this.computeTemporalScore(doc, query)

      // 5. Scope relevance channel
      const scopeScore = this.computeScopeScore(doc, query)

      // Prune candidates that have no relevance across semantic, lexical, or graph channels
      if (semanticScore < 0.25 && lexicalScore === 0 && graphScore === 0) {
        continue
      }

      const compositeScore =
        weights.semantic * semanticScore +
        weights.lexical * lexicalScore +
        weights.graph * graphScore +
        weights.temporal * temporalScore +
        weights.scope * scopeScore

      const scores: RecallChannelScores = {
        semanticScore,
        lexicalScore,
        graphScore,
        temporalScore,
        scopeScore,
        compositeScore,
      }

      candidates.push({ document: doc, scores })
    }

    // Fallback: If no candidate passed lexical/graph/semantic filters (e.g. cross-lingual or broad overview query),
    // retain authoritative and recent memories ranked by temporal, scope, and status weights.
    if (candidates.length === 0 && documents.length > 0) {
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i]!
        const temporalScore = this.computeTemporalScore(doc, query)
        const scopeScore = this.computeScopeScore(doc, query)
        const statusBonus = doc.epistemicStatus === "verified" ? 0.3 : doc.epistemicStatus === "supported" ? 0.2 : 0.1
        const compositeScore = weights.temporal * temporalScore + weights.scope * scopeScore + statusBonus
        candidates.push({
          document: doc,
          scores: {
            semanticScore: 0,
            lexicalScore: 0,
            graphScore: 0,
            temporalScore,
            scopeScore,
            compositeScore,
          },
        })
      }
    }

    // Sort descending by composite score
    candidates.sort((a, b) => b.scores.compositeScore - a.scores.compositeScore)

    const limit = query.limit ?? 10
    return candidates.slice(0, limit)
  }
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-./]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

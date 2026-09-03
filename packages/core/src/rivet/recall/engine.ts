import {
  type RecallCandidate,
  type RecallChannelScores,
  type RecallDocument,
  type RecallQuery,
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

const EMBEDDING_DIM = 128

/**
 * AssociativeRetrievalEngine implements multi-channel retrieval:
 * 1. Vector (Dense semantic similarity via subword feature hashing)
 * 2. Lexical (BM25 term matching over prompt and goal)
 * 3. Graph (Multi-hop topological neighbor expansion)
 * 4. Temporal (Revision & timestamp decay)
 * 5. Scope (Repository & path boundary relevance)
 * 6. Fusion & Ranking (Weighted multi-channel score)
 */
export class AssociativeRetrievalEngine {
  /**
   * Computes dense feature vector for text.
   */
  static computeEmbedding(text: string): Float32Array {
    const vec = new Float32Array(EMBEDDING_DIM)
    const tokens = tokenize(text)
    if (tokens.length === 0) return vec

    for (const token of tokens) {
      // Unigram hash
      const h1 = hashString(token) % EMBEDDING_DIM
      vec[Math.abs(h1)] += 1.0

      // Subword character trigrams
      if (token.length >= 3) {
        for (let i = 0; i <= token.length - 3; i++) {
          const tri = token.slice(i, i + 3)
          const h2 = hashString(tri) % EMBEDDING_DIM
          vec[Math.abs(h2)] += 0.5
        }
      }
    }

    // Normalize to unit length
    let norm = 0
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      norm += vec[i] * vec[i]
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        vec[i] /= norm
      }
    }

    return vec
  }

  /**
   * Computes cosine similarity between two unit vectors.
   */
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      dot += a[i] * b[i]
    }
    return Math.max(0, Math.min(1, dot))
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
   * Evaluates graph neighborhood relevance based on active symbols, active claims, and graph relationships.
   */
  static computeGraphScore(
    doc: RecallDocument,
    query: RecallQuery,
    allDocsMap: Map<string, RecallDocument>,
  ): number {
    let score = 0

    // Direct symbol intersection
    const docSymbolSet = new Set(doc.relatedSymbols.map((s) => s.toLowerCase()))
    for (const qSym of query.activeSymbols) {
      if (docSymbolSet.has(qSym.toLowerCase())) {
        score += 0.4
      }
    }

    // Direct claim reference
    const docSourceSet = new Set(doc.sourceRefs.map((s) => s.toLowerCase()))
    for (const qClaim of query.activeClaims) {
      if (docSourceSet.has(qClaim.toLowerCase())) {
        score += 0.5
      }
    }

    // Relationship graph edge traversal (1-hop)
    if (doc.relationships) {
      for (const rel of doc.relationships) {
        if (query.activeClaims.includes(rel.targetId)) {
          if (rel.kind === "RESOLVED_BY" || rel.kind === "SUPERSEDES") score += 0.6
          else if (rel.kind === "FAILED_BECAUSE" || rel.kind === "CONTRADICTS") score += 0.5
          else score += 0.3
        }
      }
    }

    return Math.min(1.0, score)
  }

  /**
   * Computes temporal decay score.
   */
  static computeTemporalScore(doc: RecallDocument, query: RecallQuery): number {
    if (!doc.validFromRevision) return 0.5
    const diff = Number(query.revision.value - doc.validFromRevision.value)
    if (diff <= 0) return 1.0
    // Exponential decay with half-life of 20 revisions
    return Math.exp(-diff / 20)
  }

  /**
   * Computes scope relevance score.
   */
  static computeScopeScore(doc: RecallDocument, query: RecallQuery): number {
    if (doc.scope.repository !== query.scope.repository) return 0.2
    if (!doc.scope.pathPattern || !query.scope.pathPattern) return 0.8
    if (doc.scope.pathPattern === query.scope.pathPattern) return 1.0
    if (doc.scope.pathPattern.startsWith(query.scope.pathPattern) || query.scope.pathPattern.startsWith(doc.scope.pathPattern)) {
      return 0.7
    }
    return 0.4
  }

  /**
   * Ranks documents across all channels for a given query.
   */
  static rank(
    documents: readonly RecallDocument[],
    query: RecallQuery,
    weights: RetrievalWeights = DEFAULT_RETRIEVAL_WEIGHTS,
  ): readonly RecallCandidate[] {
    if (documents.length === 0) return []

    const queryText = `${query.prompt} ${query.goal}`.trim()
    const queryEmbedding = this.computeEmbedding(queryText)
    const queryTokens = tokenize(queryText)

    // Build document token cache & term document frequencies
    const docTokensList: string[][] = []
    const termDocFreqs = new Map<string, number>()
    const docMap = new Map<string, RecallDocument>()
    let totalTokenCount = 0

    for (const doc of documents) {
      docMap.set(doc.id, doc)
      const tokens = tokenize(`${doc.text} ${doc.summary ?? ""} ${doc.relatedSymbols.join(" ")}`)
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
      const docEmbedding = this.computeEmbedding(`${doc.text} ${doc.summary ?? ""}`)

      const semanticScore = this.cosineSimilarity(queryEmbedding, docEmbedding)
      const lexicalScore = this.computeBM25Score(queryTokens, docTokens, avgDocLen, documents.length, termDocFreqs)
      const graphScore = this.computeGraphScore(doc, query, docMap)
      const temporalScore = this.computeTemporalScore(doc, query)
      const scopeScore = this.computeScopeScore(doc, query)

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

    // Sort descending by composite score
    candidates.sort((a, b) => b.scores.compositeScore - a.scores.compositeScore)

    return candidates.slice(0, query.limit)
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-./]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return hash >>> 0
}

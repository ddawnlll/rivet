import { Effect } from "effect"
import { Surreal, RecordId } from "surrealdb"
import { createNodeEngines } from "@surrealdb/node"
import {
  type MemoryId,
  type MemoryKind,
  type RecallCandidate,
  type RecallDocument,
  type RecallQuery,
  type RecallRelationship,
  type RecallSource,
  type RecallStore,
  type RelationshipKind,
  RecallError,
  createMemoryId,
} from "./types"
import { type EmbeddingProvider } from "./embedding"
import {
  AssociativeRetrievalEngine,
  DEFAULT_RETRIEVAL_WEIGHTS,
  type RetrievalWeights,
} from "./engine"
import { NoesisRecallProjector } from "./projector"
import {
  type EpistemicStatus,
  Revision,
  Scope,
  createWorkspaceId,
} from "../types"

export interface SurrealRecallStoreOptions {
  readonly connectionUrl?: string
  readonly namespace?: string
  readonly database?: string
  readonly weights?: RetrievalWeights
  readonly embeddingProvider?: EmbeddingProvider
}

/**
 * SurrealRecallStore provides the production-grade, persistent embedded associative recall store
 * backed by SurrealDB and RocksDB (or in-memory for testing).
 *
 * Implements native HNSW vector index search, native BM25 full-text indexing,
 * and native typed graph relationship traversal.
 */
export class SurrealRecallStore implements RecallStore {
  private db: Surreal | null = null
  private connected = false
  private initPromise: Promise<void> | null = null
  private connectionUrl: string
  private namespace: string
  private database: string
  private weights: RetrievalWeights
  public embeddingProvider?: EmbeddingProvider

  constructor(
    storagePathOrOptions?: string | SurrealRecallStoreOptions,
    embeddingProvider?: EmbeddingProvider,
    weights?: RetrievalWeights,
  ) {
    if (typeof storagePathOrOptions === "string") {
      const p = storagePathOrOptions.trim()
      if (p === ":memory:" || p === "mem://" || p === "memory") {
        this.connectionUrl = "mem://"
      } else if (p.startsWith("rocksdb://") || p.startsWith("surrealkv://") || p.startsWith("mem://")) {
        this.connectionUrl = p
      } else {
        this.connectionUrl = `rocksdb://${p}`
      }
      this.namespace = "rivet"
      this.database = "recall"
      this.embeddingProvider = embeddingProvider
      this.weights = weights ?? DEFAULT_RETRIEVAL_WEIGHTS
    } else {
      const opts = storagePathOrOptions ?? {}
      this.connectionUrl = opts.connectionUrl ?? "mem://"
      this.namespace = opts.namespace ?? "rivet"
      this.database = opts.database ?? "recall"
      this.embeddingProvider = opts.embeddingProvider ?? embeddingProvider
      this.weights = opts.weights ?? weights ?? DEFAULT_RETRIEVAL_WEIGHTS
    }
  }

  /**
   * Initializes the SurrealDB embedded connection and ensures schema & indexes.
   */
  private ensureConnected(): Promise<Surreal> {
    if (this.db && this.connected) return Promise.resolve(this.db)
    if (this.initPromise) return this.initPromise.then(() => this.db!)

    this.initPromise = (async () => {
      const db = new Surreal({ engines: createNodeEngines() })
      await db.connect(this.connectionUrl)
      await db.use({ namespace: this.namespace, database: this.database })

      // Schema definition for documents and relations
      await db.query(`
        DEFINE TABLE recall_document SCHEMALESS;
        DEFINE TABLE recall_relation SCHEMALESS;

        DEFINE ANALYZER OVERWRITE recall_analyzer TOKENIZERS class FILTERS lowercase, ascii;
        DEFINE INDEX OVERWRITE idx_recall_text_ft ON recall_document FIELDS text FULLTEXT ANALYZER recall_analyzer BM25 HIGHLIGHTS;
      `)

      // If embedding provider is configured, create HNSW vector index with matching dimension
      if (this.embeddingProvider) {
        const dim = this.embeddingProvider.dimension
        await db.query(`
          DEFINE INDEX OVERWRITE idx_recall_embedding ON recall_document FIELDS embedding HNSW DIMENSION ${dim} DIST COSINE TYPE F32;
        `)
      }

      this.db = db
      this.connected = true
    })()

    return this.initPromise.then(() => this.db!)
  }

  index = (documents: readonly RecallDocument[]): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.gen(function* () {
      if (documents.length === 0) return

      const db = yield* Effect.tryPromise({
        try: () => self.ensureConnected(),
        catch: (err) => new RecallError("Failed to connect to SurrealDB", err),
      })

      // 1. Compute embeddings if provider is available
      let embeddings: readonly Float32Array[] | null = null
      if (self.embeddingProvider) {
        const textsToEmbed = documents.map((d) => `${d.text} ${d.summary ?? ""}`.trim())
        const res = yield* self.embeddingProvider.embed(textsToEmbed).pipe(
          Effect.orElseSucceed(() => [] as const),
        )
        if (res.length === documents.length) {
          embeddings = res.map((r) => r.values)
        }
      }

      // 2. High-performance batch insertion in chunks of 200
      const CHUNK_SIZE = 200
      for (let offset = 0; offset < documents.length; offset += CHUNK_SIZE) {
        const chunk = documents.slice(offset, offset + CHUNK_SIZE)
        const batchRecords: any[] = []
        const relationsToInsert: { from: RecordId; to: RecordId; kind: RelationshipKind; weight: number; targetId: string }[] = []

        for (let j = 0; j < chunk.length; j++) {
          const docIndex = offset + j
          const doc = chunk[j]!
          const emb = embeddings ? Array.from(embeddings[docIndex]!) : null
          const sanitizedId = sanitizeId(doc.id)
          const docRecordId = new RecordId("recall_document", sanitizedId)

          batchRecords.push({
            id: docRecordId,
            doc_id: doc.id,
            kind: doc.kind,
            text: doc.text,
            summary: doc.summary ?? null,
            workspace_id: doc.workspaceId,
            scope_repo: doc.scope.repository,
            scope_pattern: doc.scope.pathPattern ?? null,
            epistemic_status: doc.epistemicStatus,
            valid_from_rev: doc.validFromRevision ? doc.validFromRevision.toString() : null,
            valid_to_rev: doc.validToRevision ? doc.validToRevision.toString() : null,
            observed_at: doc.observedAt,
            related_symbols: [...doc.relatedSymbols],
            sourceRefs: [...doc.sourceRefs],
            metadata: doc.metadata ?? {},
            embedding: emb,
            embedding_dim: emb ? emb.length : null,
          })

          if (doc.relationships && doc.relationships.length > 0) {
            for (const rel of doc.relationships) {
              const targetSanitized = sanitizeId(rel.targetId)
              relationsToInsert.push({
                from: docRecordId,
                to: new RecordId("recall_document", targetSanitized),
                kind: rel.kind,
                weight: rel.weight ?? 1.0,
                targetId: rel.targetId,
              })
            }
          }
        }

        yield* Effect.tryPromise({
          try: async () => {
            // Bulk insert/update documents
            await db.query(
              `INSERT INTO recall_document $batch ON DUPLICATE KEY UPDATE
                text = $input.text,
                summary = $input.summary,
                embedding = $input.embedding,
                embedding_dim = $input.embedding_dim,
                epistemic_status = $input.epistemic_status,
                observed_at = $input.observed_at;`,
              { batch: batchRecords },
            )

            // Insert relations if any
            for (const rel of relationsToInsert) {
              await db.query(
                `RELATE $from->recall_relation->$to
                 SET kind = $kind, weight = $weight, target_id = $targetId;`,
                rel,
              )
            }
          },
          catch: (err) => {
            return new RecallError(`Failed to batch index documents in SurrealDB`, err)
          },
        })
      }
    })
  }

  remove = (ids: readonly MemoryId[]): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.gen(function* () {
      if (ids.length === 0) return
      const db = yield* Effect.tryPromise({
        try: () => self.ensureConnected(),
        catch: (err) => new RecallError("Failed to connect to SurrealDB", err),
      })

      yield* Effect.tryPromise({
        try: async () => {
          for (const id of ids) {
            const sanitized = sanitizeId(id)
            const recordId = new RecordId("recall_document", sanitized)
            await db.query(
              `DELETE FROM recall_relation WHERE in = $recordId OR out = $recordId;
               DELETE $recordId;`,
              {
                recordId,
              },
            )
          }
        },
        catch: (err) => new RecallError("Failed to remove documents from SurrealDB", err),
      })
    })
  }

  recall = (query: RecallQuery): Effect.Effect<readonly RecallCandidate[], RecallError> => {
    const self = this
    return Effect.gen(function* () {
      const db = yield* Effect.tryPromise({
        try: () => self.ensureConnected(),
        catch: (err) => new RecallError("Failed to connect to SurrealDB", err),
      })

      // 1. Vector Search (Native HNSW Approximate Nearest Neighbor)
      const vectorScores = new Map<string, number>()
      if (self.embeddingProvider) {
        const queryText = `${query.prompt} ${query.goal}`.trim()
        const embRes = yield* self.embeddingProvider.embed([queryText]).pipe(
          Effect.orElseSucceed(() => [] as const),
        )
        if (embRes.length > 0 && embRes[0]) {
          const queryVec = Array.from(embRes[0].values)
          const k = Math.min(Math.max(query.limit * 3, 20), 100)

          const vecResult = yield* Effect.tryPromise({
            try: () =>
              db.query<any[][]>(
                `SELECT doc_id, text, vector::distance::knn() AS dist
                 FROM recall_document
                 WHERE embedding <|${k}, 40|> $queryVec;`,
                { queryVec },
              ),
            catch: (err) => new RecallError("Vector search query failed", err),
          }).pipe(Effect.orElseSucceed(() => [] as any[][]))

          const rows = Array.isArray(vecResult) && vecResult[0] && Array.isArray(vecResult[0]) ? vecResult[0] : []
          for (const row of rows) {
            const docId = row.doc_id ?? String(row.id).replace(/^recall_document:/, "")
            const dist = typeof row.dist === "number" ? row.dist : 1.0
            // Cosine distance in SurrealDB: 0 = identical, 1 = orthogonal, 2 = opposite
            const similarity = Math.max(0, 1.0 - dist)
            vectorScores.set(docId, similarity)
          }
        }
      }

      // 2. Lexical Search (Native Full-Text BM25)
      const lexicalScores = new Map<string, number>()
      const searchTerms = tokenize(query.prompt + " " + query.goal).join(" ")
      const cleanTerms = searchTerms.replace(/['"\\\\]/g, " ").trim()
      if (cleanTerms.length > 0) {
        const ftLimit = Math.min(query.limit * 4, 100)
        const ftResult = yield* Effect.tryPromise({
          try: () =>
            db.query<any[][]>(
              `SELECT doc_id, text, search::score(0) AS ft_score
               FROM recall_document
               WHERE text @0@ '${cleanTerms}'
               ORDER BY ft_score DESC
               LIMIT ${ftLimit};`,
            ),
          catch: (err) => new RecallError("Full-text query failed", err),
        }).pipe(Effect.orElseSucceed(() => [] as any[][]))

        const rows = Array.isArray(ftResult) && ftResult[0] && Array.isArray(ftResult[0]) ? ftResult[0] : []
        let maxScore = 1.0
        for (const r of rows) {
          if (typeof r.ft_score === "number" && r.ft_score > maxScore) maxScore = r.ft_score
        }
        for (const row of rows) {
          const docId = row.doc_id ?? String(row.id).replace(/^recall_document:/, "")
          const raw = typeof row.ft_score === "number" ? row.ft_score : 0
          lexicalScores.set(docId, maxScore > 0 ? Math.min(1.0, raw / maxScore) : 0)
        }
      }

      // 3. Load all candidate documents from SurrealDB
      const allDocsResult = yield* Effect.tryPromise({
        try: () => db.query<any[][]>(`SELECT * FROM recall_document;`),
        catch: (err) => new RecallError("Failed to fetch documents from SurrealDB", err),
      })
      const allRows = Array.isArray(allDocsResult) && allDocsResult[0] && Array.isArray(allDocsResult[0]) ? allDocsResult[0] : []
      if (allRows.length === 0) return []

      // 4. Load all relations for graph expansion
      const allRelsResult = yield* Effect.tryPromise({
        try: () => db.query<any[][]>(`SELECT in, out, kind, weight, target_id FROM recall_relation;`),
        catch: (err) => new RecallError("Failed to fetch relations from SurrealDB", err),
      }).pipe(Effect.orElseSucceed(() => [] as any[][]))
      const allRels = Array.isArray(allRelsResult) && allRelsResult[0] && Array.isArray(allRelsResult[0]) ? allRelsResult[0] : []

      // Build in-memory graph structures for multi-hop expansion
      const graphEdges = new Map<string, { targetId: string; kind: RelationshipKind; weight: number }[]>()
      for (const rel of allRels) {
        const fromId = String(rel.in).replace(/^recall_document:/, "")
        const toId = String(rel.target_id ?? rel.out).replace(/^recall_document:/, "")
        const kind = (rel.kind ?? "SUPPORTS") as RelationshipKind
        const weight = typeof rel.weight === "number" ? rel.weight : 1.0
        const list = graphEdges.get(fromId) ?? []
        list.push({ targetId: toId, kind, weight })
        graphEdges.set(fromId, list)
      }

      // Convert rows to RecallDocuments
      const documents: RecallDocument[] = allRows.map((row) => {
        const docId = (row.doc_id ?? String(row.id).replace(/^recall_document:/, "")) as MemoryId
        const scope = row.scope_pattern
          ? Scope.path(
              row.scope_repo,
              row.scope_pattern,
              row.valid_from_rev ? Revision.from(row.valid_from_rev.replace(/^r/, "")) : Revision.ZERO,
            )
          : Scope.global(
              row.scope_repo,
              row.valid_from_rev ? Revision.from(row.valid_from_rev.replace(/^r/, "")) : Revision.ZERO,
            )

        const rels: RecallRelationship[] = (graphEdges.get(docId) ?? []).map((e) => ({
          targetId: e.targetId as MemoryId,
          kind: e.kind,
          weight: e.weight,
        }))

        return {
          id: docId,
          kind: row.kind,
          text: row.text,
          summary: row.summary ?? undefined,
          workspaceId: createWorkspaceId(row.workspace_id),
          scope,
          sourceRefs: Array.isArray(row.source_refs) ? row.source_refs : [],
          relatedSymbols: Array.isArray(row.related_symbols) ? row.related_symbols : [],
          epistemicStatus: row.epistemic_status as EpistemicStatus,
          validFromRevision: row.valid_from_rev ? Revision.from(row.valid_from_rev.replace(/^r/, "")) : undefined,
          validToRevision: row.valid_to_rev ? Revision.from(row.valid_to_rev.replace(/^r/, "")) : undefined,
          observedAt: typeof row.observed_at === "number" ? row.observed_at : Date.now(),
          relationships: rels,
          metadata: row.metadata ?? {},
        }
      })

      // 5. Multi-Channel Scoring & Ranking
      const docMap = new Map<string, RecallDocument>(documents.map((d) => [d.id, d]))
      const candidates: RecallCandidate[] = []

      for (const doc of documents) {
        // Channel 1: Semantic (Vector HNSW)
        const semanticScore = vectorScores.get(doc.id) ?? 0.0

        // Channel 2: Lexical (Native BM25)
        let lexicalScore = lexicalScores.get(doc.id) ?? 0.0
        if (lexicalScore === 0.0) {
          // Fallback lexical token overlap check
          lexicalScore = computeLexicalOverlap(doc, query)
        }

        // Channel 3: Graph Topological Expansion (0-hop, 1-hop, bounded 2-hop)
        const graphScore = AssociativeRetrievalEngine.computeGraphScore(doc, query, docMap, 2)

        // Channel 4: Temporal Decay
        const temporalScore = AssociativeRetrievalEngine.computeTemporalScore(doc, query)

        // Channel 5: Scope Relevance
        const scopeScore = AssociativeRetrievalEngine.computeScopeScore(doc, query)

        // Prune totally irrelevant candidates
        if (semanticScore < 0.20 && lexicalScore === 0 && graphScore === 0) {
          continue
        }

        const rawComposite =
          self.weights.semantic * semanticScore +
          self.weights.lexical * lexicalScore +
          self.weights.graph * graphScore +
          self.weights.temporal * temporalScore +
          self.weights.scope * scopeScore

        // Epistemic status weighting: superseded/rejected memories have reduced operational weight
        const statusMult =
          doc.epistemicStatus === "superseded" || doc.epistemicStatus === "rejected"
            ? 0.7
            : doc.epistemicStatus === "invalidated"
              ? 0.4
              : 1.0
        const compositeScore = rawComposite * statusMult

        candidates.push({
          document: doc,
          scores: {
            semanticScore,
            lexicalScore,
            graphScore,
            temporalScore,
            scopeScore,
            compositeScore,
          },
        })
      }

      // Sort descending by composite score
      candidates.sort((a, b) => b.scores.compositeScore - a.scores.compositeScore)
      return candidates.slice(0, query.limit)
    })
  }

  rebuild = (source: RecallSource): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.gen(function* () {
      const db = yield* Effect.tryPromise({
        try: () => self.ensureConnected(),
        catch: (err) => new RecallError("Failed to connect to SurrealDB", err),
      })

      // Clear all existing recall tables
      yield* Effect.tryPromise({
        try: async () => {
          await db.query(`DELETE FROM recall_relation; DELETE FROM recall_document;`)
        },
        catch: (err) => new RecallError("Failed to clear tables during rebuild", err),
      })

      let projected: readonly RecallDocument[] = []
      if (source.documents) {
        projected = source.documents
      } else if (source.hardState) {
        projected = NoesisRecallProjector.projectFromHardState(source.hardState)
      } else if (source.events) {
        projected = NoesisRecallProjector.projectFromEvents(source.events)
      }

      yield* self.index(projected)
    })
  }

  count = (): Effect.Effect<number, RecallError> => {
    const self = this
    return Effect.gen(function* () {
      const db = yield* Effect.tryPromise({
        try: () => self.ensureConnected(),
        catch: (err) => new RecallError("Failed to connect to SurrealDB", err),
      })

      const res = yield* Effect.tryPromise({
        try: () => db.query<any[][]>(`SELECT count() FROM recall_document GROUP ALL;`),
        catch: (err) => new RecallError("Failed to count documents in SurrealDB", err),
      })

      const rows = Array.isArray(res) && res[0] && Array.isArray(res[0]) ? res[0] : []
      if (rows.length > 0 && typeof rows[0].count === "number") {
        return rows[0].count
      }
      return 0
    })
  }

  /**
   * Graceful close of the underlying embedded database connection.
   */
  close = (): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.tryPromise({
      try: async () => {
        if (self.db && self.connected) {
          await self.db.close()
          self.db = null
          self.connected = false
          self.initPromise = null
        }
      },
      catch: (err) => new RecallError("Failed to close SurrealDB connection", err),
    })
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-./]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

function computeLexicalOverlap(doc: RecallDocument, query: RecallQuery): number {
  const queryTokens = new Set(tokenize(`${query.prompt} ${query.goal}`))
  if (queryTokens.size === 0) return 0.0
  const docTokens = new Set(tokenize(`${doc.text} ${doc.summary ?? ""}`))
  let matches = 0
  for (const token of queryTokens) {
    if (docTokens.has(token)) matches++
  }
  return matches / queryTokens.size
}

function computeBoundedGraphScore(
  doc: RecallDocument,
  query: RecallQuery,
  docMap: Map<string, RecallDocument>,
  graphEdges: Map<string, { targetId: string; kind: RelationshipKind; weight: number }[]>,
): number {
  let score = 0.0

  // 0-hop direct symbol match
  if (query.activeSymbols.length > 0 && doc.relatedSymbols.length > 0) {
    const matchedSymbols = doc.relatedSymbols.filter((s) => query.activeSymbols.includes(s))
    if (matchedSymbols.length > 0) {
      score += (matchedSymbols.length / query.activeSymbols.length) * 0.8
    }
  }

  // 0-hop active claim match
  if (query.activeClaims.includes(doc.id)) {
    score += 0.5
  }

  // 1-hop traversal across typed edges
  const edges = graphEdges.get(doc.id) ?? []
  for (const edge of edges) {
    const target = docMap.get(edge.targetId)
    if (!target) continue

    const edgeWeight = getRelationshipWeight(edge.kind)
    if (query.activeClaims.includes(edge.targetId)) {
      score += edgeWeight * 0.7
    }

    if (query.activeSymbols.length > 0 && target.relatedSymbols.length > 0) {
      const symMatches = target.relatedSymbols.filter((s) => query.activeSymbols.includes(s))
      if (symMatches.length > 0) {
        score += edgeWeight * 0.4
      }
    }

    // Bounded 2-hop traversal with distance decay (0.4x)
    const secondHopEdges = graphEdges.get(edge.targetId) ?? []
    for (const hop2 of secondHopEdges) {
      if (hop2.targetId === doc.id) continue
      const hop2Target = docMap.get(hop2.targetId)
      if (!hop2Target) continue

      const hop2Weight = getRelationshipWeight(hop2.kind) * 0.4
      if (query.activeClaims.includes(hop2.targetId)) {
        score += hop2Weight * 0.5
      }
    }
  }

  return Math.min(1.0, score)
}

function getRelationshipWeight(kind: RelationshipKind): number {
  switch (kind) {
    case "FAILED_BECAUSE":
    case "RESOLVED_BY":
      return 0.9
    case "SUPERSEDES":
    case "CONTRADICTS":
      return 0.8
    case "SUPPORTS":
    case "DEPENDS_ON":
      return 0.6
    case "TOUCHED":
    case "TESTED_BY":
      return 0.5
    case "OCCURRED_IN":
      return 0.4
    default:
      return 0.5
  }
}

function computeTemporalScore(doc: RecallDocument): number {
  const ageMs = Math.max(0, Date.now() - doc.observedAt)
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.exp(-0.01 * ageDays)
}

function computeScopeScore(doc: RecallDocument, query: RecallQuery): number {
  if (doc.scope.repository !== query.scope.repository) return 0.0
  if (!doc.scope.pathPattern || !query.scope.pathPattern) return 0.8
  const cleanDoc = doc.scope.pathPattern.replace(/[\*\/]+$/, "")
  const cleanQuery = query.scope.pathPattern.replace(/[\*\/]+$/, "")
  if (cleanDoc === cleanQuery) return 1.0
  if (cleanQuery.startsWith(cleanDoc) || cleanDoc.startsWith(cleanQuery)) {
    return 0.7
  }
  return 0.2
}

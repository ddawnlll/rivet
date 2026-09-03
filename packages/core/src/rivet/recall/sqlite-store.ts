import { Effect } from "effect"
import { Database as BunSqlite } from "bun:sqlite"
import {
  type MemoryId,
  type RecallCandidate,
  type RecallChannelScores,
  type RecallDocument,
  type RecallQuery,
  type RecallRelationship,
  type RecallSource,
  type RecallStore,
  RecallError,
} from "./types"
import { type EmbeddingProvider } from "./embedding"
import { AssociativeRetrievalEngine, type RetrievalWeights, DEFAULT_RETRIEVAL_WEIGHTS } from "./engine"
import { NoesisRecallProjector } from "./projector"
import { Revision, Scope, createWorkspaceId } from "../types"

/**
 * SqliteRecallStore serves exclusively as a DETERMINISTIC REFERENCE ORACLE and compatibility fallback.
 * It uses SQLite FTS5 for lexical matching and linear brute-force cosine scanning over BLOB float arrays
 * to provide an exhaustive ground-truth baseline against which approximate ANN retrieval is measured.
 *
 * NOT for primary production vector recall (use SurrealRecallStore).
 */
export class SqliteRecallStore implements RecallStore {
  private db: BunSqlite

  constructor(
    dbOrPath?: BunSqlite | string,
    private embeddingProvider?: EmbeddingProvider,
    private weights: RetrievalWeights = DEFAULT_RETRIEVAL_WEIGHTS,
  ) {
    if (typeof dbOrPath === "string") {
      this.db = new BunSqlite(dbOrPath)
    } else if (dbOrPath) {
      this.db = dbOrPath
    } else {
      this.db = new BunSqlite(":memory:")
    }
    this.initSchema()
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS recall_documents (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        summary TEXT,
        workspace_id TEXT NOT NULL,
        scope_repo TEXT NOT NULL,
        scope_pattern TEXT,
        epistemic_status TEXT NOT NULL,
        valid_from_rev TEXT,
        valid_to_rev TEXT,
        observed_at INTEGER NOT NULL,
        symbols_json TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        relationships_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        embedding_blob BLOB,
        embedding_dim INTEGER
      );
    `)

    try {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS recall_fts USING fts5(
          id UNINDEXED,
          text,
          summary,
          symbols,
          tokenize='porter unicode61'
        );
      `)
    } catch {
      // Fallback if FTS5 is not compiled in
    }
  }

  index = (documents: readonly RecallDocument[]): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.gen(function* () {
      if (documents.length === 0) return

      // Compute embeddings if provider is configured
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

      const insertDoc = self.db.prepare(`
        INSERT INTO recall_documents (
          id, kind, text, summary, workspace_id, scope_repo, scope_pattern,
          epistemic_status, valid_from_rev, valid_to_rev, observed_at,
          symbols_json, sources_json, relationships_json, metadata_json,
          embedding_blob, embedding_dim
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind=excluded.kind,
          text=excluded.text,
          summary=excluded.summary,
          workspace_id=excluded.workspace_id,
          scope_repo=excluded.scope_repo,
          scope_pattern=excluded.scope_pattern,
          epistemic_status=excluded.epistemic_status,
          valid_from_rev=excluded.valid_from_rev,
          valid_to_rev=excluded.valid_to_rev,
          observed_at=excluded.observed_at,
          symbols_json=excluded.symbols_json,
          sources_json=excluded.sources_json,
          relationships_json=excluded.relationships_json,
          metadata_json=excluded.metadata_json,
          embedding_blob=COALESCE(excluded.embedding_blob, recall_documents.embedding_blob),
          embedding_dim=COALESCE(excluded.embedding_dim, recall_documents.embedding_dim)
      `)

      let insertFts: any = null
      try {
        insertFts = self.db.prepare(`
          INSERT INTO recall_fts (id, text, summary, symbols) VALUES (?, ?, ?, ?)
        `)
      } catch {}

      const deleteFts: any = null
      try {
        self.db.prepare(`DELETE FROM recall_fts WHERE id = ?`)
      } catch {}

      self.db.transaction(() => {
        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i]!
          const emb = embeddings ? embeddings[i] : null
          const embBuffer = emb ? Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength) : null
          const embDim = emb ? emb.length : null

          insertDoc.run(
            doc.id,
            doc.kind,
            doc.text,
            doc.summary ?? null,
            doc.workspaceId,
            doc.scope.repository,
            doc.scope.pathPattern ?? null,
            doc.epistemicStatus ?? "valid",
            doc.validFromRevision ? doc.validFromRevision.toString() : null,
            doc.validToRevision ? doc.validToRevision.toString() : null,
            doc.observedAt,
            JSON.stringify(doc.relatedSymbols),
            JSON.stringify(doc.sourceRefs),
            JSON.stringify(doc.relationships ?? []),
            JSON.stringify(doc.metadata ?? {}),
            embBuffer,
            embDim,
          )

          if (insertFts) {
            try {
              self.db.run(`DELETE FROM recall_fts WHERE id = ?`, [doc.id])
              insertFts.run(doc.id, doc.text, doc.summary ?? "", doc.relatedSymbols.join(" "))
            } catch {}
          }
        }
      })()
    })
  }

  remove = (ids: readonly MemoryId[]): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.sync(() => {
      if (ids.length === 0) return
      self.db.transaction(() => {
        const delDoc = self.db.prepare(`DELETE FROM recall_documents WHERE id = ?`)
        for (const id of ids) {
          delDoc.run(id)
          try {
            self.db.run(`DELETE FROM recall_fts WHERE id = ?`, [id])
          } catch {}
        }
      })()
    })
  }

  recall = (query: RecallQuery): Effect.Effect<readonly RecallCandidate[], RecallError> => {
    const self = this
    return Effect.gen(function* () {
      // 1. Load all candidates from SQLite
      const rows = self.db.query(`SELECT * FROM recall_documents`).all() as any[]
      if (rows.length === 0) return []

      const documents: RecallDocument[] = []
      const docEmbeddings = new Map<string, Float32Array>()

      for (const row of rows) {
        const doc: RecallDocument = {
          id: row.id,
          kind: row.kind,
          text: row.text,
          summary: row.summary ?? undefined,
          workspaceId: createWorkspaceId(row.workspace_id),
          scope: row.scope_pattern
            ? Scope.path(
                row.scope_repo,
                row.scope_pattern,
                row.valid_from_rev ? Revision.from(row.valid_from_rev.replace(/^r/, "")) : Revision.ZERO,
              )
            : Scope.global(
                row.scope_repo,
                row.valid_from_rev ? Revision.from(row.valid_from_rev.replace(/^r/, "")) : Revision.ZERO,
              ),
          sourceRefs: JSON.parse(row.sources_json || "[]"),
          relatedSymbols: JSON.parse(row.symbols_json || "[]"),
          epistemicStatus: row.epistemic_status,
          validFromRevision: row.valid_from_rev ? Revision.from(row.valid_from_rev.replace(/^r/, "")) : undefined,
          validToRevision: row.valid_to_rev ? Revision.from(row.valid_to_rev.replace(/^r/, "")) : undefined,
          observedAt: row.observed_at,
          relationships: JSON.parse(row.relationships_json || "[]"),
          metadata: JSON.parse(row.metadata_json || "{}"),
        }
        documents.push(doc)

        if (row.embedding_blob && row.embedding_dim) {
          const buffer = row.embedding_blob as Buffer
          const floatArray = new Float32Array(
            buffer.buffer,
            buffer.byteOffset,
            buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
          )
          docEmbeddings.set(doc.id, floatArray)
        }
      }

      // 2. Query Embedding
      let queryEmbedding: Float32Array | null = null
      if (self.embeddingProvider) {
        const queryText = `${query.prompt} ${query.goal}`.trim()
        const embRes = yield* self.embeddingProvider.embed([queryText]).pipe(
          Effect.orElseSucceed(() => [] as const),
        )
        if (embRes.length > 0 && embRes[0]) {
          queryEmbedding = embRes[0].values
        }
      }

      // 3. Multi-Channel Ranking with Real Embeddings
      return AssociativeRetrievalEngine.rank(documents, query, self.weights, {
        docEmbeddings,
        queryEmbedding: queryEmbedding ?? undefined,
      })
    })
  }

  rebuild = (source: RecallSource): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.gen(function* () {
      self.db.transaction(() => {
        self.db.run(`DELETE FROM recall_documents`)
        try {
          self.db.run(`DELETE FROM recall_fts`)
        } catch {}
      })()

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
    return Effect.sync(() => {
      const res = self.db.query(`SELECT count(*) as cnt FROM recall_documents`).get() as { cnt: number }
      return res.cnt
    })
  }

  close(): void {
    this.db.close()
  }
}

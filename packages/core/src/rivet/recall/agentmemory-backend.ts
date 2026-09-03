import { Effect } from "effect"
import type {
  AgentMemoryBackend,
  MemoryIngressRecord,
  MemoryQuery,
  MemoryCandidate,
  MemoryBackendStats,
  EpistemicKind,
  AuthorityClass,
} from "./agent-memory-backend"
import { DeterministicHashEmbeddingProvider, type EmbeddingProvider } from "./embedding"

export interface AgentMemoryInternalRecord {
  id: string
  category: string
  kind: EpistemicKind
  authority: AuthorityClass
  content: string
  embedding: readonly number[]
  timestamp: number
  revision: any
  scope: any
  relationships: { targetId: string; relationType: string }[]
  metadata: Record<string, unknown>
}

export interface AgentMemoryBackendOptions {
  mode?: "controlled" | "native"
  embeddingProvider?: EmbeddingProvider
}

export class AgentMemoryBackendAdapter implements AgentMemoryBackend {
  readonly name = "agentmemory"
  readonly mode: "controlled" | "native"
  private readonly embedding: EmbeddingProvider
  private readonly store: Map<string, AgentMemoryInternalRecord> = new Map()

  private statsRecord = {
    itemCount: 0,
    writeTokens: 0,
    extractionTokens: 0,
    consolidationTokens: 0,
    recallCount: 0,
  }

  constructor(options: AgentMemoryBackendOptions = {}) {
    this.mode = options.mode ?? "controlled"
    this.embedding = options.embeddingProvider ?? new DeterministicHashEmbeddingProvider(128)
  }

  ingest(records: readonly MemoryIngressRecord[]): Effect.Effect<void, Error> {
    const self = this
    return Effect.gen(function* () {
      for (const rec of records) {
        let category = "memories"
        if (rec.kind === "hard_claim" || rec.kind === "procedure") category = "facts"
        else if (rec.kind === "decision") category = "decisions"
        else if (rec.kind === "episode" || rec.kind === "observation") category = "episodes"
        else if (rec.kind === "rejected_approach") category = "failures"
        else if (rec.kind === "tool_outcome") category = "actions"
        else category = "provisional"

        if (self.mode === "native") {
          self.statsRecord.writeTokens += Math.round(rec.content.length / 4)
          if (self.store.size > 0 && self.store.size % 20 === 0) {
            self.statsRecord.consolidationTokens += 100
          }
        }

        const embs = yield* self.embedding.embed([rec.content])
        const emb = Array.from(embs[0]!.values)
        const relationships: { targetId: string; relationType: string }[] = []

        if (rec.relatedSymbols) {
          for (const sym of rec.relatedSymbols) {
            relationships.push({ targetId: `sym_${sym}`, relationType: "relates_to" })
          }
        }

        self.store.set(rec.id, {
          id: rec.id,
          category,
          kind: rec.kind,
          authority: rec.authority,
          content: rec.content,
          embedding: emb,
          timestamp: rec.timestamp,
          revision: rec.revision,
          scope: rec.scope,
          relationships,
          metadata: {
            ...rec.metadata,
            category,
            epistemicClass: rec.kind,
            authority: rec.authority,
          },
        })
      }
      self.statsRecord.itemCount = self.store.size
    }).pipe(Effect.mapError((e) => new Error(String(e))))
  }

  recall(query: MemoryQuery): Effect.Effect<readonly MemoryCandidate[], Error> {
    const self = this
    return Effect.gen(function* () {
      self.statsRecord.recallCount++
      const queryEmbs = yield* self.embedding.embed([`${query.prompt} ${query.goal}`])
      const queryEmb = Array.from(queryEmbs[0]!.values)
      const queryTokens = self.tokenize(`${query.prompt} ${query.goal}`)
      const activeSymbols = query.activeSymbols ?? []

      const scored: { doc: AgentMemoryInternalRecord; score: number }[] = []

      for (const doc of self.store.values()) {
        const sim = self.cosine(queryEmb, doc.embedding)
        const vecScore = Math.max(0, (sim + 1) / 2)

        const docTokens = self.tokenize(doc.content)
        const overlap = queryTokens.filter((t: string) => docTokens.includes(t)).length
        const lexScore = docTokens.length > 0 ? Math.min(1.0, overlap / Math.max(1, queryTokens.length * 0.4)) : 0

        let graphScore = 0
        if (activeSymbols.length > 0) {
          const matchedEdges = doc.relationships.filter((rel: { targetId: string }) =>
            activeSymbols.some((sym: string) => rel.targetId.includes(sym))
          ).length
          graphScore = Math.min(1.0, matchedEdges / Math.max(1, activeSymbols.length))
        }

        const composite = vecScore * 0.50 + lexScore * 0.30 + graphScore * 0.20

        scored.push({ doc, score: composite })
      }

      scored.sort((a, b) => b.score - a.score)
      const topK = scored.slice(0, query.limit ?? 5)

      return topK.map(({ doc, score }) => ({
        id: doc.id,
        content: doc.content,
        score,
        kind: doc.kind,
        authority: doc.authority,
        revision: doc.revision,
        scope: doc.scope,
        metadata: {
          ...doc.metadata,
          agentmemoryCategory: doc.category,
        },
      }))
    }).pipe(Effect.mapError((e) => new Error(String(e))))
  }

  reset(): Effect.Effect<void, Error> {
    return Effect.sync(() => {
      this.store.clear()
      this.statsRecord.itemCount = 0
    })
  }

  stats(): Effect.Effect<MemoryBackendStats, Error> {
    return Effect.sync(() => ({
      itemCount: this.store.size,
      storageBytes: Array.from(this.store.values()).reduce((acc, r) => acc + r.content.length, 0),
      writeTokens: this.statsRecord.writeTokens,
      extractionTokens: this.statsRecord.extractionTokens,
      consolidationTokens: this.statsRecord.consolidationTokens,
      recallCount: this.statsRecord.recallCount,
    }))
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 2)
  }

  private cosine(a: readonly number[], b: readonly number[]): number {
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!, y = b[i]!
      dot += x * y
      normA += x * x
      normB += y * y
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }
}

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

export type HindsightNetwork = "world" | "experience" | "observation" | "belief"

export interface HindsightInternalRecord {
  id: string
  network: HindsightNetwork
  kind: EpistemicKind
  authority: AuthorityClass
  content: string
  entities: string[]
  embedding: readonly number[]
  timestamp: number
  revision: any
  scope: any
  metadata: Record<string, unknown>
}

export interface HindsightBackendOptions {
  mode?: "controlled" | "native"
  enableReflect?: boolean
  embeddingProvider?: EmbeddingProvider
}

export class HindsightMemoryBackend implements AgentMemoryBackend {
  readonly name = "Hindsight"
  readonly mode: "controlled" | "native"
  readonly enableReflect: boolean
  private readonly embedding: EmbeddingProvider
  private readonly store: Map<string, HindsightInternalRecord> = new Map()

  private statsRecord = {
    itemCount: 0,
    writeTokens: 0,
    extractionTokens: 0,
    consolidationTokens: 0,
    recallCount: 0,
    reflectTokens: 0,
  }

  constructor(options: HindsightBackendOptions = {}) {
    this.mode = options.mode ?? "controlled"
    this.enableReflect = options.enableReflect ?? false
    this.embedding = options.embeddingProvider ?? new DeterministicHashEmbeddingProvider(128)
  }

  ingest(records: readonly MemoryIngressRecord[]): Effect.Effect<void, Error> {
    const self = this
    return Effect.gen(function* () {
      for (const rec of records) {
        let network: HindsightNetwork = "world"
        if (rec.kind === "hard_claim" || rec.kind === "evidence_reference" || rec.kind === "procedure") {
          network = "world"
        } else if (rec.kind === "episode" || rec.kind === "tool_outcome" || rec.kind === "verification_history") {
          network = "experience"
        } else if (rec.kind === "decision" || rec.kind === "observation") {
          network = "observation"
        } else {
          network = "belief"
        }

        if (self.mode === "native") {
          self.statsRecord.extractionTokens += Math.round(rec.content.length / 4) + 25
          self.statsRecord.writeTokens += Math.round(rec.content.length / 4)
        }

        const entities = self.extractEntities(rec.content, rec.relatedSymbols ?? [])
        const embs = yield* self.embedding.embed([rec.content])
        const emb = Array.from(embs[0]!.values)

        self.store.set(rec.id, {
          id: rec.id,
          network,
          kind: rec.kind,
          authority: rec.authority,
          content: rec.content,
          entities,
          embedding: emb,
          timestamp: rec.timestamp,
          revision: rec.revision,
          scope: rec.scope,
          metadata: {
            ...rec.metadata,
            network,
            entities,
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
      const now = Date.now()

      const scored: { doc: HindsightInternalRecord; score: number }[] = []

      for (const doc of self.store.values()) {
        const sim = self.cosine(queryEmb, doc.embedding)
        const vecScore = Math.max(0, (sim + 1) / 2)

        const docTokens = self.tokenize(doc.content)
        const overlap = queryTokens.filter((t: string) => docTokens.includes(t)).length
        const lexScore = docTokens.length > 0 ? Math.min(1.0, overlap / Math.max(1, queryTokens.length * 0.4)) : 0

        let entityScore = 0
        if (doc.entities.length > 0 && activeSymbols.length > 0) {
          const matchCount = doc.entities.filter((e: string) => activeSymbols.includes(e)).length
          entityScore = matchCount / Math.max(1, activeSymbols.length)
        }

        const ageHours = Math.max(0, (now - doc.timestamp) / (1000 * 3600))
        const temporalScore = Math.exp(-ageHours / 168)

        let networkBias = 1.0
        if (doc.network === "world") networkBias = 1.05
        else if (doc.network === "observation") networkBias = 1.0
        else if (doc.network === "experience") networkBias = 0.95
        else if (doc.network === "belief") networkBias = 0.85

        const composite = (vecScore * 0.45 + lexScore * 0.30 + entityScore * 0.15 + temporalScore * 0.10) * networkBias

        scored.push({ doc, score: composite })
      }

      scored.sort((a, b) => b.score - a.score)
      const topK = scored.slice(0, query.limit ?? 5)

      let candidates: MemoryCandidate[] = topK.map(({ doc, score }) => ({
        id: doc.id,
        content: doc.content,
        score,
        kind: doc.kind,
        authority: doc.authority,
        revision: doc.revision,
        scope: doc.scope,
        relatedSymbols: doc.entities,
        metadata: {
          ...doc.metadata,
          hindsightNetwork: doc.network,
          reflected: self.enableReflect,
        },
      }))

      if (self.enableReflect) {
        self.statsRecord.reflectTokens += 150 + candidates.length * 50
        const hasConflict = candidates.some((c) => c.authority === "rejected") && candidates.some((c) => c.authority === "authoritative")
        if (hasConflict) {
          candidates.unshift({
            id: `hindsight_reflect_${Date.now()}`,
            content: `[Hindsight CARA Reflection] Detected epistemic divergence across memory bank: verified claims supersede historical rejected attempts.`,
            score: 1.0,
            kind: "observation",
            authority: "non_authoritative",
            revision: query.revision,
            metadata: { syntheticReflection: true },
          })
        }
      }

      return candidates
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

  private extractEntities(content: string, symbols: readonly string[]): string[] {
    const list = [...symbols]
    const symbolRegex = /\b[A-Za-z_][A-Za-z0-9_]{3,}\b/g
    let match: RegExpExecArray | null
    while ((match = symbolRegex.exec(content)) !== null) {
      const s = match[0]
      if (s && !list.includes(s) && !["const", "function", "return", "import", "class"].includes(s)) {
        list.push(s)
      }
    }
    return list.slice(0, 15)
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

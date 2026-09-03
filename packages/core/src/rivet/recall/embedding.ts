import { Effect } from "effect"
import crypto from "crypto"

export interface EmbeddingVector {
  readonly values: Float32Array
  readonly dimension: number
  readonly model: string
}

export class EmbeddingError {
  readonly _tag = "EmbeddingError"
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export interface EmbeddingProvider {
  readonly id: string
  readonly model: string
  readonly dimension: number
  embed(texts: readonly string[]): Effect.Effect<readonly EmbeddingVector[], EmbeddingError>
}

export function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

export function computeSha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex")
}

/**
 * CachedEmbeddingProvider wraps an EmbeddingProvider with an in-memory / persistent cache
 * keyed by sha256(model + ":" + normalizedText) to eliminate redundant embedding calls.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly id: string
  readonly model: string
  readonly dimension: number
  private cache = new Map<string, EmbeddingVector>()

  constructor(private delegate: EmbeddingProvider) {
    this.id = `cached(${delegate.id})`
    this.model = delegate.model
    this.dimension = delegate.dimension
  }

  embed(texts: readonly string[]): Effect.Effect<readonly EmbeddingVector[], EmbeddingError> {
    const self = this
    return Effect.gen(function* () {
      if (texts.length === 0) return []

      const normalized = texts.map(normalizeText)
      const results: (EmbeddingVector | null)[] = new Array(texts.length).fill(null)
      const uncachedIndices: number[] = []
      const uncachedTexts: string[] = []

      for (let i = 0; i < normalized.length; i++) {
        const key = `${self.model}:${computeSha256(normalized[i]!)}`
        const hit = self.cache.get(key)
        if (hit) {
          results[i] = hit
        } else {
          uncachedIndices.push(i)
          uncachedTexts.push(normalized[i]!)
        }
      }

      if (uncachedTexts.length > 0) {
        const fetched = yield* self.delegate.embed(uncachedTexts)
        for (let j = 0; j < uncachedIndices.length; j++) {
          const originalIdx = uncachedIndices[j]!
          const vec = fetched[j]!
          const key = `${self.model}:${computeSha256(normalized[originalIdx]!)}`
          self.cache.set(key, vec)
          results[originalIdx] = vec
        }
      }

      return results as readonly EmbeddingVector[]
    })
  }

  getCacheSize(): number {
    return this.cache.size
  }

  clearCache(): void {
    this.cache.clear()
  }
}

/**
 * DeterministicHashEmbeddingProvider is a deterministic offline / fallback embedding generator.
 * Explicitly classified as a HEURISTIC/TEST DOUBLE provider for offline test suites and graceful degradation.
 */
export class DeterministicHashEmbeddingProvider implements EmbeddingProvider {
  readonly id = "deterministic-hash"
  readonly model = "hash-feature-v1"

  constructor(readonly dimension: number = 128) {}

  embed(texts: readonly string[]): Effect.Effect<readonly EmbeddingVector[], EmbeddingError> {
    const self = this
    return Effect.sync(() => {
      return texts.map((text) => {
        const vec = new Float32Array(self.dimension)
        const normalized = normalizeText(text)
        const tokens = normalized.split(/[^a-z0-9_\-./]/).filter((t) => t.length > 1)

        for (const token of tokens) {
          const h1 = Math.abs(hashString(token)) % self.dimension
          vec[h1] += 1.0

          if (token.length >= 3) {
            for (let i = 0; i <= token.length - 3; i++) {
              const tri = token.slice(i, i + 3)
              const h2 = Math.abs(hashString(tri)) % self.dimension
              vec[h2] += 0.5
            }
          }
        }

        // Unit normalize
        let norm = 0
        for (let i = 0; i < self.dimension; i++) norm += vec[i] * vec[i]
        norm = Math.sqrt(norm)
        if (norm > 0) {
          for (let i = 0; i < self.dimension; i++) vec[i] /= norm
        }

        return {
          values: vec,
          dimension: self.dimension,
          model: self.model,
        }
      })
    })
  }
}

/**
 * OpenAIEmbeddingProvider connects to OpenAI or any OpenAI-compatible embeddings endpoint (e.g. Ollama, FastEmbed, vLLM).
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id: string
  readonly model: string
  readonly dimension: number
  private apiKey: string
  private baseUrl: string

  constructor(options: {
    apiKey?: string
    baseUrl?: string
    model?: string
    dimension?: number
  }) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? ""
    this.baseUrl = (options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "")
    this.model = options.model ?? "text-embedding-3-small"
    this.dimension = options.dimension ?? 1536
    this.id = `openai-compatible(${this.model})`
  }

  embed(texts: readonly string[]): Effect.Effect<readonly EmbeddingVector[], EmbeddingError> {
    const self = this
    return Effect.gen(function* () {
      if (texts.length === 0) return []
      if (!self.apiKey && !self.baseUrl.includes("localhost") && !self.baseUrl.includes("127.0.0.1")) {
        return yield* Effect.fail(
          new EmbeddingError("OpenAIEmbeddingProvider requires an API key (OPENAI_API_KEY) or local endpoint."),
        )
      }

      try {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${self.baseUrl}/embeddings`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(self.apiKey ? { Authorization: `Bearer ${self.apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: self.model,
                input: texts,
              }),
            }),
          catch: (err) => new EmbeddingError(`HTTP request to ${self.baseUrl}/embeddings failed`, err),
        })

        if (!response.ok) {
          const body = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: (err) => new EmbeddingError("Unknown response body", err),
          })
          return yield* Effect.fail(
            new EmbeddingError(`Embedding API returned status ${response.status}: ${body}`),
          )
        }

        const data = (yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (err) => new EmbeddingError("Failed to parse embedding response JSON", err),
        })) as { data?: { embedding: number[] }[] }

        if (!data.data || !Array.isArray(data.data)) {
          return yield* Effect.fail(
            new EmbeddingError("Invalid response format from embedding API: missing 'data' array"),
          )
        }

        return data.data.map((item) => ({
          values: new Float32Array(item.embedding),
          dimension: item.embedding.length,
          model: self.model,
        }))
      } catch (err) {
        return yield* Effect.fail(new EmbeddingError("Unexpected embedding error", err))
      }
    })
  }
}

function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return hash >>> 0
}

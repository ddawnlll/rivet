import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import {
  DeterministicHashEmbeddingProvider,
  CachedEmbeddingProvider,
  OpenAIEmbeddingProvider,
  EmbeddingError,
  normalizeText,
  computeSha256,
} from "../../../src/rivet/recall/embedding"

describe("EmbeddingProvider & CachedEmbeddingProvider", () => {
  it("normalizes text and computes deterministic SHA-256 cache keys", () => {
    const raw = "  Auth  Token   Refresh  Race \n"
    const norm = normalizeText(raw)
    expect(norm).toBe("auth token refresh race")

    const hash1 = computeSha256(norm)
    const hash2 = computeSha256("auth token refresh race")
    expect(hash1).toBe(hash2)
    expect(hash1.length).toBe(64)
  })

  it("DeterministicHashEmbeddingProvider generates unit-normalized vectors", () => {
    const provider = new DeterministicHashEmbeddingProvider(128)
    const texts = ["auth race condition", "database connection pool"]

    const embeddings = Effect.runSync(provider.embed(texts))
    expect(embeddings.length).toBe(2)
    expect(embeddings[0]!.dimension).toBe(128)
    expect(embeddings[0]!.model).toBe("hash-feature-v1")

    // Verify unit length
    let normSq = 0
    for (const v of embeddings[0]!.values) normSq += v * v
    expect(Math.abs(Math.sqrt(normSq) - 1.0)).toBeLessThan(0.001)
  })

  it("CachedEmbeddingProvider caches embeddings and batches uncached calls", () => {
    let callCount = 0
    const mockProvider = {
      id: "mock",
      model: "mock-v1",
      dimension: 64,
      embed: (texts: readonly string[]) => {
        callCount++
        return Effect.succeed(
          texts.map((t) => ({
            values: new Float32Array(64).fill(0.1),
            dimension: 64,
            model: "mock-v1",
          })),
        )
      },
    }

    const cached = new CachedEmbeddingProvider(mockProvider)

    // Call 1: 2 items uncached
    const res1 = Effect.runSync(cached.embed(["text a", "text b"]))
    expect(res1.length).toBe(2)
    expect(callCount).toBe(1)
    expect(cached.getCacheSize()).toBe(2)

    // Call 2: 1 cached, 1 new
    const res2 = Effect.runSync(cached.embed(["text a", "text c"]))
    expect(res2.length).toBe(2)
    expect(callCount).toBe(2) // Only "text c" requested from delegate
    expect(cached.getCacheSize()).toBe(3)

    // Call 3: all cached
    const res3 = Effect.runSync(cached.embed(["text b", "text c", "text a"]))
    expect(res3.length).toBe(3)
    expect(callCount).toBe(2) // No delegate call made
  })

  it("OpenAIEmbeddingProvider returns structured EmbeddingError on missing credentials or offline endpoints", () => {
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
    })

    const result = Effect.runSync(Effect.exit(provider.embed(["test query"])))
    expect(result._tag).toBe("Failure")
  })
})

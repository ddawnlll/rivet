import { Effect } from "effect"
import {
  type MemoryId,
  type RecallCandidate,
  type RecallDocument,
  type RecallQuery,
  type RecallSource,
  type RecallStore,
  RecallError,
} from "./types"
import { type EmbeddingProvider } from "./embedding"
import { AssociativeRetrievalEngine, type RetrievalWeights } from "./engine"
import { NoesisRecallProjector } from "./projector"

/**
 * InMemoryRecallStore provides an in-memory implementation of the RecallStore contract.
 * Explicitly classified as a TEST DOUBLE / lightweight store.
 */
export class InMemoryRecallStore implements RecallStore {
  private documents = new Map<MemoryId, RecallDocument>()
  private docEmbeddings = new Map<string, Float32Array>()

  constructor(
    private embeddingProvider?: EmbeddingProvider,
    private weights?: RetrievalWeights,
  ) {}

  index = (docs: readonly RecallDocument[]): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.gen(function* () {
      for (const doc of docs) {
        self.documents.set(doc.id, doc)
      }

      if (self.embeddingProvider && docs.length > 0) {
        const textsToEmbed = docs.map((d) => `${d.text} ${d.summary ?? ""}`.trim())
        const res = yield* self.embeddingProvider.embed(textsToEmbed).pipe(
          Effect.orElseSucceed(() => [] as const),
        )
        if (res.length === docs.length) {
          for (let i = 0; i < docs.length; i++) {
            self.docEmbeddings.set(docs[i]!.id, res[i]!.values)
          }
        }
      }
    })
  }

  remove = (ids: readonly MemoryId[]): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.sync(() => {
      for (const id of ids) {
        self.documents.delete(id)
        self.docEmbeddings.delete(id)
      }
    })
  }

  recall = (query: RecallQuery): Effect.Effect<readonly RecallCandidate[], RecallError> => {
    const self = this
    return Effect.gen(function* () {
      const allDocs = Array.from(self.documents.values())

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

      return AssociativeRetrievalEngine.rank(allDocs, query, self.weights, {
        docEmbeddings: self.docEmbeddings,
        queryEmbedding: queryEmbedding ?? undefined,
      })
    })
  }

  rebuild = (source: RecallSource): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.gen(function* () {
      self.documents.clear()
      self.docEmbeddings.clear()
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
    return Effect.sync(() => self.documents.size)
  }

  clear(): void {
    this.documents.clear()
    this.docEmbeddings.clear()
  }
}

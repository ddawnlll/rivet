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
import { AssociativeRetrievalEngine, type RetrievalWeights } from "./engine"
import { NoesisRecallProjector } from "./projector"

/**
 * InMemoryRecallStore provides an in-memory implementation of the RecallStore contract.
 */
export class InMemoryRecallStore implements RecallStore {
  private documents = new Map<MemoryId, RecallDocument>()

  constructor(private weights?: RetrievalWeights) {}

  index = (docs: readonly RecallDocument[]): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.sync(() => {
      for (const doc of docs) {
        self.documents.set(doc.id, doc)
      }
    })
  }

  remove = (ids: readonly MemoryId[]): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.sync(() => {
      for (const id of ids) {
        self.documents.delete(id)
      }
    })
  }

  recall = (query: RecallQuery): Effect.Effect<readonly RecallCandidate[], RecallError> => {
    const self = this
    return Effect.sync(() => {
      const allDocs = Array.from(self.documents.values())
      return AssociativeRetrievalEngine.rank(allDocs, query, self.weights)
    })
  }

  rebuild = (source: RecallSource): Effect.Effect<void, RecallError> => {
    const self = this
    return Effect.gen(function* () {
      self.documents.clear()
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

  clear = (): void => {
    this.documents.clear()
  }

  getAll = (): readonly RecallDocument[] => {
    return Array.from(this.documents.values())
  }
}

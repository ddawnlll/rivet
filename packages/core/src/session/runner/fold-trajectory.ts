import { DateTime } from "effect"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import type { TrajectoryFold } from "../../rivet/types"

export function foldTrajectoryEntries<T extends { readonly seq: number; readonly message: SessionMessage.Message }>(
  entries: readonly T[],
  folds: readonly TrajectoryFold[],
): T[] {
  const ranges = folds.map((fold) => ({
    start: Date.parse(fold.startedAt),
    startSeq: fold.startMessageId ? entries.find((entry) => entry.message.id === fold.startMessageId)?.seq : undefined,
    end: Date.parse(fold.completedAt),
  }))
  return entries.filter((entry) => {
    if (entry.message.type === "user" || entry.message.type === "system" || entry.message.type === "compaction") {
      return true
    }
    const created = DateTime.toEpochMillis(entry.message.time.created)
    return !ranges.some((range) => {
      const afterStart = range.startSeq === undefined ? created >= range.start : entry.seq >= range.startSeq
      return afterStart && created <= range.end
    })
  })
}

import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { Message, Model } from "@opencode-ai/llm"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import { CognitiveView } from "../../src/rivet/noesis"
import { FlightRecorder } from "../../src/rivet/flight-recorder"
import { createFocusId, createTaskId, Revision, type TrajectoryFold } from "../../src/rivet/types"
import { foldTrajectoryEntries } from "../../src/session/runner/fold-trajectory"
import { toLLMMessages } from "../../src/session/runner/to-llm-message"

const assistantToolMessage = (id: string, created: number, secret: string) =>
  ({
    id,
    type: "assistant",
    agent: "build",
    model: { id: "test-model", providerID: "test-provider" },
    content: [
      {
        type: "tool",
        id: `${id}-tool`,
        name: "read",
        state: {
          status: "completed",
          input: { path: secret },
          content: [{ type: "text", text: secret }],
          structured: { secret },
        },
        time: { created: DateTime.makeUnsafe(created), completed: DateTime.makeUnsafe(created + 1) },
      },
    ],
    time: { created: DateTime.makeUnsafe(created), completed: DateTime.makeUnsafe(created + 1) },
  }) as unknown as SessionMessage.Message

describe("completed recovery trajectory folding", () => {
  test("serialized provider request excludes the recovery-opening turn by durable message anchor", () => {
    const openingSecret = "RECOVERY_OPENING_RAW_TOOL"
    const laterSecret = "RECOVERY_LATER_RAW_TOOL"
    const requiredContext = "UNRELATED_REQUIRED_TASK_CONTEXT"
    const foldSummary = "RESOLVED RECOVERY R17: verifier path restored"
    const opening = assistantToolMessage("assistant-recovery-open", 1_000, openingSecret)
    const later = assistantToolMessage("assistant-recovery-later", 2_500, laterSecret)
    const unrelated = {
      id: "assistant-after-recovery",
      type: "assistant",
      agent: "build",
      model: { id: "test-model", providerID: "test-provider" },
      content: [{ type: "text", id: "required-context", text: requiredContext }],
      time: { created: DateTime.makeUnsafe(4_500), completed: DateTime.makeUnsafe(4_501) },
    } as unknown as SessionMessage.Message
    const user = {
      id: "user-root",
      type: "user",
      text: "Keep the root task",
      files: [],
      time: { created: DateTime.makeUnsafe(500) },
    } as unknown as SessionMessage.Message
    const fold: TrajectoryFold = {
      focusId: createFocusId(),
      taskId: createTaskId(),
      kind: "recovery",
      summary: foldSummary,
      evidenceRefs: ["evidence-1"],
      startedAt: new Date(2_000).toISOString(),
      completedAt: new Date(4_000).toISOString(),
      startMessageId: opening.id,
    }
    const entries = [user, opening, later, unrelated].map((message, index) => ({ seq: index + 1, message }))
    const model = Model.make({ id: "test-model", provider: "test-provider", route: { type: "test" } as never })
    const view = new CognitiveView({
      hardRevision: Revision.ZERO,
      goalDescription: "Keep the root task",
      trajectoryFolds: [fold],
    })

    FlightRecorder.clear()
    for (const secret of [openingSecret, laterSecret]) {
      FlightRecorder.endSpan(
        FlightRecorder.startSpan("tool", "tool.execute", { sessionId: "fold-test", metadata: { secret } }),
      )
    }
    const serializedRequest = {
      system: [Message.system(view.formatPromptBlock())],
      messages: toLLMMessages(
        foldTrajectoryEntries(entries, [fold]).map((entry) => entry.message),
        model,
      ),
    }
    const serialized = JSON.stringify(serializedRequest)

    expect(serialized).not.toContain(openingSecret)
    expect(serialized).not.toContain(laterSecret)
    expect(serialized).toContain(foldSummary)
    expect(serialized).toContain(requiredContext)
    expect(serialized).toContain("Keep the root task")
    expect(JSON.stringify(FlightRecorder.getCompletedSpans("fold-test"))).toContain(openingSecret)
    expect(JSON.stringify(FlightRecorder.getCompletedSpans("fold-test"))).toContain(laterSecret)
  })
})

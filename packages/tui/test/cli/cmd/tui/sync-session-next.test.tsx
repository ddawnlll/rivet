/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { AssistantMessage, GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { mount, wait } from "./sync-fixture"

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

describe("tui sync session.next events", () => {
  test("reduces session.next prompt, assistant turn, streaming text, tools, and finish", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    const sessionID = "ses_v2_stream_test"
    const userMsgID = "msg_user_1"
    const assistantMsgID = "msg_assistant_1"

    try {
      // 1. Prompted
      emit(
        global({
          id: "evt_prompted_1",
          type: "session.next.prompted",
          properties: {
            sessionID,
            messageID: userMsgID,
            timestamp: 100,
            prompt: { text: "Hello Rivet" },
            delivery: "steer",
          },
        }),
      )

      await wait(() => sync.data.message[sessionID]?.length === 1)
      const userMsg = sync.data.message[sessionID][0]
      expect(userMsg.role).toBe("user")
      expect(userMsg.id).toBe(userMsgID)
      expect(sync.data.part[userMsgID]?.[0]).toMatchObject({
        type: "text",
        text: "Hello Rivet",
      })
      expect(sync.data.session_status[sessionID]).toEqual({ type: "busy" })
      expect(sync.session.status(sessionID)).toBe("working")

      // 2. Step Started
      emit(
        global({
          id: "evt_step_start_1",
          type: "session.next.step.started",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            agent: "build",
            model: { id: "claude-3-5-sonnet", providerID: "anthropic" },
            timestamp: 200,
          },
        }),
      )

      await wait(() => sync.data.message[sessionID]?.length === 2)
      const assistantMsg = sync.data.message[sessionID].find((m): m is AssistantMessage => m.id === assistantMsgID)
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg?.role).toBe("assistant")
      expect(assistantMsg?.time.completed).toBeUndefined()
      expect(sync.session.status(sessionID)).toBe("working")

      // 3. Reasoning Started & Delta & Ended
      emit(
        global({
          id: "evt_reason_start",
          type: "session.next.reasoning.started",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            reasoningID: "rsn_1",
            timestamp: 210,
          },
        }),
      )
      emit(
        global({
          id: "evt_reason_delta_1",
          type: "session.next.reasoning.delta",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            reasoningID: "rsn_1",
            delta: "Thinking deeply...",
            timestamp: 215,
          },
        }),
      )
      emit(
        global({
          id: "evt_reason_end",
          type: "session.next.reasoning.ended",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            reasoningID: "rsn_1",
            text: "Thinking deeply... concluded.",
            timestamp: 250,
          },
        }),
      )

      await wait(() => sync.data.part[assistantMsgID]?.some((p) => p.type === "reasoning") ?? false)
      const reasonPart = sync.data.part[assistantMsgID].find((p) => p.type === "reasoning")
      expect(reasonPart).toMatchObject({
        type: "reasoning",
        text: "Thinking deeply... concluded.",
      })

      // 4. Text Started & Delta & Ended
      emit(
        global({
          id: "evt_text_start",
          type: "session.next.text.started",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            textID: "txt_1",
            timestamp: 260,
          },
        }),
      )
      emit(
        global({
          id: "evt_text_delta_1",
          type: "session.next.text.delta",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            textID: "txt_1",
            delta: "Hello, ",
            timestamp: 265,
          },
        }),
      )
      emit(
        global({
          id: "evt_text_delta_2",
          type: "session.next.text.delta",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            textID: "txt_1",
            delta: "I am Rivet!",
            timestamp: 270,
          },
        }),
      )

      await wait(
        () =>
          sync.data.part[assistantMsgID]?.some((p) => p.type === "text" && p.text.includes("I am Rivet!")) ?? false,
      )

      emit(
        global({
          id: "evt_text_end",
          type: "session.next.text.ended",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            textID: "txt_1",
            text: "Hello, I am Rivet!",
            timestamp: 300,
          },
        }),
      )

      // 5. Tool Input & Call & Success
      emit(
        global({
          id: "evt_tool_input_start",
          type: "session.next.tool.input.started",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            callID: "call_read_1",
            name: "read_file",
            timestamp: 310,
          },
        }),
      )
      emit(
        global({
          id: "evt_tool_called",
          type: "session.next.tool.called",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            callID: "call_read_1",
            tool: "read_file",
            input: { path: "test.txt" },
            provider: { executed: false },
            timestamp: 320,
          },
        }),
      )
      emit(
        global({
          id: "evt_tool_success",
          type: "session.next.tool.success",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            callID: "call_read_1",
            structured: {},
            content: [{ type: "text", text: "file content here" }],
            provider: { executed: true },
            timestamp: 350,
          },
        }),
      )

      await wait(
        () =>
          sync.data.part[assistantMsgID]?.some(
            (p) => p.type === "tool" && p.state.status === "completed" && p.state.output === "file content here",
          ) ?? false,
      )

      // 6. Step Ended
      emit(
        global({
          id: "evt_step_end_1",
          type: "session.next.step.ended",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            finish: "stop",
            cost: 0.005,
            tokens: {
              input: 100,
              output: 50,
              reasoning: 20,
              cache: { read: 10, write: 5 },
            },
            timestamp: 400,
          },
        }),
      )

      await wait(() => {
        const msg = sync.data.message[sessionID]?.find((m): m is AssistantMessage => m.id === assistantMsgID)
        return msg?.time.completed !== undefined
      })

      const completedAssistant = sync.data.message[sessionID].find((m): m is AssistantMessage => m.id === assistantMsgID)
      expect(completedAssistant?.time.completed).toBe(400)
      expect(completedAssistant?.finish).toBe("stop")
      expect(completedAssistant?.cost).toBe(0.005)
      expect(completedAssistant?.tokens.output).toBe(50)

      expect(sync.data.session_status[sessionID]).toEqual({ type: "idle" })
      expect(sync.session.status(sessionID)).toBe("idle")
    } finally {
      app.renderer.destroy()
    }
  })

  test("handles step failure correctly", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    const sessionID = "ses_v2_fail_test"
    const assistantMsgID = "msg_assistant_fail"

    try {
      emit(
        global({
          id: "evt_step_start_fail",
          type: "session.next.step.started",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            agent: "build",
            model: { id: "gpt-4o", providerID: "openai" },
            timestamp: 100,
          },
        }),
      )

      await wait(() => sync.data.message[sessionID]?.length === 1)

      emit(
        global({
          id: "evt_step_failed",
          type: "session.next.step.failed",
          properties: {
            sessionID,
            assistantMessageID: assistantMsgID,
            error: { type: "unknown", message: "Provider rate limited" },
            timestamp: 200,
          },
        }),
      )

      await wait(() => {
        const msg = sync.data.message[sessionID]?.find((m): m is AssistantMessage => m.id === assistantMsgID)
        return msg?.finish === "error"
      })

      const failedMsg = sync.data.message[sessionID].find((m): m is AssistantMessage => m.id === assistantMsgID)
      expect(failedMsg?.time.completed).toBe(200)
      expect(failedMsg?.finish).toBe("error")
      expect(failedMsg?.error?.data?.message).toContain("Provider rate limited")
      expect(sync.data.session_status[sessionID]).toEqual({ type: "idle" })
    } finally {
      app.renderer.destroy()
    }
  })
})

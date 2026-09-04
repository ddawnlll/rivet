import type { Event } from "@opencode-ai/sdk/v2"
import { useSDK } from "./sdk"

type EventMetadata = {
  directory: string
  workspace: string | undefined
}

function adaptEvent(payload: Event): Event {
  const p = payload as Record<string, unknown>
  if (p.type === "question.v2.asked") {
    return {
      ...payload,
      type: "question.asked",
    } as Event
  }
  if (p.type === "question.v2.replied") {
    return {
      ...payload,
      type: "question.replied",
    } as Event
  }
  if (p.type === "question.v2.rejected") {
    return {
      ...payload,
      type: "question.rejected",
    } as Event
  }
  if (p.type === "permission.v2.asked") {
    const data = (p.properties ?? {}) as Record<string, unknown>
    const source = data.source as Record<string, unknown> | undefined
    return {
      id: payload.id,
      type: "permission.asked",
      properties: {
        id: data.id,
        sessionID: data.sessionID,
        permission: data.action ?? data.permission,
        patterns: data.resources ?? data.patterns ?? [],
        always: data.save ?? data.always ?? [],
        metadata: data.metadata ?? {},
        tool:
          source?.type === "tool"
            ? { messageID: source.messageID, callID: source.callID }
            : data.tool,
      },
    } as unknown as Event
  }
  if (p.type === "permission.v2.replied") {
    return {
      ...payload,
      type: "permission.replied",
    } as Event
  }
  return payload
}

export function useEvent() {
  const sdk = useSDK()

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") {
        return
      }

      handler(adaptEvent(event.payload), { directory: event.directory, workspace: event.workspace })
    })
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return subscribe((event: Event, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}

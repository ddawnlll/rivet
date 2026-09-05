import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceRef } from "@/effect/instance-ref"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import type { Payload } from "@opencode-ai/core/event"

export const Info = SessionStatusEvent.Info
export type Info = SessionStatusEvent.Info

export const Event = SessionStatusEvent

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const statusMap = new Map<SessionID, { info: Info; directory?: string }>()

    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== Event.Status.type) return Effect.void
      const statusEvent = event as Payload<typeof Event.Status>
      return Effect.sync(() => {
        if (statusEvent.data.status.type === "idle") {
          statusMap.delete(statusEvent.data.sessionID)
        } else {
          statusMap.set(statusEvent.data.sessionID, {
            info: statusEvent.data.status,
            directory: statusEvent.location?.directory,
          })
        }
      })
    })
    yield* Effect.addFinalizer(() => unsubscribe)

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      return statusMap.get(sessionID)?.info ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      const ctx = yield* InstanceRef
      const result = new Map<SessionID, Info>()
      for (const [id, entry] of statusMap) {
        if (!ctx || !entry.directory || entry.directory === ctx.directory) {
          result.set(id, entry.info)
        }
      }
      return result
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const ctx = yield* InstanceRef
      yield* events.publish(Event.Status, { sessionID, status })
      if (status.type === "idle") {
        yield* events.publish(Event.Idle, { sessionID })
        statusMap.delete(sessionID)
        return
      }
      statusMap.set(sessionID, { info: status, directory: ctx?.directory })
    })

    return Service.of({ get, list, set })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node] })

export * as SessionStatus from "./status"

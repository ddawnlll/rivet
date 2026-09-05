import { Cause, Effect, Layer } from "effect"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { EventV2 } from "../../event"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const events = yield* EventV2.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        yield* events.publish(
          SessionStatusEvent.Status,
          { sessionID, status: { type: "busy" } },
          { location: session.location },
        )
        return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),
    })

    const interrupt = Effect.fn("SessionExecution.interrupt")(function* (
      sessionID: SessionSchema.ID,
      source: "user_abort" | "host_runtime_cancellation" | "session_shutdown" = "user_abort",
    ) {
      yield* coordinator.interrupt(sessionID)
      const current = yield* store.get(sessionID)
      if (!current) return
      yield* events.publish(
        SessionStatusEvent.Status,
        {
          sessionID,
          status: {
            type: "idle",
            outcome: "interrupted",
            source,
            reason: source === "user_abort" ? "User requested interruption" : "Execution owner interrupted",
            phase: "session_runner",
          },
        },
        { location: current.location },
      )
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, EventV2.node],
})

export * as SessionExecutionLocal from "./local"

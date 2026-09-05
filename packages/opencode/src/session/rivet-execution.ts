import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { Cause, Effect, Exit, Layer } from "effect"
import { SessionPrompt } from "./prompt"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { InstanceStore } from "@/project/instance-store"

/**
 * The single Rivet-owned execution path. It reuses the inherited OpenCode
 * SessionRunState owner and SessionPrompt transport loop; only durable V2
 * admission and projection feed that loop. The Core SessionRunner remains
 * available for compatibility tests but is not called here.
 */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const store = yield* SessionStore.Service
    const instances = yield* InstanceStore.Service
    const status = yield* SessionStatus.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, never>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
        const session = yield* store.get(sessionID).pipe(Effect.orDie)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        return yield* instances.provide(
          { directory: session.location.directory },
          Effect.gen(function* () {
            const v1ID = SessionID.make(sessionID)
            yield* status.set(v1ID, { type: "busy" })
            yield* prompt.runTransport({ sessionID: v1ID }).pipe(
              Effect.onExit((exit) => {
                if (Exit.isSuccess(exit)) {
                  return status.set(v1ID, {
                    type: "idle",
                    outcome: "completed",
                    reason: "Transport drain completed",
                    phase: "transport",
                  })
                }

                const interrupted = Cause.hasInterrupts(exit.cause)
                return status
                  .set(v1ID, {
                    type: "idle",
                    outcome: interrupted ? "interrupted" : "failed",
                    source: interrupted ? "host_runtime_cancellation" : "provider_failure",
                    reason: "Transport drain failed",
                    phase: "transport",
                  })
                  .pipe(Effect.andThen(Effect.logError("Rivet transport drain failed", Cause.squash(exit.cause))))
              }),
            )
          }),
        )
      }),
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionPrompt.node, SessionStore.node, InstanceStore.node, SessionStatus.node],
})

export * as RivetSessionExecution from "./rivet-execution"

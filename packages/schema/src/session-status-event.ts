export * as SessionStatusEvent from "./session-status-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"
import { NonNegativeInt } from "./schema"
import { SessionID } from "./session-id"

export const Activity = Schema.Struct({
  operation: Schema.String,
  label: Schema.String,
  spanId: Schema.String,
  startedAt: NonNegativeInt,
})
export type Activity = Schema.Schema.Type<typeof Activity>

export const CompletedActivity = Schema.Struct({
  operation: Schema.String,
  label: Schema.String,
  spanId: Schema.String,
  durationMs: NonNegativeInt,
})
export type CompletedActivity = Schema.Schema.Type<typeof CompletedActivity>

export const TerminalOutcome = Schema.Literals(["completed", "quiescent", "stalled", "interrupted", "failed"])
export type TerminalOutcome = Schema.Schema.Type<typeof TerminalOutcome>

const liveFields = {
  activity: optional(Activity),
  lastCompleted: optional(CompletedActivity),
  recentCompleted: optional(Schema.Array(CompletedActivity)),
}

export const Info = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("idle"),
    outcome: optional(TerminalOutcome),
    source: optional(Schema.String),
    reason: optional(Schema.String),
    phase: optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: NonNegativeInt,
    message: Schema.String,
    action: optional(
      Schema.Struct({
        reason: Schema.String,
        provider: Schema.String,
        title: Schema.String,
        message: Schema.String,
        label: Schema.String,
        link: optional(Schema.String),
      }),
    ),
    next: NonNegativeInt,
    ...liveFields,
  }),
  Schema.Struct({
    type: Schema.Literal("busy"),
    ...liveFields,
  }),
]).annotate({ identifier: "SessionStatus" })
export type Info = Schema.Schema.Type<typeof Info>

export const Status = Event.define({
  type: "session.status",
  schema: {
    sessionID: SessionID,
    status: Info,
  },
})

// deprecated
export const Idle = Event.define({
  type: "session.idle",
  schema: {
    sessionID: SessionID,
  },
})

export const Definitions = Event.inventory(Status, Idle)

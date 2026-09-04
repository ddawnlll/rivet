export * as RivetInductionEvent from "./rivet-induction-event"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { NonNegativeInt } from "./schema"

const InductionPhase = Schema.Literals(["census", "structure", "deepread", "claims"])
export type InductionPhase = typeof InductionPhase.Type

export const Progress = define({
  type: "rivet.induction.progress",
  schema: {
    directory: Schema.String,
    phase: InductionPhase,
    phaseIndex: NonNegativeInt,
    totalPhases: NonNegativeInt,
    processed: NonNegativeInt,
    total: NonNegativeInt,
    detail: Schema.String,
  },
})

export const Completed = define({
  type: "rivet.induction.completed",
  schema: {
    directory: Schema.String,
    status: Schema.Literals(["complete", "partial"]),
    claimCount: NonNegativeInt,
    filesRead: NonNegativeInt,
    packageCount: NonNegativeInt,
    durationMs: NonNegativeInt,
    summary: Schema.String,
  },
})

export const Failed = define({
  type: "rivet.induction.failed",
  schema: {
    directory: Schema.String,
    message: Schema.String,
  },
})

export const Definitions = inventory(Progress, Completed, Failed)

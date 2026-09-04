export * as SystemContextBuiltIns from "./builtins"

import { makeLocationNode } from "../effect/app-node"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { SystemContext } from "./index"
import { InstructionContext } from "../instruction-context"
import { SystemContextRegistry } from "./registry"
import { FSUtil } from "../fs-util"
import { Global } from "../global"

const builtIns = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    const environment = [
      "<env>",
      `  Working directory: ${location.directory}`,
      `  Workspace root folder: ${location.project.directory}`,
      `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      "</env>",
    ].join("\n")
    const context = SystemContext.combine([
      SystemContext.make({
        key: SystemContext.Key.make("core/environment"),
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(environment),
        baseline: (environment) =>
          ["Here is some useful information about the environment you are running in:", environment].join("\n"),
        update: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        load: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
        baseline: (date) => `Today's date: ${date}`,
        update: (_previous, date) => `Today's date is now: ${date}`,
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/rivet-epistemic-charter"),
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(
          [
            "<rivet_harness_constitution>",
            "  Role: You are Rivet's active Cognitive Controller. Propose actions, form hypotheses, and interpret views.",
            "  Authority: Rivet Harness owns authoritative reality (execution, observation, evidence admission, verification, persistence, completion).",
            "  Epistemic Layers: Hard State is authoritative epistemic state; Soft Workspace is provisional; Context is task-scoped projection.",
            "  Internal State vs Filesystem: Hard State, obligations, claims, and associative memory are internal runtime data structures, NOT filesystem files. Query them via query_epistemic_state and retrieve_memory, NEVER via glob or grep.",
            "  Praxis: Verifies bounded predicates for a specific scope and revision.",
            "  Language Match: Reply 100% in the user's language (Türkçe ise Türkçe konuş).",
            "  Completion: A goal is complete ONLY when applicable obligations are closed and required predicates are satisfied by the Harness.",
            "</rivet_harness_constitution>",
          ].join("\n"),
        ),
        baseline: (charter) => charter,
        update: (_previous, charter) => charter,
      }),
    ])

    yield* registry.register({ key: SystemContext.Key.make("core/builtins"), load: Effect.succeed(context) })
  }),
)

export const node = makeLocationNode({
  name: "system-context-builtins",
  layer: builtIns,
  deps: [Location.node, SystemContextRegistry.node, InstructionContext.node, FSUtil.node, Global.node],
})

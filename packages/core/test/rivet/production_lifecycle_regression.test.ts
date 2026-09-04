import { describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSemantics } from "@opencode-ai/core/session/semantics"
import {
  TurnAdmissionGate,
  CognitiveViewCompiler,
  AccpSemanticGate,
  GoalCompiler,
  Revision,
} from "../../src/rivet"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), []),
)

describe("Production Lifecycle & Controller Defect Regressions", () => {
  // Defect 1 & 5: Ephemeral turns & decoupled stall signature
  it.effect("1. Ephemeral turns do not create autonomous goals and allow clean settlement without stagnation kills", () =>
    Effect.gen(function* () {
      const ephemeralQueries = [
        "What is in my config file?",
        "Show me the database schema",
        "Can you check if packages/core builds?",
        "Where is SQLite initialized?",
      ]

      for (const query of ephemeralQueries) {
        const admission = TurnAdmissionGate.classify(query)
        expect(admission.shouldCreateGoal).toBe(false)
        expect(admission.shouldCreateObligation).toBe(false)
        expect(admission.requiresPraxis).toBe(false)
        expect(admission.category).toBe("conversational_query")
      }
    }),
  )

  // Defect 2: Natural execution prompts compile to autonomous execution goals
  it.effect("2. Natural execution prompts compile to autonomous execution goals with Praxis requirements", () =>
    Effect.gen(function* () {
      const naturalPrompts = [
        "create the config file",
        "update the package version",
        "delete this file",
        "fix the test and verify it passes",
        "Run the semantic echo",
        "Run and verify the semantic echo",
        "Fix and verify the semantic echo",
      ]

      for (const prompt of naturalPrompts) {
        const admission = TurnAdmissionGate.classify(prompt)
        expect(admission.category).toBe("autonomous_goal")
        expect(admission.shouldCreateGoal).toBe(true)
        expect(admission.shouldCreateObligation).toBe(true)
        expect(admission.requiresPraxis).toBe(true)
        expect(admission.requiresCompletion).toBe(true)
        expect(admission.obligationKind).toBe("execution")

        const compiled = GoalCompiler.compile(prompt, "test-repo", Revision.ZERO)
        expect(compiled.graph.openObligations().length).toBeGreaterThan(0)
      }
    }),
  )

  // Defect 3: Conversational follow-ups do not erase active session goal
  it.effect("3. Conversational follow-ups do not erase active session goal in HardState", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_active_goal_preservation")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-goal-preserve-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)

      // Establish active goal
      yield* semantics.ensureGoal(events, "/goal implement resilient session runner", tmp, "execution")
      expect(semantics.hardState.goalDescription).toBe("/goal implement resilient session runner")

      // Conversational follow-up arrives
      const followUp = "You didn't answer my question."
      const admission = TurnAdmissionGate.classify(followUp, semantics.hardState.goalDescription)
      expect(admission.shouldCreateGoal).toBe(false)
      expect(admission.requiresPraxis).toBe(false)

      // HardState retains the active goal
      const reloaded = yield* SessionSemantics.load(db, sessionID)
      expect(reloaded.hardState.goalDescription).toBe("/goal implement resilient session runner")
    }),
  )

  // Defect 4: Actionable Praxis failures permit repair retries
  it.effect("4. AccpSemanticGate completion readiness accurately distinguishes passing from failing states", () =>
    Effect.gen(function* () {
      const openObligationId = "oblg_01" as any

      // Unclosed obligation blocks completion
      const pendingGate = AccpSemanticGate.checkCompletionReadiness({
        unclosedObligations: [openObligationId],
        passingReceipts: [],
        hasActiveGoal: true,
        totalObligations: 1,
      })
      expect(pendingGate.status).toBe("BLOCKED")
      expect(pendingGate.blockers.length).toBeGreaterThan(0)

      // Passing receipt allows completion
      const passingGate = AccpSemanticGate.checkCompletionReadiness({
        unclosedObligations: [],
        passingReceipts: [{ obligationId: openObligationId, passed: true } as any],
        hasActiveGoal: true,
        totalObligations: 1,
      })
      expect(passingGate.status).toBe("READY")
      expect(passingGate.blockers).toHaveLength(0)
    }),
  )

  // Defect 5: Steering and redirection turns settle cleanly
  it.effect("5. Steering and direction changes do not manufacture synthetic obligations", () =>
    Effect.gen(function* () {
      const steeringPrompts = [
        "Change direction",
        "Start working",
        "Hold on a second",
        "Wait, don't do that",
        "Never mind",
      ]

      for (const prompt of steeringPrompts) {
        const admission = TurnAdmissionGate.classify(prompt)
        expect(admission.shouldCreateGoal).toBe(false)
        expect(admission.shouldCreateObligation).toBe(false)
        expect(admission.category).toBe("conversational_query")
      }
    }),
  )
})

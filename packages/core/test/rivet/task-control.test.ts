import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSemantics } from "@opencode-ai/core/session/semantics"
import { HardState, type NoesisEvent } from "@opencode-ai/core/rivet/noesis"
import { admittedInterventions, diagnoseFailure, evidenceIsSufficient } from "@opencode-ai/core/rivet/task-control"
import {
  Revision,
  Scope,
  createEvidenceId,
  createObligationId,
  createReceiptId,
  createTaskId,
  type RecoveryVerificationReceipt,
} from "@opencode-ai/core/rivet/types"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), []))

describe("Rivet task control plane P0", () => {
  it.effect("goal replacement suspends prior task obligations and installs a durable focus contract", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_task_control_replacement")
      const semantics = yield* SessionSemantics.load(db, sessionID)

      yield* semantics.ensureGoal(events, "/goal implement first task", "/tmp/rivet-control", "execution")
      const firstTask = semantics.hardState.activeTaskId!
      const firstObligations = semantics.hardState.openObligationIds()
      const firstFocus = semantics.hardState.executionFocus

      expect(firstFocus?.taskId).toBe(firstTask)
      expect(firstFocus?.targetObligationId).toBe(firstObligations[0])
      expect(firstFocus?.contract.acceptanceCriteria.length).toBeGreaterThan(0)
      expect(firstFocus?.contract.allowedScope.length).toBeGreaterThan(0)
      expect(firstFocus?.contract.requiredEvidence.length).toBeGreaterThan(0)

      yield* semantics.ensureGoal(events, "/goal implement replacement task", "/tmp/rivet-control", "execution")
      const secondTask = semantics.hardState.activeTaskId!

      expect(secondTask).not.toBe(firstTask)
      expect(semantics.hardState.archivedTasks.has(firstTask)).toBe(true)
      expect(firstObligations.every((id) => semantics.hardState.suspendedObligations.has(id))).toBe(true)
      expect(
        semantics.hardState
          .openObligationIds()
          .every((id) => semantics.hardState.obligationTaskIds.get(id) === secondTask),
      ).toBe(true)
      expect(semantics.hardState.executionFocus?.taskId).toBe(secondTask)

      const replayed = yield* SessionSemantics.load(db, sessionID)
      expect(replayed.hardState.activeTaskId).toBe(semantics.hardState.activeTaskId)
      expect(replayed.hardState.executionFocus?.id).toBe(semantics.hardState.executionFocus?.id)
      expect(replayed.hardState.archivedTasks.has(firstTask)).toBe(true)
    }),
  )

  it.effect("every autonomous invocation records the authoritative focus id", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_task_control_invocation")
      const semantics = yield* SessionSemantics.load(db, sessionID)

      yield* semantics.ensureGoal(events, "/goal implement focused work", "/tmp/rivet-control", "execution")
      yield* semantics.recordInvocation(events, "inv_task_control" as never, "test-model")

      expect(semantics.hardState.modelInvocations.at(-1)?.focusId).toBe(semantics.hardState.executionFocus?.id)
    }),
  )

  it.effect("nested recovery unwinds durably in strict LIFO order", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_task_control_nested_recovery")
      const semantics = yield* SessionSemantics.load(db, sessionID)
      yield* semantics.ensureGoal(events, "/goal preserve nested recovery", "/tmp/rivet-control", "execution")
      const obligationFocus = semantics.hardState.executionFocus!
      const first = yield* semantics.pushRecovery(events, {
        failureClass: "verification_gap",
        objective: "Restore parent verification",
        acceptanceCriteria: ["Parent verifier path works"],
      })
      const firstFocus = semantics.hardState.executionFocus!
      expect(firstFocus.parentFocusId).toBe(obligationFocus.id)

      const second = yield* semantics.pushRecovery(events, {
        failureClass: "environment_blocker",
        objective: "Restore recovery environment",
        acceptanceCriteria: ["Recovery environment works"],
      })
      const secondFocus = semantics.hardState.executionFocus!
      expect(semantics.hardState.recoveryStack).toEqual([first.id, second.id])
      expect(secondFocus.parentFocusId).toBe(firstFocus.id)

      const replayed = yield* SessionSemantics.load(db, sessionID)
      expect(replayed.hardState.recoveryStack).toEqual([first.id, second.id])
      expect(replayed.hardState.executionFocus?.id).toBe(secondFocus.id)

      const evidenceId = createEvidenceId()
      yield* replayed.append(events, {
        type: "evidence_recorded",
        evidenceId,
        source: "praxis.recovery",
        summary: "Nested recovery acceptance evidence",
        timestamp: new Date().toISOString(),
      })
      const secondReceipt: RecoveryVerificationReceipt = {
        receiptId: createReceiptId(),
        recoveryId: second.id,
        passed: true,
        evidenceRefs: [evidenceId],
        verifier: "PRAXIS",
        timestamp: new Date().toISOString(),
      }
      yield* replayed.recordRecoveryVerification(events, secondReceipt)
      yield* replayed.popRecovery(events, second.id, secondReceipt)
      expect(replayed.hardState.executionFocus?.id).toBe(firstFocus.id)
      expect(replayed.hardState.recoveryStack).toEqual([first.id])

      const firstReceipt: RecoveryVerificationReceipt = {
        ...secondReceipt,
        receiptId: createReceiptId(),
        recoveryId: first.id,
      }
      yield* replayed.recordRecoveryVerification(events, firstReceipt)
      yield* replayed.popRecovery(events, first.id, firstReceipt)
      expect(replayed.hardState.executionFocus?.id).toBe(obligationFocus.id)
      expect(replayed.hardState.recoveryStack).toEqual([])
    }),
  )
})

describe("Rivet task control plane P1", () => {
  it.effect("dependency-aware ready frontier admits only obligations whose dependencies are verified", () =>
    Effect.sync(() => {
      const taskId = createTaskId()
      const first = createObligationId()
      const second = createObligationId()
      const events: NoesisEvent[] = [
        {
          type: "goal_set",
          goal: "dependency test",
          goalId: taskId,
          timestamp: new Date().toISOString(),
        },
        {
          type: "obligation_created",
          obligationId: first,
          taskId,
          description: "first",
          scope: Scope.global("repo", Revision.ZERO),
          dependencies: [],
          timestamp: new Date().toISOString(),
        },
        {
          type: "obligation_created",
          obligationId: second,
          taskId,
          description: "second",
          scope: Scope.global("repo", Revision.ZERO),
          dependencies: [first],
          timestamp: new Date().toISOString(),
        },
      ]
      const state = HardState.replay(events)
      expect(state.readyObligationIds()).toEqual([first])

      state.apply({
        type: "obligation_closed",
        obligationId: first,
        receiptId: createReceiptId(),
        timestamp: new Date().toISOString(),
      })
      expect(state.readyObligationIds()).toEqual([second])
    }),
  )

  it.effect("failure diagnosis selects bounded interventions instead of generic recovery", () =>
    Effect.sync(() => {
      expect(diagnoseFailure(["FILE_NOT_FOUND"], "cwd mismatch")).toBe("environment_blocker")
      expect(diagnoseFailure(["CLAIM_NOT_ADMITTED"], "missing evidence")).toBe("verification_gap")
      expect(admittedInterventions("verification_gap")).toEqual(["collect_required_evidence", "run_declared_verifier"])
    }),
  )

  it.effect("Praxis-backed recovery closes mechanically and restores the unresolved parent focus", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const semantics = yield* SessionSemantics.load(db, SessionV2.ID.make("ses_task_control_recovery"))
      yield* semantics.ensureGoal(events, "/goal repair verification", "/tmp/rivet-control", "execution")
      const parent = semantics.hardState.executionFocus!
      const frame = yield* semantics.pushRecovery(events, {
        failureClass: "verification_gap",
        objective: "Restore the declared verification path",
        acceptanceCriteria: ["Praxis can observe the required evidence"],
      })
      const evidenceId = createEvidenceId()
      yield* semantics.append(events, {
        type: "evidence_recorded",
        evidenceId,
        source: "praxis.recovery",
        summary: "Verification path restored",
        timestamp: new Date().toISOString(),
      })
      const receipt = {
        receiptId: createReceiptId(),
        recoveryId: frame.id,
        passed: true,
        evidenceRefs: [evidenceId],
        verifier: "PRAXIS" as const,
        timestamp: new Date().toISOString(),
      }
      yield* semantics.recordRecoveryVerification(events, receipt)
      yield* semantics.popRecovery(events, frame.id, receipt)

      expect(semantics.hardState.recoveryFrames.get(frame.id)?.status).toBe("closed")
      expect(semantics.hardState.executionFocus?.id).toBe(parent.id)
      expect(semantics.hardState.obligations.has(parent.targetObligationId!)).toBe(true)
      expect(semantics.hardState.trajectoryFolds.at(-1)?.summary).toContain("RESOLVED RECOVERY")
    }),
  )

  it.effect("effort and stagnation supervision preserve root and focus identity", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const semantics = yield* SessionSemantics.load(db, SessionV2.ID.make("ses_task_control_redirect"))
      yield* semantics.ensureGoal(events, "/goal maintain focus", "/tmp/rivet-control", "execution")
      const taskId = semantics.hardState.activeTaskId
      const focus = semantics.hardState.executionFocus!

      expect(evidenceIsSufficient(focus, [])).toEqual({ sufficient: false, observed: 0, required: 1 })
      yield* semantics.strategyRedirect(events, "No verifier-backed delta")

      expect(semantics.hardState.activeTaskId).toBe(taskId)
      expect(semantics.hardState.executionFocus?.id).toBe(focus.id)
      expect(semantics.hardState.strategyRedirects.at(-1)?.reason).toBe("No verifier-backed delta")
    }),
  )
})

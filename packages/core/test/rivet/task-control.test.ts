import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSemantics } from "@opencode-ai/core/session/semantics"
import { Revision, Scope, createEvidenceId, createReceiptId } from "@opencode-ai/core/rivet/types"
import type { VerificationReceipt } from "@opencode-ai/core/rivet/accp"
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
      const obligationId = obligationFocus.targetObligationId!

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

      const receipt: VerificationReceipt = {
        receiptId: createReceiptId(),
        obligationId,
        passed: true,
        evidenceId: createEvidenceId(),
        verifiedScope: Scope.global("/tmp/rivet-control", Revision.ZERO),
        timestamp: new Date().toISOString(),
      }
      yield* replayed.append(events, {
        type: "verification_recorded",
        receipt,
        timestamp: receipt.timestamp,
      })
      yield* replayed.popRecovery(events, second.id, receipt)
      expect(replayed.hardState.executionFocus?.id).toBe(firstFocus.id)
      expect(replayed.hardState.recoveryStack).toEqual([first.id])

      yield* replayed.popRecovery(events, first.id, receipt)
      expect(replayed.hardState.executionFocus?.id).toBe(obligationFocus.id)
      expect(replayed.hardState.recoveryStack).toEqual([])
    }),
  )
})

import { describe, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Exit } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSemantics } from "@opencode-ai/core/session/semantics"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { createObligationId, createClaimId, createEvidenceId } from "../../src/rivet/types"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), []),
)

describe("Predicate-scoped Praxis verification (file_constraint / claims_verified)", () => {
  it.effect("file_constraint obligations verify against harness-side filesystem observations", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_verify_predicates_file")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-verify-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)

      yield* semantics.ensureGoal(events, "/goal update README.md", tmp, "execution")
      const fileId = [...semantics.hardState.obligationPredicates.entries()].find(
        ([, predicate]) => predicate.type === "file_constraint",
      )?.[0]
      expect(fileId).toBeDefined()
      const predicate = semantics.hardState.obligationPredicates.get(fileId!)
      expect(predicate?.type).toBe("file_constraint")

      const request = {
        obligationId: fileId!,
        predicate: "verify target file",
        targetScope: semantics.scope(tmp),
        timeoutSeconds: 30,
        timestamp: new Date().toISOString(),
      }

      const failed = yield* semantics.verifyLastExecution(events, request)
      expect(failed.type).toBe("praxis")
      if (failed.type !== "praxis") return
      expect(failed.receipt.passed).toBe(false)
      expect(failed.receipt.diagnostics).toContain("FILE_NOT_FOUND")
      expect(semantics.hardState.openObligationIds()).toContain(fileId!)

      fs.writeFileSync(path.join(tmp, "README.md"), "hello rivet")
      const passed = yield* semantics.verifyLastExecution(events, request)
      expect(passed.type).toBe("praxis")
      if (passed.type !== "praxis") return
      expect(passed.receipt.passed).toBe(true)
      expect(passed.receipt.reasonCodes).toContain("FILE_CONSTRAINT_SATISFIED")
      expect(semantics.hardState.openObligationIds()).not.toContain(fileId!)
      expect(semantics.hardState.closedObligations.has(fileId!)).toBe(true)
    }),
  )

  it.effect("claims_verified closes via admitted claim and via revision-scoped sibling receipts", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_verify_predicates_claims")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-claims-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)

      yield* semantics.ensureGoal(events, "Fulfill the mission", tmp, "execution")
      const rootId = [...semantics.hardState.obligationPredicates.entries()].find(
        ([, predicate]) => predicate.type === "claims_verified",
      )?.[0]
      expect(rootId).toBeDefined()
      const rootPredicate = semantics.hardState.obligationPredicates.get(rootId!)
      expect(rootPredicate?.type).toBe("claims_verified")

      const verifyRequest = {
        obligationId: rootId!,
        predicate: "verify goal closure",
        targetScope: semantics.scope(tmp),
        timeoutSeconds: 30,
        timestamp: new Date().toISOString(),
      }

      const unverified = yield* semantics.verifyLastExecution(events, verifyRequest)
      expect(unverified.type).toBe("praxis")
      if (unverified.type !== "praxis") return
      expect(unverified.receipt.passed).toBe(false)
      expect(unverified.receipt.reasonCodes).toContain("CLAIM_NOT_ADMITTED")
      expect(semantics.hardState.openObligationIds()).toContain(rootId!)

      const evidenceId = createEvidenceId("ev_claims_mission")
      yield* semantics.append(events, {
        type: "evidence_recorded",
        evidenceId,
        source: "observed_execution",
        summary: "Mission fulfilled per observed execution",
        timestamp: new Date().toISOString(),
      })
      yield* semantics.append(events, {
        type: "claim_asserted",
        claimId: createClaimId("claim_mission_fulfilled"),
        proposition: "Goal 'Fulfill the mission' fulfilled",
        status: "supported",
        evidence: [evidenceId],
        dependencies: [],
        validityPolicy: "CURRENT_STATE",
        scope: semantics.scope(tmp),
        timestamp: new Date().toISOString(),
      })

      const admitted = yield* semantics.verifyLastExecution(events, verifyRequest)
      expect(admitted.type).toBe("praxis")
      if (admitted.type !== "praxis") return
      expect(admitted.receipt.passed).toBe(true)
      expect(semantics.hardState.openObligationIds()).not.toContain(rootId!)

      // A later goal must NOT be closed by receipts from the earlier goal:
      // sibling receipts are scoped to the goal's own mint revision.
      yield* semantics.ensureGoal(events, "Complete the second phase", tmp, "execution")
      const root2 = [...semantics.hardState.obligationPredicates.entries()]
        .filter(([id, predicate]) => predicate.type === "claims_verified" && id !== rootId)
        .map(([id]) => id)[0]
      expect(root2).toBeDefined()
      expect(root2).not.toBe(rootId)
      const secondRequest = { ...verifyRequest, obligationId: root2! }
      const guarded = yield* semantics.verifyLastExecution(events, secondRequest)
      expect(guarded.type).toBe("praxis")
      if (guarded.type !== "praxis") return
      expect(guarded.receipt.passed).toBe(false)
      expect(guarded.receipt.reasonCodes).toContain("CLAIM_NOT_ADMITTED")
    }),
  )

  it.effect("file_constraint containment: an escaping path can never pass verification", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_verify_predicates_escape")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-escape-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)
      const escapingId = createObligationId("oblg_escape_crafted")
      yield* semantics.append(events, {
        type: "obligation_created",
        obligationId: escapingId,
        description: "Ensure target path '../../etc/passwd' is maintained",
        scope: semantics.scope(tmp),
        kind: "execution",
        predicate: { type: "file_constraint", path: "../../etc/passwd", mustExist: true, contentPattern: null },
        timestamp: new Date().toISOString(),
      })

      const result = yield* semantics.verifyLastExecution(events, {
        obligationId: escapingId,
        predicate: "verify containment",
        targetScope: semantics.scope(tmp),
        timeoutSeconds: 30,
        timestamp: new Date().toISOString(),
      })
      expect(result.type).toBe("praxis")
      if (result.type !== "praxis") return
      expect(result.receipt.passed).toBe(false)
      expect(result.receipt.reasonCodes).toContain("PATH_ESCAPES_REPOSITORY")
      expect(semantics.hardState.openObligationIds()).toContain(escapingId)
    }),
  )

  it.effect("Cognitive View exposes predicate, legal transitions, and invalidated records", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_verify_predicates_view")
      const tmp = yield* Effect.acquireRelease(
        Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "rivet-view-"))),
        (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
      )
      const semantics = yield* SessionSemantics.load(db, sessionID)

      yield* semantics.ensureGoal(events, "/goal update README.md", tmp, "execution")
      const fileId = [...semantics.hardState.obligationPredicates.entries()].find(
        ([, predicate]) => predicate.type === "file_constraint",
      )?.[0]
      expect(fileId).toBeDefined()

      // ACCP invalidation authority: a substantive (well-formed) file
      // constraint can never be waived by the model.
      const denied = yield* Effect.exit(
        semantics.invalidateObligation(events, {
          obligationId: fileId!,
          reason: "Malformed: minted from punctuation, not a workspace target",
        }),
      )
      expect(Exit.isFailure(denied)).toBe(true)

      // A mechanically malformed compiler artifact IS invalidatable (audited).
      const malformedId = createObligationId("oblg_malformed_view")
      yield* semantics.append(events, {
        type: "obligation_created",
        obligationId: malformedId,
        description: "Ensure target path 'oldu.' is maintained",
        scope: semantics.scope(tmp),
        kind: "execution",
        predicate: { type: "file_constraint", path: "oldu.", mustExist: true, contentPattern: null },
        timestamp: new Date().toISOString(),
      })
      yield* semantics.invalidateObligation(events, {
        obligationId: malformedId,
        reason: "Malformed: 'oldu.' is sentence punctuation, not a workspace path",
      })
      expect(semantics.hardState.openObligationIds()).not.toContain(malformedId)
      expect(semantics.hardState.invalidatedObligations.has(malformedId)).toBe(true)

      const view = yield* semantics.cognitiveView({ repositoryId: tmp })
      const openRecord = view.obligations.find((o) => o.status === "open" && o.predicateSummary?.includes("claims_verified"))
      expect(openRecord).toBeDefined()
      if (!openRecord) return
      expect(openRecord.predicateSummary).toContain("claims_verified")
      expect(openRecord.legalTransitions?.join(" ")).toContain("invalidate_obligation")

      const invalidatedRecord = view.obligations.find((o) => o.status === "invalidated")
      expect(invalidatedRecord?.id).toBe(malformedId)
      expect(invalidatedRecord?.objective).toContain("Malformed")
    }),
  )
})

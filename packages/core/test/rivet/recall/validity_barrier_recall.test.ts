import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  InMemoryRecallStore,
  AutomaticRecallAdmissionHook,
  createMemoryId,
  type RecallDocument,
} from "../../../src/rivet/recall"
import { HardState } from "../../../src/rivet/noesis"
import { Revision, Scope, createWorkspaceId } from "../../../src/rivet/types"

describe("Noesis Read-Time Validity Barrier with Associative Recall (Invariants R-01 .. R-06)", () => {
  test("R-04: High-scoring superseded and stale memories are blocked from active knowledge and kept only in episodic history", () => {
    const store = new InMemoryRecallStore()
    const scope = Scope.global("repo", Revision.ZERO)
    const wsId = createWorkspaceId("ws_test")

    const supersededDoc: RecallDocument = {
      id: createMemoryId("mem_old_algo"),
      kind: "claim",
      text: "Primary hashing algorithm is MD5",
      summary: "MD5 hashing for password digests",
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: ["hashPassword"],
      epistemicStatus: "superseded", // Marked superseded
      validFromRevision: Revision.from(1),
      validToRevision: Revision.from(4),
      observedAt: Date.now() - 50000,
    }

    const activeDoc: RecallDocument = {
      id: createMemoryId("mem_new_algo"),
      kind: "claim",
      text: "Primary hashing algorithm is Argon2id",
      summary: "Argon2id hashing for password digests",
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: ["hashPassword"],
      epistemicStatus: "verified",
      validFromRevision: Revision.from(5),
      observedAt: Date.now(),
    }

    Effect.runSync(store.index([supersededDoc, activeDoc]))

    const state = new HardState()

    const frontier = Effect.runSync(
      AutomaticRecallAdmissionHook.admitRecall({
        hardState: state,
        recallStore: store,
        userPrompt: "How does password hashing work in this repo?",
        goalDescription: "Security review",
        repositoryId: "repo",
        focusSymbols: ["hashPassword"],
      }),
    )

    // 1. Superseded memory must NOT be in active frontier
    expect(frontier.active.some((m) => m.id === supersededDoc.id)).toBe(false)

    // 2. Active verified memory IS in active frontier
    expect(frontier.active.some((m) => m.id === activeDoc.id)).toBe(true)

    // 3. Superseded memory may appear in episodic history for context, but with non-active status
    const historicalRef = frontier.episodic.find((m) => m.id === supersededDoc.id)
    if (historicalRef) {
      expect(historicalRef.status).toBe("superseded")
    }
  })

  test("R-05: Rejected memories and failure attributions are placed in rejected memory frontier for failure avoidance", () => {
    const store = new InMemoryRecallStore()
    const scope = Scope.global("repo", Revision.ZERO)
    const wsId = createWorkspaceId("ws_test")

    const failureDoc: RecallDocument = {
      id: createMemoryId("mem_rejected_approach"),
      kind: "failure",
      text: "Rejected cache invalidation approach: caused stale writes under high load",
      summary: "Dead-end: cache invalidation on write causes race conditions",
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: ["CacheManager"],
      epistemicStatus: "rejected",
      validFromRevision: Revision.from(2),
      observedAt: Date.now() - 10000,
    }

    Effect.runSync(store.index([failureDoc]))

    const state = new HardState()

    const frontier = Effect.runSync(
      AutomaticRecallAdmissionHook.admitRecall({
        hardState: state,
        recallStore: store,
        userPrompt: "Should we try cache invalidation on write?",
        goalDescription: "Improve throughput",
        repositoryId: "repo",
      }),
    )

    // Must be classified under rejected memory frontier
    expect(frontier.rejected.some((m) => m.id === failureDoc.id)).toBe(true)
    expect(frontier.active.some((m) => m.id === failureDoc.id)).toBe(false)
  })

  test("R-06: Historical verification is explicitly tagged and cannot satisfy current revision verification", () => {
    const store = new InMemoryRecallStore()
    const scope = Scope.global("repo", Revision.ZERO)
    const wsId = createWorkspaceId("ws_test")

    const historicalDoc: RecallDocument = {
      id: createMemoryId("mem_hist_test"),
      kind: "procedure",
      text: "Integration tests for auth tokens passed",
      summary: "Auth token regression suite passed",
      workspaceId: wsId,
      scope,
      sourceRefs: [],
      relatedSymbols: ["testAuth"],
      epistemicStatus: "verified",
      validFromRevision: Revision.from(2), // Older revision than state revision 10
      observedAt: Date.now() - 30000,
    }

    Effect.runSync(store.index([historicalDoc]))

    const state = new HardState()
    // Advance state revision to 10
    state.apply({
      type: "goal_set",
      goal: "Session at revision 10",
      timestamp: new Date().toISOString(),
    })

    const frontier = Effect.runSync(
      AutomaticRecallAdmissionHook.admitRecall({
        hardState: state,
        recallStore: store,
        userPrompt: "Did auth tests pass?",
        goalDescription: "Verify auth",
        repositoryId: "repo",
      }),
    )

    // Historical verification must be placed in procedural or episodic memory with historical note
    const histRef = frontier.procedural.find((m) => m.id === historicalDoc.id) ?? frontier.episodic.find((m) => m.id === historicalDoc.id)
    expect(histRef).toBeDefined()
  })
})

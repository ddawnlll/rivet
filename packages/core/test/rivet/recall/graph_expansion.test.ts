import { describe, it, expect } from "bun:test"
import { AssociativeRetrievalEngine } from "../../../src/rivet/recall/engine"
import {
  type RecallDocument,
  type RecallQuery,
  createMemoryId,
} from "../../../src/rivet/recall/types"
import { Revision, Scope, createWorkspaceId } from "../../../src/rivet/types"

describe("Graph Neighborhood Retrieval & Bounded Multi-Hop Expansion", () => {
  const wsId = createWorkspaceId("ws_graph")
  const scope = Scope.global("repo", Revision.from(1))

  const docA: RecallDocument = {
    id: createMemoryId("doc_A"),
    kind: "claim",
    text: "Claim A: Auth token refresh race condition",
    workspaceId: wsId,
    scope,
    sourceRefs: [],
    relatedSymbols: ["refreshToken"],
    epistemicStatus: "verified",
    observedAt: 1000,
    relationships: [
      { targetId: createMemoryId("doc_B"), kind: "RESOLVED_BY" },
      { targetId: createMemoryId("doc_C"), kind: "FAILED_BECAUSE" },
    ],
  }

  const docB: RecallDocument = {
    id: createMemoryId("doc_B"),
    kind: "claim",
    text: "Claim B: Use concurrency mutex on auth refresh",
    workspaceId: wsId,
    scope,
    sourceRefs: [],
    relatedSymbols: ["authMutex"],
    epistemicStatus: "verified",
    observedAt: 1000,
    relationships: [
      { targetId: createMemoryId("doc_D"), kind: "DEPENDS_ON" },
    ],
  }

  const docC: RecallDocument = {
    id: createMemoryId("doc_C"),
    kind: "failure",
    text: "Failure C: Cache invalidation causes lock collapse",
    workspaceId: wsId,
    scope,
    sourceRefs: [],
    relatedSymbols: ["cacheClear"],
    epistemicStatus: "rejected",
    observedAt: 1000,
  }

  const docD: RecallDocument = {
    id: createMemoryId("doc_D"),
    kind: "procedure",
    text: "Procedure D: Mutex lock acquisition timeout helper",
    workspaceId: wsId,
    scope,
    sourceRefs: [],
    relatedSymbols: ["acquireMutex"],
    epistemicStatus: "verified",
    observedAt: 1000,
    relationships: [
      { targetId: createMemoryId("doc_E"), kind: "SUPPORTS" },
    ],
  }

  const docE: RecallDocument = {
    id: createMemoryId("doc_E"),
    kind: "claim",
    text: "Claim E: Low-level semaphore primitive",
    workspaceId: wsId,
    scope,
    sourceRefs: [],
    relatedSymbols: ["semaphore"],
    epistemicStatus: "verified",
    observedAt: 1000,
  }

  const allDocs = [docA, docB, docC, docD, docE]
  const docMap = new Map(allDocs.map((d) => [d.id, d]))

  it("evaluates 0-hop direct symbol match", () => {
    const query: RecallQuery = {
      prompt: "Investigate issue",
      goal: "Fix bug",
      scope,
      revision: Revision.from(2),
      activeSymbols: ["refreshToken"],
      activeClaims: [],
      limit: 5,
    }

    const scoreA = AssociativeRetrievalEngine.computeGraphScore(docA, query, docMap, 2)
    const scoreB = AssociativeRetrievalEngine.computeGraphScore(docB, query, docMap, 2)

    expect(scoreA).toBeGreaterThan(0.3)
    expect(scoreB).toBe(0)
  })

  it("evaluates 1-hop relationship traversal across typed edges", () => {
    const query: RecallQuery = {
      prompt: "Investigate issue",
      goal: "Fix bug",
      scope,
      revision: Revision.from(2),
      activeSymbols: [],
      activeClaims: ["doc_B", "doc_C"],
      limit: 5,
    }

    const scoreA = AssociativeRetrievalEngine.computeGraphScore(docA, query, docMap, 2)
    // Doc A is connected to doc_B (RESOLVED_BY) and doc_C (FAILED_BECAUSE)
    expect(scoreA).toBeGreaterThan(0.6)
  })

  it("evaluates bounded 2-hop traversal with distance decay", () => {
    // If active claim is doc_D (2 hops away from docA via docA -> docB -> docD)
    const query: RecallQuery = {
      prompt: "Investigate issue",
      goal: "Fix bug",
      scope,
      revision: Revision.from(2),
      activeSymbols: [],
      activeClaims: ["doc_D"],
      limit: 5,
    }

    // 2-hop traversal enabled (maxHop=2)
    const score2Hop = AssociativeRetrievalEngine.computeGraphScore(docA, query, docMap, 2)
    expect(score2Hop).toBeGreaterThan(0.1)

    // 1-hop traversal only (maxHop=1) should yield 0 for 2-hop distant node
    const score1HopOnly = AssociativeRetrievalEngine.computeGraphScore(docA, query, docMap, 1)
    expect(score1HopOnly).toBe(0)
  })

  it("bounds graph expansion so 3-hop distant nodes do not cause noise explosion", () => {
    // doc_E is 3 hops away from docA (docA -> docB -> docD -> docE)
    const query: RecallQuery = {
      prompt: "Investigate issue",
      goal: "Fix bug",
      scope,
      revision: Revision.from(2),
      activeSymbols: [],
      activeClaims: ["doc_E"],
      limit: 5,
    }

    const score = AssociativeRetrievalEngine.computeGraphScore(docA, query, docMap, 2)
    // 3-hop is excluded by maxHop=2 bound
    expect(score).toBe(0)
  })
})

import { describe, expect, test } from "bun:test"
import { ProjectGraph } from "../../../src/rivet/repository/project-graph"
import { TaskSignatureCompiler } from "../../../src/rivet/repository/task-signature"
import { SeedLocalizer } from "../../../src/rivet/repository/seed-localization"

describe("Multi-Channel Seed Localization & RRF Fusion", () => {
  test("Ranks relevant seeds across symbol, path, lexical, and structural proximity channels", () => {
    const graph = new ProjectGraph()

    graph.addNode("file:packages/security/src/refresh.ts", "source_file", "refresh.ts", null, "file:packages/security/src/refresh.ts")
    graph.addNode("symbol:RefreshCoordinator", "class", "RefreshCoordinator", null, "file:packages/security/src/refresh.ts")
    graph.addNode("symbol:rotateToken", "function", "rotateToken", null, "file:packages/security/src/refresh.ts")
    graph.addNode("file:packages/gateway/src/middleware.ts", "source_file", "middleware.ts", null, "file:packages/gateway/src/middleware.ts")
    graph.addNode("symbol:AuthMiddleware", "class", "AuthMiddleware", null, "file:packages/gateway/src/middleware.ts")
    graph.addNode("file:packages/unrelated/src/math.ts", "source_file", "math.ts", null, "file:packages/unrelated/src/math.ts")

    graph.addEdge("file:packages/security/src/refresh.ts", "symbol:RefreshCoordinator", "defines")
    graph.addEdge("file:packages/security/src/refresh.ts", "symbol:rotateToken", "defines")
    graph.addEdge("symbol:AuthMiddleware", "symbol:RefreshCoordinator", "references")
    graph.addEdge("symbol:RefreshCoordinator", "symbol:rotateToken", "calls")

    const signature = TaskSignatureCompiler.compile({
      userPrompt: "OAuth refresh occasionally deadlocks in RefreshCoordinator rotateToken",
    })

    const candidates = SeedLocalizer.localize(graph, signature, {
      maxSeeds: 10,
      recentChangedFiles: ["packages/security/src/refresh.ts"],
    })

    expect(candidates.length).toBeGreaterThan(0)
    // Top candidates should be related to refresh / RefreshCoordinator
    const topLabels = candidates.slice(0, 3).map((c) => c.label)
    expect(topLabels.some((l) => l.includes("RefreshCoordinator") || l.includes("refresh") || l.includes("rotateToken"))).toBe(true)

    // Check that multi-channel contributions were fused
    const coordCandidate = candidates.find((c) => c.label === "RefreshCoordinator")
    expect(coordCandidate).toBeDefined()
    expect(coordCandidate?.channels.length).toBeGreaterThan(1)
    expect(coordCandidate?.rrfScore).toBeGreaterThan(0)
  })
})

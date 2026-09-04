import { describe, expect, test } from "bun:test"
import { ProjectGraph } from "../../../src/rivet/repository/project-graph"
import { TaskNeighborhood } from "../../../src/rivet/repository/task-neighborhood"

describe("TaskNeighborhood — Ephemeral Partial Dependency Graph", () => {
  test("Constructs bounded 1-2 hop neighborhood and stops before distant nodes", () => {
    const graph = new ProjectGraph()

    // Node chain: Seed (AuthMiddleware) -> Hop 1 (RefreshCoordinator) -> Hop 2 (TokenProvider) -> Hop 3 (CryptoUtil)
    graph.addNode("symbol:AuthMiddleware", "class", "AuthMiddleware")
    graph.addNode("symbol:RefreshCoordinator", "class", "RefreshCoordinator")
    graph.addNode("symbol:TokenProvider", "interface", "TokenProvider")
    graph.addNode("symbol:CryptoUtil", "class", "CryptoUtil")
    graph.addNode("test:auth.test.ts", "test", "auth.test.ts")

    graph.addEdge("symbol:AuthMiddleware", "symbol:RefreshCoordinator", "calls")
    graph.addEdge("symbol:RefreshCoordinator", "symbol:TokenProvider", "implements")
    graph.addEdge("symbol:TokenProvider", "symbol:CryptoUtil", "calls")
    graph.addEdge("test:auth.test.ts", "symbol:RefreshCoordinator", "tests")

    // Bounded to 2 hops around AuthMiddleware
    const neighborhood = TaskNeighborhood.build(graph, ["symbol:AuthMiddleware"], 2)

    expect(neighborhood.nodes.has("symbol:AuthMiddleware")).toBe(true)
    expect(neighborhood.nodes.has("symbol:RefreshCoordinator")).toBe(true)
    expect(neighborhood.nodes.has("symbol:TokenProvider")).toBe(true)
    expect(neighborhood.nodes.has("test:auth.test.ts")).toBe(true)

    // Hop 3 CryptoUtil should NOT be included in 2-hop bounded expansion!
    expect(neighborhood.nodes.has("symbol:CryptoUtil")).toBe(false)

    const stats = neighborhood.stats()
    expect(stats.totalNodes).toBe(4)
    expect(stats.maxHops).toBe(2)
  })

  test("Exploration Loop expands neighborhood dynamically upon new observation", () => {
    const graph = new ProjectGraph()
    graph.addNode("symbol:A", "class", "A")
    graph.addNode("symbol:B", "class", "B")
    graph.addNode("symbol:DynamicTargetC", "class", "DynamicTargetC")

    graph.addEdge("symbol:A", "symbol:B", "calls")
    graph.addEdge("symbol:B", "symbol:DynamicTargetC", "calls")

    const neighborhood = TaskNeighborhood.build(graph, ["symbol:A"], 1)
    expect(neighborhood.nodes.has("symbol:A")).toBe(true)
    expect(neighborhood.nodes.has("symbol:B")).toBe(true)
    expect(neighborhood.nodes.has("symbol:DynamicTargetC")).toBe(false)

    // Dynamic exploration: Model inspects B and observes dynamic dispatch to DynamicTargetC
    const expanded = neighborhood.expandWithObservation(graph, "DynamicTargetC", 1)
    expect(expanded).toBe(true)
    expect(neighborhood.nodes.has("symbol:DynamicTargetC")).toBe(true)
  })
})

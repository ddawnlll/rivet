import { describe, expect, test } from "bun:test"
import { ProjectGraph } from "../../../src/rivet/repository/project-graph"
import { TaskNeighborhood } from "../../../src/rivet/repository/task-neighborhood"
import { TaskDirectedSemanticDeepener } from "../../../src/rivet/repository/semantic-deepening"

describe("Task-Directed Semantic Deepening", () => {
  test("Resolves precise call targets, type hierarchy, and flags dynamic dispatch ambiguities", () => {
    const graph = new ProjectGraph()

    graph.addNode("symbol:AuthMiddleware", "class", "AuthMiddleware")
    graph.addNode("symbol:RefreshCoordinator", "class", "RefreshCoordinator")
    graph.addNode("symbol:TokenProvider", "interface", "TokenProvider")
    graph.addNode("test:auth.test.ts", "test", "auth.test.ts")

    graph.addEdge("symbol:AuthMiddleware", "symbol:RefreshCoordinator", "calls")
    graph.addEdge("symbol:RefreshCoordinator", "symbol:TokenProvider", "implements")
    graph.addEdge("symbol:RefreshCoordinator", "symbol:DynamicProviderDispatch", "calls")
    graph.addEdge("test:auth.test.ts", "symbol:RefreshCoordinator", "tests")

    const neighborhood = TaskNeighborhood.build(graph, ["symbol:AuthMiddleware"], 2)

    const fileSources = new Map<string, string>([
      [
        "refresh.ts",
        `
export class RefreshCoordinator {
  rotate() {
    console.log("Rotating token")
  }
}
`,
      ],
    ])

    const deepening = TaskDirectedSemanticDeepener.deepen(neighborhood, graph, fileSources)

    // Dynamic dispatch identified
    expect(deepening.unresolvedAmbiguities.length).toBeGreaterThan(0)
    expect(deepening.unresolvedAmbiguities[0]).toContain("dynamic")

    // Type hierarchy
    expect(deepening.typeHierarchies.length).toBeGreaterThan(0)
    expect(deepening.typeHierarchies[0]?.interfaceOrBase).toBe("TokenProvider")
    expect(deepening.typeHierarchies[0]?.implementations).toContain("RefreshCoordinator")

    // Affected tests
    expect(deepening.affectedTests).toContain("auth.test.ts")
  })
})

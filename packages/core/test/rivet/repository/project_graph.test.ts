import { describe, expect, test } from "bun:test"
import { ProjectGraph } from "../../../src/rivet/repository/project-graph"

describe("ProjectGraph & Dependency Topology", () => {
  test("Constructs graph, connects dependencies, and computes reachability closure", () => {
    const graph = new ProjectGraph()

    graph.addNode("src/index.ts", "source_file", "index.ts")
    graph.addNode("src/auth.ts", "source_file", "auth.ts")
    graph.addNode("src/db.ts", "source_file", "db.ts")
    graph.addNode("test/auth.test.ts", "test_target", "auth.test.ts")

    graph.addEdge("src/index.ts", "src/auth.ts", "imports")
    graph.addEdge("src/auth.ts", "src/db.ts", "imports")
    graph.addEdge("test/auth.test.ts", "src/auth.ts", "covers")

    expect(graph.dependenciesOf("src/index.ts")).toEqual(["src/auth.ts"])
    expect(graph.dependentsOf("src/db.ts")).toEqual(["src/auth.ts"])
    expect(graph.testsCovering("src/auth.ts")).toEqual(["test/auth.test.ts"])

    // Transitive dependents of db.ts -> auth.ts and index.ts
    const closure = graph.transitiveDependents("src/db.ts")
    expect(closure.has("src/auth.ts")).toBe(true)
    expect(closure.has("src/index.ts")).toBe(true)
  })
})

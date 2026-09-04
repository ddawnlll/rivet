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

  test("Tracks epistemic confidence levels and provenance across edges", () => {
    const graph = new ProjectGraph()

    graph.addNode("file:auth.ts", "source_file", "auth.ts")
    graph.addNode("symbol:login", "function", "login")
    graph.addNode("symbol:AuthService", "interface", "AuthService")

    graph.addEdge("file:auth.ts", "symbol:login", "defines", {
      confidence: "DETERMINISTIC",
      provider: "ast_parser",
    })
    graph.addEdge("symbol:login", "symbol:AuthService", "references", {
      confidence: "RESOLVED",
      provider: "type_checker",
    })
    graph.addEdge("symbol:login", "symbol:dispatch", "calls", {
      confidence: "INFERRED",
      provider: "di_container",
    })

    const edges = graph.outgoingEdges("symbol:login")
    expect(edges.length).toBe(2)
    expect(edges.find((e) => e.to === "symbol:AuthService")?.provenance.confidence).toBe("RESOLVED")
    expect(edges.find((e) => e.to === "symbol:dispatch")?.provenance.confidence).toBe("INFERRED")
  })

  test("Incremental file caching and eviction without full rescan", () => {
    const graph = new ProjectGraph()

    graph.addNode("file:src/auth.ts", "source_file", "auth.ts", null, "file:src/auth.ts")
    graph.addNode("symbol:login", "function", "login", null, "file:src/auth.ts")
    graph.addEdge("file:src/auth.ts", "symbol:login", "defines")

    graph.recordFileIndex("file:src/auth.ts", "hash123", "v1", "v1", ["file:src/auth.ts", "symbol:login"])
    expect(graph.isFileCached("file:src/auth.ts", "hash123", "v1", "v1")).toBe(true)
    expect(graph.isFileCached("file:src/auth.ts", "hash999", "v1", "v1")).toBe(false)

    // Incremental eviction on edit
    const initialRev = graph.graphRevision
    const evictedNodes = graph.removeFile("file:src/auth.ts")

    expect(evictedNodes).toContain("file:src/auth.ts")
    expect(evictedNodes).toContain("symbol:login")
    expect(graph.getNode("file:src/auth.ts")).toBeUndefined()
    expect(graph.getNode("symbol:login")).toBeUndefined()
    expect(graph.edges.length).toBe(0)
    expect(graph.graphRevision.value).toBeGreaterThan(initialRev.value)
    expect(graph.isFileCached("file:src/auth.ts", "hash123", "v1", "v1")).toBe(false)
  })
})

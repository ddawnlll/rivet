import { describe, expect, test } from "bun:test"
import { ProjectGraph } from "../../../src/rivet/repository/project-graph"
import { TaskNeighborhood } from "../../../src/rivet/repository/task-neighborhood"
import { TaskDirectedSemanticDeepener } from "../../../src/rivet/repository/semantic-deepening"
import { RepositoryFrontierCompiler } from "../../../src/rivet/repository/repository-frontier"
import { CognitiveViewCompiler } from "../../../src/rivet/view-compiler"
import { CognitiveView, HardState } from "../../../src/rivet/noesis"
import { Revision } from "../../../src/rivet/types"

describe("RepositoryFrontier & Structure-Preserving Serialization", () => {
  test("Compiles bounded relational frontier and serializes structure-preserving prompt block", () => {
    const graph = new ProjectGraph(Revision.from(821))

    graph.addNode("file:packages/security/src/refresh.ts", "source_file", "packages/security/src/refresh.ts")
    graph.addNode("file:packages/gateway/src/middleware.ts", "source_file", "packages/gateway/src/middleware.ts")
    graph.addNode("symbol:AuthMiddleware", "class", "AuthMiddleware")
    graph.addNode("symbol:RefreshCoordinator", "class", "RefreshCoordinator")
    graph.addNode("symbol:TokenProvider", "interface", "TokenProvider")
    graph.addNode("test:refresh.test.ts", "test", "refresh.test.ts")

    graph.addEdge("symbol:AuthMiddleware", "symbol:RefreshCoordinator", "calls")
    graph.addEdge("symbol:RefreshCoordinator", "symbol:TokenProvider", "implements")
    graph.addEdge("test:refresh.test.ts", "symbol:RefreshCoordinator", "tests")

    const neighborhood = TaskNeighborhood.build(graph, ["symbol:AuthMiddleware"], 2)
    const deepening = TaskDirectedSemanticDeepener.deepen(neighborhood, graph)

    const frontier = RepositoryFrontierCompiler.compile({
      neighborhood,
      deepening,
      graph,
      recentChanges: ["RefreshCoordinator changed at r817"],
    })

    expect(frontier.keySymbols).toContain("RefreshCoordinator")
    expect(frontier.keySymbols).toContain("AuthMiddleware")
    expect(frontier.structure.some((s) => s.from === "RefreshCoordinator" && s.to === "TokenProvider" && s.relation === "implements")).toBe(true)
    expect(frontier.likelyTestSurface).toContain("refresh.test.ts")
    expect(frontier.recentRelevantChanges).toContain("RefreshCoordinator changed at r817")

    // Render structure-preserving block
    const rendered = RepositoryFrontierCompiler.render(frontier)
    expect(rendered).toContain("### REPOSITORY FRONTIER")
    expect(rendered).toContain("KEY SYMBOLS:")
    expect(rendered).toContain("STRUCTURE (Relations):")
    expect(rendered).toContain("LIKELY TEST SURFACE:")
  })

  test("Integrates cleanly with CognitiveViewCompiler and CognitiveView across all modes", () => {
    const graph = new ProjectGraph(Revision.from(42))
    graph.addNode("file:src/auth.ts", "source_file", "src/auth.ts")
    graph.addNode("symbol:LoginCoordinator", "class", "LoginCoordinator")
    graph.addEdge("file:src/auth.ts", "symbol:LoginCoordinator", "defines")

    const neighborhood = TaskNeighborhood.build(graph, ["symbol:LoginCoordinator"], 1)
    const frontier = RepositoryFrontierCompiler.compile({ neighborhood, graph })

    const hardState = new HardState()
    const compiled = CognitiveViewCompiler.compile({
      hardState,
      goalDescription: "Diagnose login latency",
      repositoryId: "rivet",
      tokenBudget: 4000,
      mode: "RAW_TEXT",
      repositoryFrontier: frontier,
    })

    expect(compiled.repositoryFrontier).toBeDefined()
    const rawText = CognitiveViewCompiler.render(compiled)
    expect(rawText).toContain("### REPOSITORY FRONTIER")
    expect(rawText).toContain("LoginCoordinator")

    // CognitiveView prompt block
    const view = new CognitiveView({
      hardRevision: compiled.hardRevision,
      repositoryId: compiled.repositoryId,
      goalDescription: compiled.goalDescription,
      activeClaims: compiled.activeClaims,
      repositoryFrontier: frontier,
    })
    const promptBlock = view.formatPromptBlock()
    expect(promptBlock).toContain("### REPOSITORY FRONTIER")
  })
})

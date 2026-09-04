import { describe, expect, test } from "bun:test"
import { Revision } from "../../../src/rivet/types"
import { ProjectGraph } from "../../../src/rivet/repository/project-graph"
import { RepositoryCensusProjector } from "../../../src/rivet/repository/census"
import { StructuralSkeletonIndexer } from "../../../src/rivet/repository/structural-indexer"

describe("T0 Census & T1 Structural Indexer", () => {
  test("T0 Census correctly detects monorepo workspaces, manifests, and build tools", () => {
    const files = [
      "package.json",
      "bunfig.toml",
      "packages/core/package.json",
      "packages/core/src/index.ts",
      "packages/core/src/auth.ts",
      "packages/core/test/auth.test.ts",
      "packages/server/package.json",
      "packages/server/src/server.ts",
      "node_modules/foo/index.js",
    ]

    const census = RepositoryCensusProjector.projectFromFiles(files, Revision.from(10))
    expect(census.primaryLanguages).toContain("TypeScript")
    expect(census.packageManagers).toContain("bun")
    expect(census.workspaces.length).toBe(2)
    expect(census.workspaces.map((w) => w.name)).toEqual(["core", "server"])

    const graph = new ProjectGraph(census.gitRevision)
    RepositoryCensusProjector.populateCensusGraph(graph, census, "rivet")

    expect(graph.getNode("package:packages/core")).toBeDefined()
    expect(graph.getNode("package:packages/server")).toBeDefined()
    expect(graph.getNode("file:packages/core/src/auth.ts")).toBeDefined()
    expect(graph.getNode("build:bun")).toBeDefined()
  })

  test("T1 Structural Indexer indexes TypeScript classes, interfaces, functions, and imports", () => {
    const graph = new ProjectGraph()
    const tsCode = `
import { Database } from "./db"
import type { User } from "./types"

export interface AuthService {
  login(u: User): Promise<boolean>
}

export class TokenCoordinator implements AuthService {
  async login(u: User): Promise<boolean> {
    Database.query("SELECT 1")
    return true
  }
}

export function createCoordinator(): TokenCoordinator {
  return new TokenCoordinator()
}
`
    const parsed = StructuralSkeletonIndexer.indexFile(graph, "src/auth/coordinator.ts", tsCode, "hash_ts_1")

    expect(parsed.symbols.length).toBe(3)
    expect(parsed.symbols.map((s) => s.name).sort()).toEqual(["AuthService", "TokenCoordinator", "createCoordinator"].sort())
    expect(parsed.imports.length).toBe(2)

    // Check graph edges
    const fileId = "file:src/auth/coordinator.ts"
    const symbols = graph.symbolsInFile(fileId)
    expect(symbols).toContain("symbol:src/auth/coordinator.ts:TokenCoordinator")
    expect(symbols).toContain("symbol:src/auth/coordinator.ts:AuthService")

    // Implements relationship
    const coordEdges = graph.outgoingEdges("symbol:src/auth/coordinator.ts:TokenCoordinator")
    const implEdge = coordEdges.find((e) => e.kind === "implements")
    expect(implEdge).toBeDefined()
    expect(implEdge?.to).toBe("symbol:AuthService")
    expect(implEdge?.provenance.confidence).toBe("RESOLVED")

    // Syntactic call
    const callEdge = graph.outgoingEdges(fileId).find((e) => e.kind === "calls")
    expect(callEdge).toBeDefined()
    expect(callEdge?.to).toBe("symbol:Database.query")
  })

  test("T1 Structural Indexer parses Python and Rust definitions gracefully", () => {
    const graph = new ProjectGraph()

    const pyCode = `
from security import TokenProvider

class AuthHandler(TokenProvider):
    def handle_request(self):
        pass

def test_auth_handler():
    assert True
`
    const pyParsed = StructuralSkeletonIndexer.indexFile(graph, "src/auth.py", pyCode, "py_hash")
    expect(pyParsed.symbols.some((s) => s.name === "AuthHandler")).toBe(true)
    expect(pyParsed.symbols.some((s) => s.name === "test_auth_handler" && s.kind === "test")).toBe(true)

    const rsCode = `
use crate::token::TokenProvider;

pub struct Coordinator;

pub trait SessionManager {
    fn refresh(&self);
}

#[test]
fn test_coordinator_rotation() {}
`
    const rsParsed = StructuralSkeletonIndexer.indexFile(graph, "src/lib.rs", rsCode, "rs_hash")
    expect(rsParsed.symbols.some((s) => s.name === "Coordinator" && s.kind === "struct")).toBe(true)
    expect(rsParsed.symbols.some((s) => s.name === "SessionManager" && s.kind === "trait")).toBe(true)
    expect(rsParsed.symbols.some((s) => s.name === "test_coordinator_rotation")).toBe(true)
  })
})

import { Revision } from "../types"
import { DerivedStateProjector, type LiveEnvironmentCensus } from "../derived-state"
import { ProjectGraph } from "./project-graph"

export interface WorkspacePackageInfo {
  readonly name: string
  readonly path: string
  readonly manifestPath: string
}

export interface RepositoryCensus extends LiveEnvironmentCensus {
  readonly gitRevision: Revision
  readonly workspaces: readonly WorkspacePackageInfo[]
  readonly packageManagers: readonly string[]
  readonly testFrameworks: readonly string[]
  readonly sourceRoots: readonly string[]
  readonly ignoredRoots: readonly string[]
  readonly fileTree: readonly string[]
}

export class RepositoryCensusProjector {
  /**
   * Deterministically projects repository census (T0 Cold Start) from relative file paths.
   */
  static projectFromFiles(files: readonly string[], revision: Revision = Revision.ZERO): RepositoryCensus {
    const baseCensus = DerivedStateProjector.projectFromFiles(files, revision)

    const workspaces: WorkspacePackageInfo[] = []
    const packageManagers: string[] = []
    const testFrameworks: string[] = []
    const sourceRoots = new Set<string>()
    const ignoredRoots = new Set<string>()

    for (const file of files) {
      const lower = file.toLowerCase()
      const parts = lower.split("/")
      const base = parts[parts.length - 1] ?? lower

      // Ignored / Vendor roots detection
      if (
        parts.includes("node_modules") ||
        parts.includes("vendor") ||
        parts.includes("dist") ||
        parts.includes("target") ||
        parts.includes("legacy") ||
        parts.includes(".venv") ||
        parts.includes("artifacts")
      ) {
        const root = parts[0]
        if (root) ignoredRoots.add(root)
      }

      // Source roots
      if (parts.includes("src")) {
        const srcIdx = parts.indexOf("src")
        sourceRoots.add(parts.slice(0, srcIdx + 1).join("/"))
      } else if (parts.includes("lib")) {
        const libIdx = parts.indexOf("lib")
        sourceRoots.add(parts.slice(0, libIdx + 1).join("/"))
      }

      // Package managers & workspaces
      if (base === "bun.lockb" || base === "bun.lock" || base === "bunfig.toml") {
        if (!packageManagers.includes("bun")) packageManagers.push("bun")
        if (!testFrameworks.includes("bun:test")) testFrameworks.push("bun:test")
      } else if (base === "pnpm-lock.yaml" || base === "pnpm-workspace.yaml") {
        if (!packageManagers.includes("pnpm")) packageManagers.push("pnpm")
      } else if (base === "package-lock.json") {
        if (!packageManagers.includes("npm")) packageManagers.push("npm")
      } else if (base === "yarn.lock") {
        if (!packageManagers.includes("yarn")) packageManagers.push("yarn")
      } else if (base === "cargo.lock") {
        if (!packageManagers.includes("cargo")) packageManagers.push("cargo")
        if (!testFrameworks.includes("cargo-test")) testFrameworks.push("cargo-test")
      }

      // Test frameworks
      if (base.includes(".test.") || base.includes(".spec.") || base.startsWith("test_")) {
        if (baseCensus.primaryLanguages.includes("TypeScript") && !testFrameworks.includes("bun:test") && !testFrameworks.includes("vitest")) {
          testFrameworks.push("bun:test")
        }
        if (baseCensus.primaryLanguages.includes("Python") && !testFrameworks.includes("pytest")) {
          testFrameworks.push("pytest")
        }
      }

      // Multi-package workspaces
      if (base === "package.json" && parts.length > 1) {
        const pkgDir = parts.slice(0, -1).join("/")
        const pkgName = parts[parts.length - 2] ?? pkgDir
        workspaces.push({
          name: pkgName,
          path: pkgDir,
          manifestPath: file,
        })
      } else if (base === "cargo.toml" && parts.length > 1) {
        const pkgDir = parts.slice(0, -1).join("/")
        const pkgName = parts[parts.length - 2] ?? pkgDir
        workspaces.push({
          name: pkgName,
          path: pkgDir,
          manifestPath: file,
        })
      }
    }

    if (sourceRoots.size === 0) {
      sourceRoots.add("src")
    }

    return {
      ...baseCensus,
      gitRevision: revision,
      workspaces,
      packageManagers,
      testFrameworks,
      sourceRoots: Array.from(sourceRoots),
      ignoredRoots: Array.from(ignoredRoots),
      fileTree: files,
    }
  }

  /**
   * Populates a ProjectGraph with T0 census entities and structural relationships.
   */
  static populateCensusGraph(graph: ProjectGraph, census: RepositoryCensus, repoId: string = "root"): void {
    graph.addNode(repoId, "repository", repoId, {
      languages: census.primaryLanguages,
      buildSystems: census.buildSystems,
      packageManagers: census.packageManagers,
    })

    // Workspaces / Packages
    for (const ws of census.workspaces) {
      const wsNodeId = `package:${ws.path}`
      graph.addNode(wsNodeId, "package", ws.name, { path: ws.path })
      graph.addEdge(repoId, wsNodeId, "contains", {
        confidence: "DETERMINISTIC",
        provider: "census_projector",
      })

      const manifestNodeId = `file:${ws.manifestPath}`
      graph.addNode(manifestNodeId, "config", ws.manifestPath, { path: ws.manifestPath }, ws.manifestPath)
      graph.addEdge(wsNodeId, manifestNodeId, "configures", {
        confidence: "DETERMINISTIC",
        provider: "census_projector",
      })
    }

    // Build targets / systems
    for (const bs of census.buildSystems) {
      const bsNodeId = `build:${bs}`
      graph.addNode(bsNodeId, "build_target", bs, { system: bs })
      graph.addEdge(repoId, bsNodeId, "builds", {
        confidence: "DETERMINISTIC",
        provider: "census_projector",
      })
    }

    // Test frameworks
    for (const tf of census.testFrameworks) {
      const tfNodeId = `test_runner:${tf}`
      graph.addNode(tfNodeId, "test_target", tf, { runner: tf })
      graph.addEdge(repoId, tfNodeId, "tests", {
        confidence: "DETERMINISTIC",
        provider: "census_projector",
      })
    }

    // Source files
    for (const file of census.fileTree) {
      const lower = file.toLowerCase()
      if (
        lower.endsWith(".svg") ||
        lower.endsWith(".png") ||
        lower.endsWith(".jpg") ||
        lower.endsWith(".jpeg") ||
        lower.endsWith(".ico") ||
        lower.endsWith(".woff") ||
        lower.endsWith(".woff2") ||
        lower.endsWith(".wasm") ||
        lower.endsWith(".map") ||
        lower.startsWith(".venv/") ||
        lower.includes("/.venv/") ||
        lower.startsWith("artifacts/") ||
        lower.startsWith("legacy/") ||
        lower.includes("/legacy/") ||
        lower.includes("/node_modules/")
      ) {
        continue
      }

      const isTest = file.includes(".test.") || file.includes(".spec.") || file.includes("/test/") || file.includes("/tests/")
      const fileNodeId = `file:${file}`
      graph.addNode(fileNodeId, isTest ? "test" : "source_file", file, { path: file }, file)

      // Connect to package if inside one
      const matchingWs = census.workspaces.find((ws) => file.startsWith(`${ws.path}/`))
      const parentId = matchingWs ? `package:${matchingWs.path}` : repoId
      graph.addEdge(parentId, fileNodeId, "contains", {
        confidence: "DETERMINISTIC",
        provider: "census_projector",
      })
    }
  }
}

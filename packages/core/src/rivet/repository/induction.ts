import fs from "fs"
import path from "path"
import { Effect } from "effect"
import { Revision } from "../types"
import { RepositoryCensusProjector, type RepositoryCensus, type WorkspacePackageInfo } from "./census"
import { ProjectGraph } from "./project-graph"

export type InductionPhase = "census" | "structure" | "deepread" | "claims"

export interface InductionProgressInput {
  readonly phase: InductionPhase
  readonly phaseIndex: number
  readonly totalPhases: number
  readonly processed: number
  readonly total: number
  readonly detail: string
}

export interface InductionClaimSpec {
  readonly claimId: string
  readonly proposition: string
  readonly validityPolicy: "DERIVED_STATE" | "CURRENT_STATE"
  readonly dependencies: readonly { type: "manifest"; name: string; path?: string }[]
}

export interface InductionPackageFact {
  readonly name: string
  readonly path: string
  readonly manifestPath: string
  readonly entrypoints: readonly string[]
  readonly configFiles: readonly string[]
  readonly imports: readonly string[]
  readonly exportStatements: number
  readonly filesRead: number
}

export interface InductionDependencyEdge {
  readonly from: string
  readonly to: string
}

export interface InductionResult {
  readonly fileCount: number
  readonly filesRead: number
  readonly partial: boolean
  readonly packages: readonly InductionPackageFact[]
  readonly dependencyEdges: readonly InductionDependencyEdge[]
  readonly claims: readonly InductionClaimSpec[]
  readonly durationMs: number
}

export interface InductionMarker {
  readonly status: "running" | "complete" | "partial"
  readonly startedAt: string
  readonly completedAt?: string
  readonly gitHead?: string
  readonly fileCount?: number
  readonly result?: InductionResult
}

export interface InductionRunInput {
  readonly directory: string
  readonly files: readonly string[]
  readonly census: RepositoryCensus
  readonly onProgress?: (progress: InductionProgressInput) => Effect.Effect<void>
  readonly budgetMs?: number
  readonly maxFileReads?: number
}

const TOTAL_PHASES = 4
const DEFAULT_BUDGET_MS = 600_000
const DEFAULT_MAX_FILE_READS = 500
const MARKER_STALE_MS = 15 * 60_000

const markerFile = (directory: string) => path.join(directory, ".rivet", "induction.json")

export function readInductionMarker(directory: string): InductionMarker | undefined {
  try {
    const raw = fs.readFileSync(markerFile(directory), "utf8")
    const parsed = JSON.parse(raw) as InductionMarker
    if (parsed.status !== "running" && parsed.status !== "complete" && parsed.status !== "partial") return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function writeInductionMarker(directory: string, marker: InductionMarker): void {
  fs.mkdirSync(path.dirname(markerFile(directory)), { recursive: true })
  fs.writeFileSync(markerFile(directory), JSON.stringify(marker, null, 2))
}

export function isMarkerStale(marker: InductionMarker): boolean {
  if (marker.status !== "running") return false
  return Date.now() - Date.parse(marker.startedAt) > MARKER_STALE_MS
}

export function inductionMarkerStatus(directory: string): InductionMarker | undefined {
  const marker = readInductionMarker(directory)
  if (!marker || isMarkerStale(marker)) return undefined
  return marker
}

function gitHead(directory: string): string | undefined {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: directory, stdout: "pipe", stderr: "pipe" })
    if (proc.exitCode !== 0) return undefined
    return proc.stdout.toString().trim() || undefined
  } catch {
    return undefined
  }
}

// Process-local single-flight: concurrent drains for the same directory must
// not run two overlapping scans. Cross-process safety comes from the marker
// file's running state plus its staleness window.
const inFlightDirectories = new Set<string>()

export const Induction = {
  inFlight(directory: string): boolean {
    return inFlightDirectories.has(directory)
  },
  claimInFlight(directory: string): boolean {
    if (inFlightDirectories.has(directory)) return false
    inFlightDirectories.add(directory)
    return true
  },
  releaseInFlight(directory: string): void {
    inFlightDirectories.delete(directory)
  },
}

const IMPORT_PATTERNS = [/from\s+["']([^"']+)["']/g, /require\(\s*["']([^"']+)["']\s*\)/g, /import\(\s*["']([^"']+)["']\s*\)/g]

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1] ?? "")
  }
  return specifiers
}

const ENTRYPOINT_CANDIDATES = [
  "src/index.ts",
  "src/index.tsx",
  "src/index.js",
  "src/main.ts",
  "index.ts",
  "index.js",
  "main.ts",
  "README.md",
  "AGENTS.md",
]

function selectKeyFiles(pkg: WorkspacePackageInfo, fileTree: readonly string[]): { entrypoints: string[]; configs: string[] } {
  const prefix = pkg.path === "." ? "" : `${pkg.path}/`
  const inPackage = fileTree.filter((file) => file.startsWith(prefix))
  const entrypoints: string[] = []
  for (const candidate of ENTRYPOINT_CANDIDATES) {
    const match = inPackage.find((file) => file === `${prefix}${candidate}`)
    if (match && !entrypoints.includes(match)) entrypoints.push(match)
  }
  const configs = inPackage
    .filter((file) => file !== pkg.manifestPath && /(^|\/)[^/]*config[^/]*\.[a-z]+$|(^|\/)\.[a-z]+rc(\.[a-z]+)?$/.test(file))
    .slice(0, 4)
  return { entrypoints, configs }
}

function workspaceNameFromManifest(source: string): string | undefined {
  try {
    const parsed = JSON.parse(source) as { name?: unknown }
    return typeof parsed.name === "string" ? parsed.name : undefined
  } catch {
    return undefined
  }
}

export class RepositoryInduction {
  /**
   * Deterministic deep repository induction. Walks the census file tree,
   * reads a bounded set of key files per package, extracts package-level
   * facts (entrypoints, imports, exports) and compiles hard-claim specs.
   * Never invokes a model: everything is derived from repository content
   * within a wall-clock budget so large repositories still terminate.
   */
  static run(input: InductionRunInput): Effect.Effect<InductionResult> {
    const self = this
    return Effect.gen(function* () {
      const startedAt = Date.now()
      const budgetMs = input.budgetMs ?? DEFAULT_BUDGET_MS
      const maxFileReads = input.maxFileReads ?? DEFAULT_MAX_FILE_READS
      const deadline = startedAt + budgetMs
      const emit = (progress: InductionProgressInput) =>
        input.onProgress ? input.onProgress(progress).pipe(Effect.catch(() => Effect.void)) : Effect.void
      let partial = false

      // Phase 1 — census (already projected by the caller; published for the
      // progress stream so the TUI shows the scan starting from T0).
      yield* emit({
        phase: "census",
        phaseIndex: 0,
        totalPhases: TOTAL_PHASES,
        processed: input.files.length,
        total: input.files.length,
        detail: `${input.files.length} tracked files cataloged`,
      })

      // Phase 2 — structure graph
      const graph = new ProjectGraph(input.census.gitRevision ?? Revision.ZERO)
      RepositoryCensusProjector.populateCensusGraph(graph, input.census)
      yield* emit({
        phase: "structure",
        phaseIndex: 1,
        totalPhases: TOTAL_PHASES,
        processed: graph.nodes.size,
        total: graph.nodes.size,
        detail: `${input.census.workspaces.length} packages indexed into project graph`,
      })

      // Phase 3 — deep read of bounded key files per package
      const reads: { file: string; source: string }[] = []
      const readFile = (file: string): string | undefined => {
        if (Date.now() >= deadline) {
          partial = true
          return undefined
        }
        if (reads.length >= maxFileReads) {
          partial = true
          return undefined
        }
        try {
          const source = fs.readFileSync(path.join(input.directory, file), "utf8")
          reads.push({ file, source })
          return source
        } catch {
          return undefined
        }
      }

      const packages: InductionPackageFact[] = []
      const workspaces: WorkspacePackageInfo[] = [
        ...rootWorkspace(input.directory, input.census),
        ...input.census.workspaces,
      ]
      const totalWork = workspaces.reduce(
        (sum, pkg) => sum + selectKeyFiles(pkg, input.census.fileTree).entrypoints.length + 1,
        0,
      )
      let processed = 0
      const rawImportsByPath = new Map<string, string[]>()

      for (const pkg of workspaces) {
        const selected = selectKeyFiles(pkg, input.census.fileTree)
        const targets = [pkg.manifestPath, ...selected.entrypoints, ...selected.configs]
        let manifestName: string | undefined
        let entrypoints: string[] = []
        let configs: string[] = []
        let exportStatements = 0
        let filesRead = 0
        const rawImports: string[] = []

        for (const file of targets) {
          const source = readFile(file)
          processed += 1
          if (source === undefined) continue
          filesRead += 1
          if (file === pkg.manifestPath) {
            manifestName = workspaceNameFromManifest(source)
            continue
          }
          rawImports.push(...extractImportSpecifiers(source))
          exportStatements += (source.match(/\bexport\b/g) ?? []).length
          if (selected.entrypoints.includes(file)) entrypoints = [...entrypoints, file]
          else configs = [...configs, file]
          if (filesRead % 5 === 0 || file === targets[targets.length - 1]) {
            yield* emit({
              phase: "deepread",
              phaseIndex: 2,
              totalPhases: TOTAL_PHASES,
              processed,
              total: totalWork,
              detail: `reading ${file}`,
            })
          }
        }

        rawImportsByPath.set(pkg.path, rawImports)
        packages.push({
          name: manifestName ?? pkg.name,
          path: pkg.path,
          manifestPath: pkg.manifestPath,
          entrypoints,
          configFiles: configs,
          imports: [],
          exportStatements,
          filesRead,
        })

        if (Date.now() >= deadline) break
      }

      // Resolve name-based import edges between known workspaces.
      const nameToPackage = new Map(packages.map((pkg) => [pkg.name, pkg] as const))
      const dependencyEdges: InductionDependencyEdge[] = []
      for (const pkg of packages) {
        const resolved = new Set<string>()
        for (const spec of rawImportsByPath.get(pkg.path) ?? []) {
          const target = [...nameToPackage.entries()].find(([name]) => spec === name || spec.startsWith(`${name}/`))
          if (!target || target[1].path === pkg.path) continue
          resolved.add(target[1].name)
        }
        const fact: InductionPackageFact = { ...pkg, imports: [...resolved] }
        packages[packages.indexOf(pkg)] = fact
        for (const dependency of resolved) {
          if (dependencyEdges.some((edge) => edge.from === fact.name && edge.to === dependency)) continue
          dependencyEdges.push({ from: fact.name, to: dependency })
        }
      }

      // Phase 4 — compile hard-claim specs from the observed facts
      const claims = compileClaims(packages, dependencyEdges, input)
      yield* emit({
        phase: "claims",
        phaseIndex: 3,
        totalPhases: TOTAL_PHASES,
        processed: claims.length,
        total: claims.length,
        detail: `${claims.length} hard claims compiled from deep scan`,
      })

      return {
        fileCount: input.files.length,
        filesRead: reads.length,
        partial,
        packages,
        dependencyEdges,
        claims,
        durationMs: Date.now() - startedAt,
      } satisfies InductionResult
    })
  }
}

function rootWorkspace(directory: string, census: RepositoryCensus): readonly WorkspacePackageInfo[] {
  const rootManifest = ["package.json", "Cargo.toml"].find((manifest) =>
    census.fileTree.includes(manifest),
  )
  if (!rootManifest || census.workspaces.some((pkg) => pkg.manifestPath === rootManifest)) return []
  return [{ name: path.basename(directory), path: ".", manifestPath: rootManifest }]
}

function compileClaims(
  packages: readonly InductionPackageFact[],
  edges: readonly InductionDependencyEdge[],
  input: InductionRunInput,
): readonly InductionClaimSpec[] {
  const claims: InductionClaimSpec[] = []
  const manifestDeps = packages.map((pkg) => ({ type: "manifest" as const, name: pkg.manifestPath }))

  if (packages.length > 0) {
    const names = packages.slice(0, 10).map((pkg) => pkg.name)
    const suffix = packages.length > 10 ? ` and ${packages.length - 10} more` : ""
    claims.push({
      claimId: "claim_induction_package_structure",
      proposition: `Deep induction cataloged ${packages.length} packages: ${names.join(", ")}${suffix}`,
      validityPolicy: "CURRENT_STATE",
      dependencies: manifestDeps,
    })
  }

  if (edges.length > 0) {
    const summary = edges.slice(0, 12).map((edge) => `${edge.from} → ${edge.to}`).join("; ")
    const suffix = edges.length > 12 ? ` (+${edges.length - 12} more)` : ""
    claims.push({
      claimId: "claim_induction_dependencies",
      proposition: `Package dependency direction from import analysis (${edges.length} edges): ${summary}${suffix}`,
      validityPolicy: "DERIVED_STATE",
      dependencies: manifestDeps,
    })
  }

  const entrypointPairs = packages
    .filter((pkg) => pkg.entrypoints.length > 0)
    .slice(0, 10)
    .map((pkg) => `${pkg.name} → ${pkg.entrypoints[0]}`)
  if (entrypointPairs.length > 0) {
    claims.push({
      claimId: "claim_induction_entrypoints",
      proposition: `Primary entrypoints from deep induction: ${entrypointPairs.join("; ")}`,
      validityPolicy: "CURRENT_STATE",
      dependencies: manifestDeps,
    })
  }

  const ignored = input.census.ignoredRoots
  if (ignored.length > 0) {
    claims.push({
      claimId: "claim_induction_scan_boundary",
      proposition: `Deep induction scanned ${input.census.fileTree.length} tracked files across ${packages.length} packages, skipping vendor/generated roots: ${ignored.join(", ")}.`,
      validityPolicy: "DERIVED_STATE",
      dependencies: [],
    })
  }

  return claims
}

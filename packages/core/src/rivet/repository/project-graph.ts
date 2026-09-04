import { Revision, type EvidenceId } from "../types"

export type NodeKind =
  | "repository"
  | "workspace"
  | "package"
  | "module"
  | "source_file"
  | "generated_file"
  | "symbol"
  | "function"
  | "method"
  | "type"
  | "class"
  | "interface"
  | "struct"
  | "trait"
  | "test"
  | "test_target"
  | "build_target"
  | "service"
  | "external_dependency"
  | "config"
  | "entrypoint"

export type EdgeKind =
  | "contains"
  | "defines"
  | "imports"
  | "exports"
  | "references"
  | "implements"
  | "extends"
  | "inherits"
  | "calls"
  | "builds"
  | "configures"
  | "configured_by"
  | "links_to"
  | "depends_on"
  | "tests"
  | "tested_by"
  | "covers"
  | "generates"
  | "served_by"

export type GraphConfidence =
  | "DETERMINISTIC"
  | "RESOLVED"
  | "SYNTACTIC"
  | "INFERRED"

export interface EdgeProvenance {
  readonly provider: string
  readonly repoSnapshot: string
  readonly confidence: GraphConfidence
  readonly evidenceRefs: readonly EvidenceId[]
}

export interface ProjectNode {
  readonly id: string
  readonly kind: NodeKind
  readonly label: string
  readonly fileId?: string
  readonly metadata?: Record<string, unknown> | null
}

export interface ProjectEdge {
  readonly from: string
  readonly to: string
  readonly kind: EdgeKind
  readonly provenance: EdgeProvenance
}

export interface FileCacheEntry {
  readonly contentHash: string
  readonly parserVersion: string
  readonly indexerVersion: string
  readonly nodeIds: readonly string[]
}

export class ProjectGraph {
  repositoryRevision: Revision
  graphRevision: Revision

  readonly nodes: Map<string, ProjectNode> = new Map()
  readonly edges: ProjectEdge[] = []
  private readonly edgesFromMap: Map<string, ProjectEdge[]> = new Map()
  private readonly edgesToMap: Map<string, ProjectEdge[]> = new Map()
  private readonly fileCache: Map<string, FileCacheEntry> = new Map()

  constructor(repositoryRevision: Revision = Revision.ZERO, graphRevision: Revision = Revision.ZERO) {
    this.repositoryRevision = repositoryRevision
    this.graphRevision = graphRevision
  }

  addNode(
    id: string,
    kind: NodeKind,
    label: string,
    metadata?: Record<string, unknown> | null,
    fileId?: string
  ): void {
    this.nodes.set(id, { id, kind, label, fileId, metadata: metadata ?? null })
  }

  addEdge(
    from: string,
    to: string,
    kind: EdgeKind,
    provenance?: Partial<EdgeProvenance>
  ): void {
    const edge: ProjectEdge = {
      from,
      to,
      kind,
      provenance: {
        provider: provenance?.provider ?? "deterministic_census",
        repoSnapshot: provenance?.repoSnapshot ?? this.repositoryRevision.toString(),
        confidence: provenance?.confidence ?? "DETERMINISTIC",
        evidenceRefs: provenance?.evidenceRefs ?? [],
      },
    }

    this.edges.push(edge)

    const fromList = this.edgesFromMap.get(from) ?? []
    fromList.push(edge)
    this.edgesFromMap.set(from, fromList)

    const toList = this.edgesToMap.get(to) ?? []
    toList.push(edge)
    this.edgesToMap.set(to, toList)
  }

  getNode(id: string): ProjectNode | undefined {
    return this.nodes.get(id)
  }

  outgoingEdges(nodeId: string): ProjectEdge[] {
    return this.edgesFromMap.get(nodeId) ?? []
  }

  incomingEdges(nodeId: string): ProjectEdge[] {
    return this.edgesToMap.get(nodeId) ?? []
  }

  dependenciesOf(nodeId: string): string[] {
    const edges = this.outgoingEdges(nodeId)
    return edges
      .filter(
        (e) =>
          e.kind === "depends_on" ||
          e.kind === "imports" ||
          e.kind === "references" ||
          e.kind === "calls" ||
          e.kind === "implements" ||
          e.kind === "extends" ||
          e.kind === "inherits"
      )
      .map((e) => e.to)
  }

  dependentsOf(nodeId: string): string[] {
    const edges = this.incomingEdges(nodeId)
    return edges
      .filter(
        (e) =>
          e.kind === "depends_on" ||
          e.kind === "imports" ||
          e.kind === "references" ||
          e.kind === "calls" ||
          e.kind === "implements" ||
          e.kind === "extends" ||
          e.kind === "inherits"
      )
      .map((e) => e.from)
  }

  testsCovering(nodeId: string): string[] {
    const list: string[] = []
    for (const e of this.incomingEdges(nodeId)) {
      if (e.kind === "covers" || e.kind === "tested_by" || e.kind === "tests") {
        list.push(e.from)
      }
    }
    for (const e of this.outgoingEdges(nodeId)) {
      if (e.kind === "tested_by" || e.kind === "tests") {
        list.push(e.to)
      }
    }
    return Array.from(new Set(list))
  }

  symbolsInFile(fileId: string): string[] {
    return this.outgoingEdges(fileId)
      .filter((e) => e.kind === "defines" || e.kind === "contains" || e.kind === "exports")
      .map((e) => e.to)
  }

  /**
   * Reachability closure for impact analysis
   */
  transitiveDependents(rootId: string): Set<string> {
    const visited = new Set<string>()
    const queue = [rootId]

    while (queue.length > 0) {
      const current = queue.pop()!
      for (const dep of this.dependentsOf(current)) {
        if (!visited.has(dep)) {
          visited.add(dep)
          queue.push(dep)
        }
      }
    }

    return visited
  }

  /**
   * Incremental cache check. Returns true if file hasn't changed.
   */
  isFileCached(fileId: string, contentHash: string, parserVersion: string, indexerVersion: string): boolean {
    const entry = this.fileCache.get(fileId)
    if (!entry) return false
    return (
      entry.contentHash === contentHash &&
      entry.parserVersion === parserVersion &&
      entry.indexerVersion === indexerVersion
    )
  }

  /**
   * Evicts a file and all symbols defined by it from the graph incrementally.
   */
  removeFile(fileId: string): string[] {
    const removedNodeIds = new Set<string>([fileId])

    // Find all nodes defined by this file
    for (const [id, node] of this.nodes) {
      if (node.fileId === fileId) {
        removedNodeIds.add(id)
      }
    }

    // Delete nodes
    for (const id of removedNodeIds) {
      this.nodes.delete(id)
      this.edgesFromMap.delete(id)
      this.edgesToMap.delete(id)
    }

    // Rebuild edges array and indices omitting edges touching removed nodes
    const survivingEdges = this.edges.filter((e) => !removedNodeIds.has(e.from) && !removedNodeIds.has(e.to))
    this.edges.length = 0
    this.edges.push(...survivingEdges)

    this.rebuildEdgeMaps()
    this.fileCache.delete(fileId)
    this.graphRevision = this.graphRevision.next()

    return Array.from(removedNodeIds)
  }

  /**
   * Records cache entry for an indexed file.
   */
  recordFileIndex(
    fileId: string,
    contentHash: string,
    parserVersion: string,
    indexerVersion: string,
    nodeIds: readonly string[]
  ): void {
    this.fileCache.set(fileId, {
      contentHash,
      parserVersion,
      indexerVersion,
      nodeIds,
    })
    this.graphRevision = this.graphRevision.next()
  }

  private rebuildEdgeMaps(): void {
    this.edgesFromMap.clear()
    this.edgesToMap.clear()
    for (const edge of this.edges) {
      const fromList = this.edgesFromMap.get(edge.from) ?? []
      fromList.push(edge)
      this.edgesFromMap.set(edge.from, fromList)

      const toList = this.edgesToMap.get(edge.to) ?? []
      toList.push(edge)
      this.edgesToMap.set(edge.to, toList)
    }
  }
}

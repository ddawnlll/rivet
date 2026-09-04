import { Revision } from "../types"
import type { ProjectEdge, ProjectGraph, ProjectNode } from "./project-graph"

export interface NeighborhoodStats {
  readonly totalNodes: number
  readonly totalEdges: number
  readonly fileCount: number
  readonly symbolCount: number
  readonly testCount: number
  readonly maxHops: number
}

export class TaskNeighborhood {
  readonly revision: Revision
  readonly seedNodeIds: readonly string[]
  readonly nodes: Map<string, ProjectNode> = new Map()
  readonly edges: ProjectEdge[] = []
  private readonly edgesFromMap: Map<string, ProjectEdge[]> = new Map()
  private readonly edgesToMap: Map<string, ProjectEdge[]> = new Map()
  private readonly nodeHopDistance: Map<string, number> = new Map()

  constructor(revision: Revision, seedNodeIds: readonly string[]) {
    this.revision = revision
    this.seedNodeIds = seedNodeIds
  }

  /**
   * Constructs an ephemeral, bounded partial dependency graph (1-2 hops) around seed nodes.
   */
  static build(
    graph: ProjectGraph,
    seedNodeIds: readonly string[],
    maxHops: number = 2
  ): TaskNeighborhood {
    const neighborhood = new TaskNeighborhood(graph.graphRevision, seedNodeIds)
    neighborhood.expand(graph, seedNodeIds, maxHops)
    return neighborhood
  }

  /**
   * Expands the neighborhood around target nodes up to remaining hops.
   */
  expand(graph: ProjectGraph, startingNodeIds: readonly string[], maxHops: number): void {
    const queue: Array<{ id: string; hop: number }> = []

    for (const seedId of startingNodeIds) {
      const node = graph.getNode(seedId)
      if (node) {
        this.addNodeInternal(node, 0)
        queue.push({ id: seedId, hop: 0 })
      }
    }

    while (queue.length > 0) {
      const item = queue.shift()!
      if (item.hop >= maxHops) continue

      const nextHop = item.hop + 1

      // 1. Outgoing edges (imports, references, calls, implements, defines, tests)
      for (const edge of graph.outgoingEdges(item.id)) {
        this.addEdgeInternal(edge)
        const targetNode = graph.getNode(edge.to)
        if (targetNode && !this.nodes.has(edge.to)) {
          this.addNodeInternal(targetNode, nextHop)
          queue.push({ id: edge.to, hop: nextHop })
        }
      }

      // 2. Incoming edges (callers, dependents, tests covering)
      for (const edge of graph.incomingEdges(item.id)) {
        this.addEdgeInternal(edge)
        const sourceNode = graph.getNode(edge.from)
        if (sourceNode && !this.nodes.has(edge.from)) {
          this.addNodeInternal(sourceNode, nextHop)
          queue.push({ id: edge.from, hop: nextHop })
        }
      }
    }
  }

  /**
   * Exploration Loop: dynamically expands the ephemeral neighborhood when a new observation occurs.
   */
  expandWithObservation(graph: ProjectGraph, observedTarget: string, hops: number = 1): boolean {
    const targetNodeId = observedTarget.startsWith("file:") || observedTarget.startsWith("symbol:")
      ? observedTarget
      : `symbol:${observedTarget}`

    const node = graph.getNode(targetNodeId) || graph.getNode(`file:${observedTarget}`)
    if (!node) {
      return false
    }

    const resolvedId = node.id
    if (!this.nodes.has(resolvedId)) {
      this.addNodeInternal(node, 1)
    }

    this.expand(graph, [resolvedId], hops)
    return true
  }

  getFiles(): string[] {
    const files = new Set<string>()
    for (const node of this.nodes.values()) {
      if (node.kind === "source_file" || node.kind === "test" || node.kind === "config") {
        files.add(node.label)
      } else if (node.fileId) {
        files.add(node.fileId.replace(/^file:/, ""))
      }
    }
    return Array.from(files)
  }

  getSymbols(): ProjectNode[] {
    return Array.from(this.nodes.values()).filter(
      (n) => n.kind === "symbol" || n.kind === "function" || n.kind === "class" || n.kind === "interface" || n.kind === "struct" || n.kind === "trait" || n.kind === "type"
    )
  }

  getTests(): ProjectNode[] {
    return Array.from(this.nodes.values()).filter(
      (n) => n.kind === "test" || n.kind === "test_target"
    )
  }

  getPackages(): string[] {
    const pkgs = new Set<string>()
    for (const file of this.getFiles()) {
      if (file.startsWith("packages/")) {
        const parts = file.split("/")
        if (parts[1]) pkgs.add(`packages/${parts[1]}`)
      }
    }
    return Array.from(pkgs)
  }

  stats(): NeighborhoodStats {
    let fileCount = 0
    let symbolCount = 0
    let testCount = 0
    let maxHops = 0

    for (const [id, node] of this.nodes) {
      const h = this.nodeHopDistance.get(id) ?? 0
      if (h > maxHops) maxHops = h

      if (node.kind === "source_file" || node.kind === "config") fileCount++
      else if (node.kind === "test" || node.kind === "test_target") testCount++
      else if (node.kind !== "repository" && node.kind !== "package") symbolCount++
    }

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.length,
      fileCount,
      symbolCount,
      testCount,
      maxHops,
    }
  }

  private addNodeInternal(node: ProjectNode, hop: number): void {
    this.nodes.set(node.id, node)
    const existingHop = this.nodeHopDistance.get(node.id)
    if (existingHop === undefined || hop < existingHop) {
      this.nodeHopDistance.set(node.id, hop)
    }
  }

  private addEdgeInternal(edge: ProjectEdge): void {
    // Avoid duplicates
    if (!this.edges.some((e) => e.from === edge.from && e.to === edge.to && e.kind === edge.kind)) {
      this.edges.push(edge)

      const fromList = this.edgesFromMap.get(edge.from) ?? []
      fromList.push(edge)
      this.edgesFromMap.set(edge.from, fromList)

      const toList = this.edgesToMap.get(edge.to) ?? []
      toList.push(edge)
      this.edgesToMap.set(edge.to, toList)
    }
  }
}

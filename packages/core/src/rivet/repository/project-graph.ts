import type { EvidenceId } from "../types"

export type NodeKind =
  | "repository"
  | "directory"
  | "source_file"
  | "generated_file"
  | "symbol"
  | "type"
  | "module"
  | "package"
  | "build_target"
  | "test_target"
  | "service"
  | "external_dependency"
  | "config"

export type EdgeKind =
  | "defines"
  | "references"
  | "calls"
  | "imports"
  | "inherits"
  | "implements"
  | "builds"
  | "links_to"
  | "depends_on"
  | "tested_by"
  | "covers"
  | "generates"
  | "configured_by"
  | "served_by"

export interface EdgeProvenance {
  readonly provider: string
  readonly repoSnapshot: string
  readonly confidence: string
  readonly evidenceRefs: readonly EvidenceId[]
}

export interface ProjectNode {
  readonly id: string
  readonly kind: NodeKind
  readonly label: string
  readonly metadata?: Record<string, unknown> | null
}

export interface ProjectEdge {
  readonly from: string
  readonly to: string
  readonly kind: EdgeKind
  readonly provenance: EdgeProvenance
}

export class ProjectGraph {
  readonly nodes: Map<string, ProjectNode> = new Map()
  readonly edges: ProjectEdge[] = []

  addNode(
    id: string,
    kind: NodeKind,
    label: string,
    metadata?: Record<string, unknown> | null
  ): void {
    this.nodes.set(id, { id, kind, label, metadata: metadata ?? null })
  }

  addEdge(
    from: string,
    to: string,
    kind: EdgeKind,
    provenance?: Partial<EdgeProvenance>
  ): void {
    this.edges.push({
      from,
      to,
      kind,
      provenance: {
        provider: provenance?.provider ?? "deterministic_census",
        repoSnapshot: provenance?.repoSnapshot ?? "r0",
        confidence: provenance?.confidence ?? "authoritative",
        evidenceRefs: provenance?.evidenceRefs ?? [],
      },
    })
  }

  outgoingEdges(nodeId: string): ProjectEdge[] {
    return this.edges.filter((e) => e.from === nodeId)
  }

  incomingEdges(nodeId: string): ProjectEdge[] {
    return this.edges.filter((e) => e.to === nodeId)
  }

  dependenciesOf(nodeId: string): string[] {
    return this.edges
      .filter(
        (e) =>
          e.from === nodeId &&
          (e.kind === "depends_on" ||
            e.kind === "imports" ||
            e.kind === "references" ||
            e.kind === "calls")
      )
      .map((e) => e.to)
  }

  dependentsOf(nodeId: string): string[] {
    return this.edges
      .filter(
        (e) =>
          e.to === nodeId &&
          (e.kind === "depends_on" ||
            e.kind === "imports" ||
            e.kind === "references" ||
            e.kind === "calls")
      )
      .map((e) => e.from)
  }

  testsCovering(nodeId: string): string[] {
    const list: string[] = []
    for (const e of this.edges) {
      if (e.to === nodeId && (e.kind === "covers" || e.kind === "tested_by")) {
        list.push(e.from)
      } else if (e.from === nodeId && e.kind === "tested_by") {
        list.push(e.to)
      }
    }
    return list
  }

  symbolsInFile(fileId: string): string[] {
    return this.edges
      .filter((e) => e.from === fileId && e.kind === "defines")
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
}

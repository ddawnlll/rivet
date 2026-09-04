import type { GraphConfidence, ProjectGraph } from "./project-graph"
import type { TaskNeighborhood } from "./task-neighborhood"

export interface CallResolution {
  readonly callerId: string
  readonly calleeId: string
  readonly calleeName: string
  readonly confidence: GraphConfidence
  readonly isDynamicDispatch?: boolean
}

export interface TypeHierarchyEntry {
  readonly interfaceOrBase: string
  readonly implementations: readonly string[]
}

export interface DefUseChain {
  readonly symbol: string
  readonly file: string
  readonly definedAtLine?: number
  readonly usedAtLines: readonly number[]
}

export interface SemanticDeepeningResult {
  readonly resolvedCalls: readonly CallResolution[]
  readonly typeHierarchies: readonly TypeHierarchyEntry[]
  readonly defUseChains: readonly DefUseChain[]
  readonly affectedTests: readonly string[]
  readonly unresolvedAmbiguities: readonly string[]
}

export class TaskDirectedSemanticDeepener {
  /**
   * Deepens analysis strictly on the small, ephemeral TaskNeighborhood.
   */
  static deepen(
    neighborhood: TaskNeighborhood,
    graph: ProjectGraph,
    fileSources?: Map<string, string>
  ): SemanticDeepeningResult {
    const resolvedCalls: CallResolution[] = []
    const unresolvedAmbiguities: string[] = []

    // 1. Precise Call Resolution within neighborhood
    const neighborhoodSymbols = neighborhood.getSymbols()
    const symbolMap = new Map<string, string>() // name -> id
    for (const sym of neighborhoodSymbols) {
      symbolMap.set(sym.label, sym.id)
    }

    for (const edge of neighborhood.edges) {
      if (edge.kind === "calls") {
        const rawCallee = edge.to.replace(/^symbol:/, "")
        const calleeBaseName = rawCallee.split(".").pop() ?? rawCallee

        // Check if matching symbol exists in neighborhood
        const targetId = symbolMap.get(calleeBaseName) || symbolMap.get(rawCallee)
        if (targetId) {
          resolvedCalls.push({
            callerId: edge.from,
            calleeId: targetId,
            calleeName: rawCallee,
            confidence: "RESOLVED",
            isDynamicDispatch: false,
          })
        } else {
          // Check if it's dynamic dispatch or provider dispatch
          if (rawCallee.includes("dispatch") || rawCallee.includes("Provider") || rawCallee.includes("Handler")) {
            unresolvedAmbiguities.push(
              `${rawCallee} call target is selected dynamically via provider/dispatch; static target is uncertain.`
            )
            resolvedCalls.push({
              callerId: edge.from,
              calleeId: edge.to,
              calleeName: rawCallee,
              confidence: "INFERRED",
              isDynamicDispatch: true,
            })
          }
        }
      }
    }

    // 2. Type Hierarchy & Implementation Mapping
    const typeHierarchies: TypeHierarchyEntry[] = []
    const interfaceMap = new Map<string, string[]>()

    for (const sym of neighborhoodSymbols) {
      if (sym.kind === "interface" || sym.kind === "trait" || sym.kind === "type") {
        if (!interfaceMap.has(sym.label)) {
          interfaceMap.set(sym.label, [])
        }
      }
    }

    for (const edge of neighborhood.edges) {
      if (edge.kind === "implements" || edge.kind === "extends" || edge.kind === "inherits") {
        const baseName = edge.to.replace(/^symbol:/, "").split(":").pop() ?? edge.to
        const implName = edge.from.replace(/^symbol:/, "").split(":").pop() ?? edge.from
        const list = interfaceMap.get(baseName) ?? []
        list.push(implName)
        interfaceMap.set(baseName, list)
      }
    }

    for (const [interfaceOrBase, implementations] of interfaceMap) {
      if (implementations.length > 0) {
        typeHierarchies.push({
          interfaceOrBase,
          implementations: Array.from(new Set(implementations)),
        })
      }
    }

    // 3. Local Definition-Use & Dataflow Slicing
    const defUseChains: DefUseChain[] = []
    if (fileSources) {
      for (const [file, content] of fileSources) {
        if (!neighborhood.getFiles().includes(file)) continue
        const lines = content.split("\n")

        for (const sym of neighborhoodSymbols) {
          if (sym.fileId?.endsWith(file) || sym.id.includes(file)) {
            const symName = sym.label
            const defLine = (sym.metadata?.line as number) ?? undefined
            const usedLines: number[] = []

            for (let i = 0; i < lines.length; i++) {
              const lineNum = i + 1
              if (defLine !== undefined && lineNum === defLine) continue
              if (lines[i]?.includes(symName)) {
                usedLines.push(lineNum)
              }
            }

            if (usedLines.length > 0) {
              defUseChains.push({
                symbol: symName,
                file,
                definedAtLine: defLine,
                usedAtLines: usedLines,
              })
            }
          }
        }
      }
    }

    // 4. Affected Tests
    const affectedTests = new Set<string>()
    for (const testNode of neighborhood.getTests()) {
      affectedTests.add(testNode.label)
    }

    // Also look up tests covering any neighborhood file in the global graph
    for (const file of neighborhood.getFiles()) {
      for (const testId of graph.testsCovering(`file:${file}`)) {
        const node = graph.getNode(testId)
        if (node) affectedTests.add(node.label)
      }
    }

    return {
      resolvedCalls,
      typeHierarchies,
      defUseChains,
      affectedTests: Array.from(affectedTests),
      unresolvedAmbiguities,
    }
  }
}

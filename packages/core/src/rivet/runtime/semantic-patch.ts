import { existsSync, readFileSync, renameSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { Revision, RivetError } from "../types"

export type PatchOperation =
  | "replace_body"
  | "insert_before"
  | "insert_after"
  | "rename_symbol"
  | "delete_symbol"

export interface PatchIntent {
  readonly target: string // symbol://path/to/file/symbol_name
  readonly expectedRevision: Revision
  readonly operation: PatchOperation
  readonly proposedArtifact: string
  readonly newSymbolName?: string | null
}

export class SemanticPatchEngine {
  static parseSymbolUri(uri: string): { filePath: string; symbolName: string } {
    if (!uri.startsWith("symbol://")) {
      throw new RivetError("InvalidPath", `Invalid symbol URI: ${uri}`)
    }

    const stripped = uri.slice("symbol://".length)
    const lastSlash = stripped.lastIndexOf("/")
    if (lastSlash === -1) {
      throw new RivetError("InvalidPath", `Missing symbol name in URI: ${uri}`)
    }

    const filePath = stripped.slice(0, lastSlash)
    const symbolName = stripped.slice(lastSlash + 1)
    return { filePath, symbolName }
  }

  static applyPatch(
    workingDir: string,
    intent: PatchIntent,
    currentRevision: Revision
  ): string {
    // Enforce Invariant I-07: Stale revision rejection (CAS check)
    if (!intent.expectedRevision.equals(currentRevision)) {
      throw new RivetError(
        "StaleState",
        `Stale revision: expected=${intent.expectedRevision} actual=${currentRevision}`
      )
    }

    const { filePath, symbolName } = this.parseSymbolUri(intent.target)
    const fullPath = join(workingDir, filePath)

    if (!existsSync(fullPath)) {
      throw new RivetError("InvalidPath", `Target file '${filePath}' does not exist`)
    }

    const content = readFileSync(fullPath, "utf8")
    const modifiedContent = this.applyStructuralOperation(
      filePath,
      content,
      symbolName,
      intent.operation,
      intent.proposedArtifact,
      intent.newSymbolName ?? null
    )

    // Atomic write via temp file
    const dir = dirname(fullPath)
    const tempPath = join(dir, `.${filePath.replace(/\//g, "_")}.tmp.${Date.now()}`)
    writeFileSync(tempPath, modifiedContent, "utf8")
    renameSync(tempPath, fullPath)

    return `Successfully applied ${intent.operation} to symbol '${symbolName}' in '${filePath}'`
  }

  static applyStructuralOperation(
    filePath: string,
    content: string,
    symbolName: string,
    operation: PatchOperation,
    proposedContent: string,
    newName: string | null = null
  ): string {
    const fnHeader = `function ${symbolName}`
    const constFnHeader = `const ${symbolName}`
    const classHeader = `class ${symbolName}`
    const interfaceHeader = `interface ${symbolName}`
    const typeHeader = `type ${symbolName}`

    let symbolIdx = content.indexOf(fnHeader)
    if (symbolIdx === -1) symbolIdx = content.indexOf(constFnHeader)
    if (symbolIdx === -1) symbolIdx = content.indexOf(classHeader)
    if (symbolIdx === -1) symbolIdx = content.indexOf(interfaceHeader)
    if (symbolIdx === -1) symbolIdx = content.indexOf(typeHeader)
    if (symbolIdx === -1) symbolIdx = content.indexOf(symbolName)

    if (symbolIdx === -1) {
      throw new RivetError("Runtime", `Symbol '${symbolName}' not found in ${filePath}`)
    }

    const rest = content.slice(symbolIdx)
    const blockEnd = this.findBlockEnd(rest) ?? rest.length
    const endIdx = symbolIdx + blockEnd

    switch (operation) {
      case "insert_before":
        return `${content.slice(0, symbolIdx)}${proposedContent}\n${content.slice(symbolIdx)}`
      case "insert_after":
        return `${content.slice(0, endIdx)}\n${proposedContent}${content.slice(endIdx)}`
      case "replace_body":
        return `${content.slice(0, symbolIdx)}${proposedContent}${content.slice(endIdx)}`
      case "rename_symbol": {
        if (!newName) {
          throw new RivetError(
            "Runtime",
            "rename_symbol operation requires newSymbolName"
          )
        }
        const slice = content.slice(symbolIdx, endIdx)
        const replaced = slice.replace(symbolName, newName)
        return `${content.slice(0, symbolIdx)}${replaced}${content.slice(endIdx)}`
      }
      case "delete_symbol":
        return `${content.slice(0, symbolIdx)}${content.slice(endIdx)}`
    }
  }

  private static findBlockEnd(slice: string): number | null {
    let depth = 0
    let foundOpen = false
    let inString = false
    let escape = false

    for (let i = 0; i < slice.length; i++) {
      const c = slice[i]
      if (inString) {
        if (escape) {
          escape = false
        } else if (c === "\\") {
          escape = true
        } else if (c === '"' || c === "'") {
          inString = false
        }
        continue
      }

      if (c === '"' || c === "'") {
        inString = true
        continue
      }

      if (c === "{") {
        depth++
        foundOpen = true
      } else if (c === "}") {
        depth--
        if (foundOpen && depth === 0) {
          return i + 1
        }
      } else if (c === ";" && !foundOpen) {
        return i + 1
      }
    }

    return foundOpen ? null : slice.length
  }
}

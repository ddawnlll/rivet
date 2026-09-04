import { ProjectGraph, type GraphConfidence, type NodeKind } from "./project-graph"

export interface ParsedSymbol {
  readonly id: string
  readonly name: string
  readonly kind: NodeKind
  readonly line?: number
  readonly exported: boolean
  readonly extendsOrImplements?: readonly string[]
}

export interface ParsedImport {
  readonly source: string
  readonly importedSymbols: readonly string[]
  readonly isTypeOnly?: boolean
}

export interface FileParseResult {
  readonly fileId: string
  readonly symbols: readonly ParsedSymbol[]
  readonly imports: readonly ParsedImport[]
  readonly calls: readonly string[]
  readonly testTargets: readonly string[]
  readonly entrypoint?: boolean
}

export class StructuralSkeletonIndexer {
  static readonly PARSER_VERSION = "v1"
  static readonly INDEXER_VERSION = "v1"

  /**
   * Indexes a file into the structural project graph.
   * If cached with matching contentHash, skips parsing.
   */
  static indexFile(
    graph: ProjectGraph,
    filePath: string,
    content: string,
    contentHash: string
  ): FileParseResult {
    const fileNodeId = `file:${filePath}`

    if (graph.isFileCached(fileNodeId, contentHash, this.PARSER_VERSION, this.INDEXER_VERSION)) {
      const existingSymbols = graph.symbolsInFile(fileNodeId)
      return {
        fileId: fileNodeId,
        symbols: existingSymbols.map((s) => ({
          id: s,
          name: s.split(":").pop() ?? s,
          kind: "symbol",
          exported: true,
        })),
        imports: [],
        calls: [],
        testTargets: [],
      }
    }

    // Incremental eviction if file already exists in graph
    graph.removeFile(fileNodeId)

    const isTest = filePath.includes(".test.") || filePath.includes(".spec.") || filePath.includes("/test/") || filePath.includes("/tests/") || filePath.startsWith("test_")
    const isConfig = filePath.endsWith(".json") || filePath.endsWith(".toml") || filePath.endsWith(".yaml") || filePath.endsWith(".yml")

    let kind: NodeKind = "source_file"
    if (isTest) kind = "test"
    else if (isConfig) kind = "config"

    graph.addNode(fileNodeId, kind, filePath, { path: filePath }, fileNodeId)

    const parseResult = this.parseContent(filePath, content)
    const addedNodeIds: string[] = [fileNodeId]

    // Add symbols
    for (const sym of parseResult.symbols) {
      const symNodeId = sym.id
      addedNodeIds.push(symNodeId)
      graph.addNode(symNodeId, sym.kind, sym.name, {
        file: filePath,
        line: sym.line,
        exported: sym.exported,
      }, fileNodeId)

      // file DEFINES symbol
      graph.addEdge(fileNodeId, symNodeId, sym.exported ? "exports" : "defines", {
        confidence: "DETERMINISTIC",
        provider: "structural_indexer",
      })

      // Implements / Extends
      if (sym.extendsOrImplements) {
        for (const target of sym.extendsOrImplements) {
          const targetNodeId = `symbol:${target}`
          graph.addEdge(symNodeId, targetNodeId, "implements", {
            confidence: "RESOLVED",
            provider: "structural_indexer",
          })
        }
      }
    }

    // Add imports
    for (const imp of parseResult.imports) {
      const resolvedTargetFile = this.resolveImportTarget(filePath, imp.source)
      if (resolvedTargetFile) {
        graph.addEdge(fileNodeId, `file:${resolvedTargetFile}`, "imports", {
          confidence: "DETERMINISTIC",
          provider: "structural_indexer",
        })
      }

      for (const sym of imp.importedSymbols) {
        graph.addEdge(fileNodeId, `symbol:${sym}`, "references", {
          confidence: "SYNTACTIC",
          provider: "structural_indexer",
        })
      }
    }

    // Add syntactic calls
    for (const callTarget of parseResult.calls) {
      graph.addEdge(fileNodeId, `symbol:${callTarget}`, "calls", {
        confidence: "SYNTACTIC",
        provider: "structural_indexer",
      })
    }

    // Test coverage relationships
    if (isTest) {
      const productionCandidate = this.guessProductionTarget(filePath)
      if (productionCandidate) {
        graph.addEdge(fileNodeId, `file:${productionCandidate}`, "tests", {
          confidence: "RESOLVED",
          provider: "structural_indexer",
        })
      }
      for (const tt of parseResult.testTargets) {
        graph.addEdge(fileNodeId, `symbol:${tt}`, "tests", {
          confidence: "RESOLVED",
          provider: "structural_indexer",
        })
      }
    }

    // Entrypoint
    if (parseResult.entrypoint) {
      const epId = `entrypoint:${filePath}`
      addedNodeIds.push(epId)
      graph.addNode(epId, "entrypoint", filePath, { path: filePath }, fileNodeId)
      graph.addEdge(fileNodeId, epId, "defines", {
        confidence: "DETERMINISTIC",
        provider: "structural_indexer",
      })
    }

    graph.recordFileIndex(fileNodeId, contentHash, this.PARSER_VERSION, this.INDEXER_VERSION, addedNodeIds)
    return parseResult
  }

  /**
   * Fast syntactic content parser for TS/JS, Python, Rust, Go, JSON.
   */
  static parseContent(filePath: string, content: string): FileParseResult {
    const fileId = `file:${filePath}`
    const ext = filePath.split(".").pop()?.toLowerCase() ?? ""

    if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
      return this.parseTypeScript(fileId, filePath, content)
    }
    if (ext === "py") {
      return this.parsePython(fileId, filePath, content)
    }
    if (ext === "rs") {
      return this.parseRust(fileId, filePath, content)
    }
    if (ext === "go") {
      return this.parseGo(fileId, filePath, content)
    }
    if (ext === "json" || ext === "toml") {
      return this.parseConfig(fileId, filePath, content)
    }

    return { fileId, symbols: [], imports: [], calls: [], testTargets: [] }
  }

  private static parseTypeScript(fileId: string, filePath: string, content: string): FileParseResult {
    const symbols: ParsedSymbol[] = []
    const imports: ParsedImport[] = []
    const calls = new Set<string>()
    const testTargets = new Set<string>()

    const isIndex = filePath.endsWith("index.ts") || filePath.endsWith("index.js") || filePath.endsWith("main.ts")

    // 1. Multiline Imports
    const importRegex = /import\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]+)\})?\s*(?:\*\s+as\s+([\w$]+))?\s*from\s*['"]([^'"]+)['"]/gs
    for (const match of content.matchAll(importRegex)) {
      const defaultImp = match[1]
      const namedImps = match[2]
      const starImp = match[3]
      const src = match[4] ?? ""

      const importedSymbols: string[] = []
      if (defaultImp && defaultImp !== "type") importedSymbols.push(defaultImp)
      if (starImp) importedSymbols.push(starImp)
      if (namedImps) {
        for (const s of namedImps.split(",")) {
          const clean = s.trim().replace(/^type\s+/, "")
          const sym = clean.split(/\s+as\s+/)[0]?.trim()
          if (sym && !importedSymbols.includes(sym)) importedSymbols.push(sym)
        }
      }
      imports.push({ source: src, importedSymbols, isTypeOnly: match[0].startsWith("import type") })
    }

    // 2. Multiline Classes
    const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+([\w$]+)(?:\s+extends\s+([\w$.]+))?(?:\s+implements\s+([^{]+))?\s*\{/gs
    for (const match of content.matchAll(classRegex)) {
      const name = match[1]!
      const extendsOrImplements: string[] = []
      if (match[2]) extendsOrImplements.push(match[2].trim())
      if (match[3]) {
        for (const imp of match[3].split(",")) {
          const trimmed = imp.trim()
          if (trimmed) extendsOrImplements.push(trimmed)
        }
      }
      symbols.push({
        id: `symbol:${filePath}:${name}`,
        name,
        kind: "class",
        exported: match[0].startsWith("export"),
        extendsOrImplements,
      })
    }

    // 3. Multiline Interfaces
    const interfaceRegex = /(?:export\s+)?interface\s+([\w$]+)(?:\s+extends\s+([^{]+))?\s*\{/gs
    for (const match of content.matchAll(interfaceRegex)) {
      const name = match[1]!
      const extendsOrImplements: string[] = []
      if (match[2]) {
        for (const ext of match[2].split(",")) {
          const trimmed = ext.trim()
          if (trimmed) extendsOrImplements.push(trimmed)
        }
      }
      symbols.push({
        id: `symbol:${filePath}:${name}`,
        name,
        kind: "interface",
        exported: match[0].startsWith("export"),
        extendsOrImplements,
      })
    }

    // 4. Type aliases & Enums
    const typeRegex = /(?:export\s+)?type\s+([\w$]+)\s*=/g
    for (const match of content.matchAll(typeRegex)) {
      const name = match[1]!
      if (!symbols.some((s) => s.name === name)) {
        symbols.push({
          id: `symbol:${filePath}:${name}`,
          name,
          kind: "type",
          exported: match[0].startsWith("export"),
        })
      }
    }

    const enumRegex = /(?:export\s+)?enum\s+([\w$]+)\s*\{/g
    for (const match of content.matchAll(enumRegex)) {
      const name = match[1]!
      if (!symbols.some((s) => s.name === name)) {
        symbols.push({
          id: `symbol:${filePath}:${name}`,
          name,
          kind: "type",
          exported: match[0].startsWith("export"),
        })
      }
    }

    // 5. Functions & Exported Constants
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(/g
    for (const match of content.matchAll(funcRegex)) {
      const name = match[1]!
      if (!symbols.some((s) => s.name === name)) {
        symbols.push({
          id: `symbol:${filePath}:${name}`,
          name,
          kind: "function",
          exported: match[0].startsWith("export"),
        })
      }
    }

    const constFuncRegex = /(?:export\s+)?const\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/g
    for (const match of content.matchAll(constFuncRegex)) {
      const name = match[1]!
      if (!symbols.some((s) => s.name === name)) {
        symbols.push({
          id: `symbol:${filePath}:${name}`,
          name,
          kind: "function",
          exported: match[0].startsWith("export"),
        })
      }
    }

    // 6. Test description match & calls
    const lines = content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? ""
      if (!line || line.startsWith("//")) continue

      const testMatch = line.match(/(?:test|it|describe)\s*\(\s*['"`]([^'"`]+)['"`]/)
      if (testMatch) {
        const testDesc = testMatch[1]!
        const words = testDesc.split(/[^a-zA-Z0-9_]+/).filter((w) => w.length > 2 && /^[A-Z]/.test(w))
        for (const w of words) testTargets.add(w)
      }

      const callMatches = line.matchAll(/\b([A-Z][a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\(/g)
      for (const cm of callMatches) {
        if (cm[1] && cm[2]) {
          calls.add(`${cm[1]}.${cm[2]}`)
        }
      }
    }

    return {
      fileId,
      symbols,
      imports,
      calls: Array.from(calls),
      testTargets: Array.from(testTargets),
      entrypoint: isIndex,
    }
  }

  private static parsePython(fileId: string, filePath: string, content: string): FileParseResult {
    const symbols: ParsedSymbol[] = []
    const imports: ParsedImport[] = []
    const testTargets = new Set<string>()
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? ""
      if (!line || line.startsWith("#")) continue

      // from x import y
      const fromMatch = line.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+([a-zA-Z0-9_,\s*]+)/)
      if (fromMatch) {
        const src = fromMatch[1]!
        const syms = fromMatch[2]!.split(",").map((s) => s.trim()).filter(Boolean)
        imports.push({ source: src, importedSymbols: syms })
        continue
      }

      // import x
      const impMatch = line.match(/^import\s+([a-zA-Z0-9_.]+)/)
      if (impMatch) {
        imports.push({ source: impMatch[1]!, importedSymbols: [impMatch[1]!] })
        continue
      }

      // class Foo(Bar):
      const classMatch = line.match(/^class\s+([a-zA-Z0-9_]+)(?:\(([^)]+)\))?:/)
      if (classMatch) {
        const name = classMatch[1]!
        const bases = classMatch[2] ? classMatch[2].split(",").map((s) => s.trim()).filter(Boolean) : []
        symbols.push({
          id: `symbol:${filePath}:${name}`,
          name,
          kind: "class",
          line: i + 1,
          exported: !name.startsWith("_"),
          extendsOrImplements: bases,
        })
        continue
      }

      // def foo(...):
      const defMatch = line.match(/^def\s+([a-zA-Z0-9_]+)\s*\(/)
      if (defMatch) {
        const name = defMatch[1]!
        const isTest = name.startsWith("test_")
        symbols.push({
          id: `symbol:${filePath}:${name}`,
          name,
          kind: isTest ? "test" : "function",
          line: i + 1,
          exported: !name.startsWith("_"),
        })
        if (isTest) {
          const target = name.replace(/^test_/, "")
          if (target) testTargets.add(target)
        }
        continue
      }
    }

    return {
      fileId,
      symbols,
      imports,
      calls: [],
      testTargets: Array.from(testTargets),
      entrypoint: filePath.endsWith("__main__.py") || filePath.endsWith("main.py"),
    }
  }

  private static parseRust(fileId: string, filePath: string, content: string): FileParseResult {
    const symbols: ParsedSymbol[] = []
    const imports: ParsedImport[] = []
    const testTargets = new Set<string>()
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? ""
      if (!line || line.startsWith("//")) continue

      // use crate::...
      const useMatch = line.match(/^use\s+([^;]+);/)
      if (useMatch) {
        const pathStr = useMatch[1]!.trim()
        const parts = pathStr.split("::")
        const last = parts[parts.length - 1] ?? ""
        imports.push({ source: pathStr, importedSymbols: [last] })
        continue
      }

      // pub struct Foo
      const structMatch = line.match(/^(?:pub\s+)?struct\s+([a-zA-Z0-9_]+)/)
      if (structMatch) {
        symbols.push({
          id: `symbol:${filePath}:${structMatch[1]}`,
          name: structMatch[1]!,
          kind: "struct",
          line: i + 1,
          exported: line.startsWith("pub"),
        })
        continue
      }

      // pub trait Foo
      const traitMatch = line.match(/^(?:pub\s+)?trait\s+([a-zA-Z0-9_]+)/)
      if (traitMatch) {
        symbols.push({
          id: `symbol:${filePath}:${traitMatch[1]}`,
          name: traitMatch[1]!,
          kind: "trait",
          line: i + 1,
          exported: line.startsWith("pub"),
        })
        continue
      }

      // fn foo(...)
      const fnMatch = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/)
      if (fnMatch) {
        const name = fnMatch[1]!
        const isTest = name.startsWith("test_")
        symbols.push({
          id: `symbol:${filePath}:${name}`,
          name,
          kind: isTest ? "test" : "function",
          line: i + 1,
          exported: line.startsWith("pub"),
        })
        if (isTest) testTargets.add(name.replace(/^test_/, ""))
        continue
      }
    }

    return {
      fileId,
      symbols,
      imports,
      calls: [],
      testTargets: Array.from(testTargets),
      entrypoint: filePath.endsWith("main.rs") || filePath.endsWith("lib.rs"),
    }
  }

  private static parseGo(fileId: string, filePath: string, content: string): FileParseResult {
    const symbols: ParsedSymbol[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? ""
      if (!line || line.startsWith("//")) continue

      // func Foo(...)
      const funcMatch = line.match(/^func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/)
      if (funcMatch) {
        const name = funcMatch[1]!
        const isExported = /^[A-Z]/.test(name)
        symbols.push({
          id: `symbol:${filePath}:${name}`,
          name,
          kind: "function",
          line: i + 1,
          exported: isExported,
        })
        continue
      }

      // type Foo struct
      const typeMatch = line.match(/^type\s+([a-zA-Z0-9_]+)\s+(struct|interface)/)
      if (typeMatch) {
        const name = typeMatch[1]!
        const kind: NodeKind = typeMatch[2] === "interface" ? "interface" : "struct"
        symbols.push({
          id: `symbol:${filePath}:${name}`,
          name,
          kind,
          line: i + 1,
          exported: /^[A-Z]/.test(name),
        })
        continue
      }
    }

    return {
      fileId,
      symbols,
      imports: [],
      calls: [],
      testTargets: [],
      entrypoint: filePath.endsWith("main.go"),
    }
  }

  private static parseConfig(fileId: string, filePath: string, content: string): FileParseResult {
    const symbols: ParsedSymbol[] = []
    if (filePath.endsWith("package.json")) {
      try {
        const parsed = JSON.parse(content)
        if (parsed.name) {
          symbols.push({
            id: `symbol:${filePath}:${parsed.name}`,
            name: parsed.name,
            kind: "package",
            exported: true,
          })
        }
      } catch {
        // Fallback gracefully on unparseable JSON
      }
    }

    return {
      fileId,
      symbols,
      imports: [],
      calls: [],
      testTargets: [],
      entrypoint: false,
    }
  }

  private static resolveImportTarget(currentFile: string, importSrc: string): string | null {
    if (!importSrc.startsWith(".")) return null
    const currentParts = currentFile.split("/")
    currentParts.pop() // remove filename

    const relativeParts = importSrc.split("/")
    for (const part of relativeParts) {
      if (part === ".") continue
      if (part === "..") {
        currentParts.pop()
      } else {
        currentParts.push(part)
      }
    }

    const candidateBase = currentParts.join("/")
    // If it has no extension, default to .ts
    if (!candidateBase.includes(".")) {
      return `${candidateBase}.ts`
    }
    return candidateBase
  }

  private static guessProductionTarget(testFile: string): string | null {
    let base = testFile.replace(/\.test\.([a-zA-Z]+)$/, ".$1")
    base = base.replace(/\.spec\.([a-zA-Z]+)$/, ".$1")
    base = base.replace(/^tests?\//, "src/")
    base = base.replace(/\/tests?\//, "/src/")
    return base !== testFile ? base : null
  }
}

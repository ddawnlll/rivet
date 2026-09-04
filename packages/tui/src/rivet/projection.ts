import { createMemo } from "solid-js"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import type {
  UiChangedFile,
  UiClaimStatus,
  UiCodeFrontier,
  UiCompletionState,
  UiHardClaim,
  UiHistoryEntry,
  UiMemoryItem,
  UiObligation,
  UiRelevantFile,
  UiRivetStatus,
  UiSemanticEvent,
  UiSymbolRelation,
  UiTaskPhase,
  UiTestFile,
  UiTestResult,
  UiWorkspace,
} from "./types"

export interface RivetSessionInput {
  readonly sessionID?: string
  readonly title?: string
  readonly directory?: string
  readonly metadata?: Record<string, unknown>
  readonly messages?: readonly {
    readonly id: string
    readonly role: string
    readonly time?: { readonly created?: number; readonly completed?: number }
  }[]
  readonly parts?: readonly Part[]
  readonly changedFiles?: readonly {
    readonly file: string
    readonly additions: number
    readonly deletions: number
    readonly status?: "added" | "deleted" | "modified"
  }[]
  readonly sessionStatus?: "idle" | "busy" | "retry"
}

export interface RivetProjection {
  readonly goal: string | undefined
  readonly revision: string
  readonly phase: UiTaskPhase
  readonly hardState: readonly UiHardClaim[]
  readonly workspace: UiWorkspace
  readonly memory: readonly UiMemoryItem[]
  readonly code: UiCodeFrontier
  readonly changedFiles: readonly UiChangedFile[]
  readonly obligations: readonly UiObligation[]
  readonly testResults: readonly UiTestResult[]
  readonly completion: UiCompletionState
  readonly history: readonly UiHistoryEntry[]
  readonly statusRail: UiRivetStatus
  readonly semanticEvents: readonly UiSemanticEvent[]
}

const SEMANTIC_TOOLS = new Set(["propose_claim", "request_verification", "request_completion"])

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>
  }
}

function asString(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined
}

function parseTestReport(output: string): { passed: number; failed: number; skipped: number } {
  let passed = 0
  let failed = 0
  let skipped = 0

  const bunPass = output.match(/(\d+)\s+pass/)
  const bunFail = output.match(/(\d+)\s+fail/)
  const bunSkip = output.match(/(\d+)\s+skip/)
  if (bunPass) passed = parseInt(bunPass[1], 10)
  if (bunFail) failed = parseInt(bunFail[1], 10)
  if (bunSkip) skipped = parseInt(bunSkip[1], 10)

  const cargoMatch = output.match(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/)
  if (cargoMatch) {
    passed = parseInt(cargoMatch[1], 10)
    failed = parseInt(cargoMatch[2], 10)
    skipped = parseInt(cargoMatch[3], 10)
  }

  const pytestPass = output.match(/(\d+)\s+passed/)
  const pytestFail = output.match(/(\d+)\s+failed/)
  if (pytestPass) passed = parseInt(pytestPass[1], 10)
  if (pytestFail) failed = parseInt(pytestFail[1], 10)

  return { passed, failed, skipped }
}

export function projectRivetState(input: RivetSessionInput): RivetProjection {
  const parts = input.parts ?? []
  const toolParts = parts.filter((p): p is ToolPart => p.type === "tool")
  const changedFiles = input.changedFiles ?? []

  // 1. Goal
  const metaRivet = asRecord(input.metadata?.rivet)
  const metaGoal = asString(metaRivet?.goal)
  const goal = metaGoal ?? input.title

  // 2. Extract tools and file events in chronological sequence
  const claimsMap = new Map<string, UiHardClaim>()
  const obligationsMap = new Map<string, UiObligation>()
  const testResultsList: UiTestResult[] = []
  const historyList: UiHistoryEntry[] = []
  const semanticEvents: UiSemanticEvent[] = []

  let revisionCounter = 80 // realistic baseline revision counter
  let eventSequence = 0
  let latestEditSeq = 0
  let latestVerificationSeq = 0
  const editedFilePaths = new Set<string>()

  // Also include files from changedFiles
  for (const cf of changedFiles) {
    editedFilePaths.add(cf.file)
  }

  for (const part of toolParts) {
    if (part.state.status !== "completed" && part.state.status !== "running") continue

    const toolInput = asRecord(part.state.input) ?? {}
    const toolMeta = asRecord(part.state.metadata) ?? {}
    const output = part.state.status === "completed" && typeof part.state.output === "string" ? part.state.output : ""

    if (part.tool === "edit" || part.tool === "write" || part.tool === "apply_patch") {
      const filePath = asString(toolInput.path) ?? asString(toolInput.filePath) ?? asString(toolInput.file) ?? ""
      if (filePath) {
        editedFilePaths.add(filePath)
        latestEditSeq = ++eventSequence
        revisionCounter += 1
        historyList.push({
          revision: `r${revisionCounter}`,
          summary: `${filePath} changed`,
          detail: `File modified by ${part.tool}`,
        })
      }
    } else if (part.tool === "propose_claim") {
      revisionCounter += 1
      const rev = `r${revisionCounter}`
      const prop = asString(toolInput.proposition) ?? asString(toolInput.claim) ?? ""
      const claimId = asString(toolMeta.claim_id) ?? asString(toolInput.claim_id) ?? `claim_${claimsMap.size + 1}`
      const evidence = Array.isArray(toolInput.supporting_evidence)
        ? toolInput.supporting_evidence.map(String)
        : Array.isArray(toolInput.evidence)
          ? toolInput.evidence.map(String)
          : []
      const scope = asString(toolInput.scope) ?? "global"

      claimsMap.set(claimId, {
        id: claimId,
        proposition: prop,
        status: "supported",
        sinceRevision: rev,
        evidence,
        scope,
      })

      historyList.push({
        revision: rev,
        summary: `Claim asserted: ${prop.slice(0, 40)}`,
        detail: prop,
      })

      semanticEvents.push({
        id: part.id,
        type: "claim",
        icon: "◆",
        title: `Supported claim: ${prop}`,
        detail: `Revision ${rev} · Scope: ${scope}`,
        protocolDetail: { claimId, proposition: prop, evidence, scope, revision: rev },
      })
    } else if (part.tool === "request_verification") {
      revisionCounter += 1
      const rev = `r${revisionCounter}`
      latestVerificationSeq = ++eventSequence
      const obId = asString(toolInput.obligation_id) ?? asString(toolInput.target) ?? `ob_${obligationsMap.size + 1}`
      const predicate = asString(toolInput.predicate) ?? obId
      const passed = toolMeta.passed === true || (output.length > 0 && !output.toLowerCase().includes("fail"))
      const receiptId = asString(toolMeta.receiptId) ?? asString(toolMeta.receipt_id) ?? `rcpt_${Date.now().toString(36)}`
      const report = parseTestReport(output)

      testResultsList.push({
        name: predicate,
        passed: report.passed,
        failed: report.failed,
        skipped: report.skipped,
        status: passed ? "passed" : "failed",
        rawStdout: output,
      })

      // Update obligation
      obligationsMap.set(obId, {
        id: obId,
        description: predicate,
        status: passed ? "passed" : "failed",
        required: true,
        receiptId,
        diagnostics: passed ? undefined : asString(toolMeta.diagnostics) ?? "Verification test failed",
      })

      historyList.push({
        revision: rev,
        summary: `${predicate} ${passed ? "VERIFIED" : "FAILED"}`,
        detail: `Receipt: ${receiptId}`,
      })

      semanticEvents.push({
        id: part.id,
        type: passed ? "test_passed" : "test_failed",
        icon: passed ? "✓" : "✗",
        title: passed ? `${predicate} passed` : `${predicate} failed`,
        detail: passed ? `${report.passed} passed` : `${report.failed} failed`,
        protocolDetail: { predicate, passed, receiptId, obligationId: obId, revision: rev },
      })
    } else if (part.tool === "request_completion") {
      const rawObligations = toolMeta.obligations ?? toolInput.obligations
      if (Array.isArray(rawObligations)) {
        for (const item of rawObligations) {
          const desc = typeof item === "string" ? item : asString(asRecord(item)?.description) ?? JSON.stringify(item)
          const id = typeof item === "object" && item && "id" in item ? String(item.id) : `ob_${obligationsMap.size + 1}`
          if (!obligationsMap.has(id)) {
            obligationsMap.set(id, {
              id,
              description: desc,
              status: "pending",
              required: true,
            })
          }
        }
      }
    } else if (part.tool === "bash") {
      const cmd = asString(toolInput.command) ?? ""
      if (cmd.includes("test") || cmd.includes("cargo") || cmd.includes("pytest") || cmd.includes("bun")) {
        const report = parseTestReport(output)
        if (report.passed > 0 || report.failed > 0) {
          const passed = report.failed === 0 && report.passed > 0
          testResultsList.push({
            name: cmd.split(" ").slice(0, 3).join(" "),
            passed: report.passed,
            failed: report.failed,
            skipped: report.skipped,
            status: passed ? "passed" : "failed",
            rawStdout: output,
          })
          semanticEvents.push({
            id: part.id,
            type: passed ? "test_passed" : "test_failed",
            icon: passed ? "✓" : "✗",
            title: passed ? "Unit tests passed" : "Unit tests failed",
            detail: `${report.passed} passed · ${report.failed} failed`,
          })
        }
      }
    }
  }

  // 3. Evaluate Dirty and Outdated states based on file edits
  for (const [id, claim] of claimsMap) {
    // If proposition references any edited file, mark dirty
    for (const edited of editedFilePaths) {
      const base = edited.split("/").pop() ?? edited
      if (claim.proposition.includes(base) || claim.scope?.includes(base)) {
        claimsMap.set(id, {
          ...claim,
          status: "dirty",
          reason: `source changed at r${revisionCounter}`,
        })
        historyList.push({
          revision: `r${revisionCounter}`,
          summary: `${claim.proposition.slice(0, 30)} became DIRTY`,
          detail: `Affected by changes in ${base}`,
        })
        break
      }
    }
  }

  // Check if verifications are outdated
  if (latestEditSeq > latestVerificationSeq && latestVerificationSeq > 0) {
    for (const [id, ob] of obligationsMap) {
      if (ob.status === "passed") {
        obligationsMap.set(id, {
          ...ob,
          status: "outdated",
          diagnostics: "Verification predates latest edit",
        })
      }
    }
  }

  // 4. Default / Metadata Overrides for Hard State, Workspace, Memory
  const metaHardClaims = Array.isArray(metaRivet?.claims) ? (metaRivet!.claims as any[]) : []
  for (const raw of metaHardClaims) {
    const id = raw.id ?? `claim_${claimsMap.size + 1}`
    claimsMap.set(id, {
      id,
      proposition: raw.proposition ?? raw.claim ?? "",
      status: raw.status ?? "supported",
      sinceRevision: raw.sinceRevision ?? `r${revisionCounter}`,
      validToRevision: raw.validToRevision,
      reason: raw.reason,
      evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String) : [],
      sourceRefs: Array.isArray(raw.sourceRefs) ? raw.sourceRefs.map(String) : [],
      scope: raw.scope,
    })
  }

  const hardStateList = Array.from(claimsMap.values())

  // Workspace
  const metaWorkspace = asRecord(metaRivet?.workspace)
  const hypotheses: string[] = []
  const unknowns: string[] = []
  const plan: string[] = []
  const activeFocus: string[] = []

  if (metaWorkspace) {
    if (Array.isArray(metaWorkspace.hypotheses)) hypotheses.push(...metaWorkspace.hypotheses.map(String))
    if (Array.isArray(metaWorkspace.unknowns)) unknowns.push(...metaWorkspace.unknowns.map(String))
    if (Array.isArray(metaWorkspace.plan)) plan.push(...metaWorkspace.plan.map(String))
    if (Array.isArray(metaWorkspace.activeFocus)) activeFocus.push(...metaWorkspace.activeFocus.map(String))
  }

  const workspace: UiWorkspace = {
    hypotheses,
    unknowns,
    plan,
    candidateActions: Array.isArray(metaWorkspace?.candidateActions)
      ? metaWorkspace.candidateActions.map(String)
      : [],
    activeFocus,
  }

  // Memory
  const memoryList: UiMemoryItem[] = []
  const metaMemory = Array.isArray(metaRivet?.memory) ? (metaRivet!.memory as any[]) : []
  for (const m of metaMemory) {
    memoryList.push({
      id: m.id ?? `mem_${memoryList.length + 1}`,
      kind: m.kind ?? (m.used ? "procedure" : "provisional"),
      summary: m.summary ?? m.content ?? "",
      relevance: m.relevance,
      used: Boolean(m.used),
      whyIgnored: Array.isArray(m.whyIgnored) ? m.whyIgnored.map(String) : undefined,
      details: m.details,
    })
  }

  // Code Frontier
  const metaCode = asRecord(metaRivet?.code)
  const relevantFiles: UiRelevantFile[] = []
  const relatedSymbols: string[] = []
  const relations: UiSymbolRelation[] = []
  const tests: UiTestFile[] = []
  const uncertain: string[] = []

  if (metaCode) {
    if (Array.isArray(metaCode.relevantFiles)) {
      for (const rf of metaCode.relevantFiles) {
        if (typeof rf === "string") relevantFiles.push({ path: rf, starred: true })
        else if (rf && typeof rf === "object") {
          relevantFiles.push({
            path: String(rf.path),
            starred: rf.starred !== false,
            symbols: Array.isArray(rf.symbols) ? rf.symbols.map(String) : undefined,
          })
        }
      }
    }
    if (Array.isArray(metaCode.relatedSymbols)) relatedSymbols.push(...metaCode.relatedSymbols.map(String))
    if (Array.isArray(metaCode.relations)) {
      for (const rel of metaCode.relations) {
        relations.push({
          from: String(rel.from),
          to: String(rel.to),
          relation: String(rel.relation ?? "calls"),
        })
      }
    }
    if (Array.isArray(metaCode.tests)) {
      for (const t of metaCode.tests) {
        if (typeof t === "string") tests.push({ file: t, status: "pending" })
        else if (t && typeof t === "object") {
          tests.push({
            file: String(t.file),
            status: t.status ?? "pending",
            details: t.details,
          })
        }
      }
    }
    if (Array.isArray(metaCode.uncertain)) uncertain.push(...metaCode.uncertain.map(String))
  } else {
    // Derive from changed/edited files
    for (const file of editedFilePaths) {
      if (file.includes("test") || file.endsWith(".spec.ts")) {
        tests.push({ file, status: "pending" })
      } else {
        relevantFiles.push({ path: file, starred: true })
      }
    }
  }

  // Obligations
  const metaObligations = Array.isArray(metaRivet?.obligations) ? (metaRivet!.obligations as any[]) : []
  for (const o of metaObligations) {
    const id = o.id ?? `ob_${obligationsMap.size + 1}`
    obligationsMap.set(id, {
      id,
      description: o.description ?? o.name ?? "",
      status: o.status ?? "pending",
      required: o.required !== false,
      diagnostics: o.diagnostics,
    })
  }

  const obligationsList = Array.from(obligationsMap.values())

  // Completion state calculation
  const openCount = obligationsList.filter((o) => o.required && o.status !== "passed").length
  const outdatedCount = obligationsList.filter((o) => o.status === "outdated").length

  let completionStatus: UiCompletionState["status"] = "ready"
  let completionMessage = "All required obligations satisfied"

  if (obligationsList.length === 0) {
    completionStatus = "ready"
    completionMessage = "No pending obligations registered"
  } else if (outdatedCount > 0) {
    completionStatus = "outdated"
    completionMessage = "Verification predates latest edit"
  } else if (openCount > 0) {
    completionStatus = "blocked"
    completionMessage = `${openCount} required verification${openCount !== 1 ? "s" : ""} remain${openCount === 1 ? "s" : ""}`
  }

  const completion: UiCompletionState = {
    status: completionStatus,
    message: completionMessage,
    remainingCount: openCount,
  }

  // Infer phase
  let phase: UiTaskPhase = "idle"
  if (input.sessionStatus === "busy") {
    if (toolParts.some((p) => p.state.status === "running" && (p.tool === "request_verification" || p.tool === "bash"))) {
      phase = "verifying"
    } else if (toolParts.some((p) => p.state.status === "running" && (p.tool === "edit" || p.tool === "write" || p.tool === "apply_patch"))) {
      phase = "implementing"
    } else {
      phase = "implementing"
    }
  } else if (asString(metaRivet?.phase)) {
    phase = metaRivet!.phase as UiTaskPhase
  } else if (openCount > 0) {
    phase = "implementing"
  }

  // Status rail
  const statusRail: UiRivetStatus = {
    revision: `r${revisionCounter}`,
    phase,
    taskCount: obligationsList.length,
    changedFileCount: changedFiles.length > 0 ? changedFiles.length : editedFilePaths.size,
    verifyStatus: completionStatus === "ready" ? "ready" : completionStatus === "outdated" ? "outdated" : "blocked",
  }

  const projectedChangedFiles: UiChangedFile[] = []
  for (const cf of changedFiles) {
    projectedChangedFiles.push({
      file: cf.file,
      additions: cf.additions,
      deletions: cf.deletions,
      status: cf.status ?? "modified",
    })
  }
  for (const edited of editedFilePaths) {
    if (!projectedChangedFiles.some((f) => f.file === edited)) {
      projectedChangedFiles.push({
        file: edited,
        additions: 0,
        deletions: 0,
        status: "modified",
      })
    }
  }

  return {
    goal,
    revision: `r${revisionCounter}`,
    phase,
    hardState: hardStateList,
    workspace,
    memory: memoryList,
    code: {
      relevantFiles,
      relatedSymbols,
      relations,
      tests,
      uncertain,
    },
    changedFiles: projectedChangedFiles,
    obligations: obligationsList,
    testResults: testResultsList,
    completion,
    history: historyList.reverse(),
    statusRail,
    semanticEvents,
  }
}

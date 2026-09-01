import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { rootFromRecords } from "./merkle"

export const LEDGER_SCHEMA = "praxis-ledger/v1"
const HEADER_LINE_PREFIX = "# "

export interface LedgerRecord {
  readonly recordId: string
  readonly capturedAt: string
  readonly payload: Record<string, unknown>
}

export interface LedgerHeader {
  readonly schema: string
  readonly candidateId: string
  readonly createdAt: string
  merkleRoot: string
}

export interface LedgerState {
  readonly header: LedgerHeader
  readonly records: LedgerRecord[]
  merkleRoot: string
}

export class Ledger {
  private path: string
  private state: LedgerState

  private constructor(path: string, state: LedgerState) {
    this.path = path
    this.state = state
  }

  static open(path: string, candidateId: string): Ledger {
    if (!existsSync(path)) {
      const initialRoot = rootFromRecords([]).toString("hex")
      const header: LedgerHeader = {
        schema: LEDGER_SCHEMA,
        candidateId,
        createdAt: new Date().toISOString(),
        merkleRoot: initialRoot,
      }
      const state: LedgerState = {
        header,
        records: [],
        merkleRoot: initialRoot,
      }
      const ledger = new Ledger(path, state)
      ledger.persistAll()
      return ledger
    }

    const raw = readFileSync(path, "utf8")
    const state = Ledger.parseOrThrow(raw, candidateId)
    return new Ledger(path, state)
  }

  static openReadOnly(path: string, candidateId: string): Ledger {
    const raw = readFileSync(path, "utf8")
    const state = Ledger.parseOrThrow(raw, candidateId)
    return new Ledger(path, state)
  }

  current(): LedgerState {
    return this.state
  }

  append(record: LedgerRecord): { index: number; merkleRoot: string } {
    if (this.state.records.some((r) => r.recordId === record.recordId)) {
      throw new Error(`Duplicate recordId: ${record.recordId}`)
    }

    this.state.records.push(record)
    const root = this.computeMerkleRoot()
    this.state.merkleRoot = root
    this.state.header.merkleRoot = root
    this.persistAll()
    return { index: this.state.records.length - 1, merkleRoot: root }
  }

  appendIdempotent(
    record: LedgerRecord
  ): { index: number; merkleRoot: string; isDuplicate: boolean } {
    const existingIndex = this.state.records.findIndex((r) => r.recordId === record.recordId)
    if (existingIndex >= 0) {
      return {
        index: existingIndex,
        merkleRoot: this.state.merkleRoot,
        isDuplicate: true,
      }
    }
    const { index, merkleRoot } = this.append(record)
    return { index, merkleRoot, isDuplicate: false }
  }

  verifyIntegrity(): boolean {
    const computed = this.computeMerkleRoot()
    if (this.state.header.merkleRoot !== computed) {
      throw new Error(
        `Header merkle root mismatch: header=${this.state.header.merkleRoot} computed=${computed}`
      )
    }
    if (this.state.merkleRoot !== computed) {
      throw new Error(
        `State merkle root mismatch: state=${this.state.merkleRoot} computed=${computed}`
      )
    }
    return true
  }

  private computeMerkleRoot(): string {
    const byteRecords = this.state.records.map((r) => JSON.stringify(r))
    return rootFromRecords(byteRecords).toString("hex")
  }

  private persistAll(): void {
    const dir = dirname(this.path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const lines: string[] = []
    lines.push(`${HEADER_LINE_PREFIX}${JSON.stringify(this.state.header)}`)
    for (const r of this.state.records) {
      lines.push(JSON.stringify(r))
    }

    const data = lines.join("\n") + "\n"
    const stagingPath = `${this.path}.staging.${process.pid}.${Date.now()}`
    writeFileSync(stagingPath, data, "utf8")
    renameSync(stagingPath, this.path)
  }

  private static parseOrThrow(raw: string, expectedCandidateId: string): LedgerState {
    const lines = raw.split(/\r?\n/)
    if (lines.length === 0 || !lines[0].startsWith(HEADER_LINE_PREFIX)) {
      throw new Error("Missing schema header line in ledger")
    }

    const headerStr = lines[0].slice(HEADER_LINE_PREFIX.length)
    const header: LedgerHeader = JSON.parse(headerStr)

    if (header.schema !== LEDGER_SCHEMA) {
      throw new Error(`Unsupported schema: ${header.schema}`)
    }
    if (header.candidateId !== expectedCandidateId) {
      throw new Error(
        `candidateId mismatch: file=${header.candidateId} expected=${expectedCandidateId}`
      )
    }

    const records: LedgerRecord[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        records.push(JSON.parse(line))
      } catch {
        // Crash recovery: truncate at first broken line
        break
      }
    }

    const byteRecords = records.map((r) => JSON.stringify(r))
    const merkleRoot = rootFromRecords(byteRecords).toString("hex")

    return {
      header,
      records,
      merkleRoot,
    }
  }
}

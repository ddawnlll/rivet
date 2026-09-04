import path from "path"
import fs from "fs"
import type { FlightSpan } from "./types"

export interface TracePersistenceConfig {
  readonly traceDirectory?: string
  readonly maxWalSizeBytes?: number
  readonly maxSessionsRetained?: number
}

export class FlightRecorderPersistence {
  private static defaultTraceDir = path.join(process.cwd(), ".rivet", "traces")
  private static buffer: FlightSpan[] = []
  private static flushScheduled = false

  static getTraceDir(customDir?: string): string {
    const dir = customDir ?? this.defaultTraceDir
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  static appendSpan(span: FlightSpan, config?: TracePersistenceConfig): void {
    this.buffer.push(span)
    if (!this.flushScheduled) {
      this.flushScheduled = true
      // Queue microtask or brief debounce for batch append
      queueMicrotask(() => this.flush(config))
    }
  }

  static async flush(config?: TracePersistenceConfig): Promise<void> {
    this.flushScheduled = false
    if (this.buffer.length === 0) return

    const toWrite = this.buffer
    this.buffer = []

    const dir = this.getTraceDir(config?.traceDirectory)
    const grouped = new Map<string, FlightSpan[]>()

    toWrite.forEach((span) => {
      const key = span.sessionId ?? "global"
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(span)
    })

    const writePromises = Array.from(grouped.entries()).map(async ([sessionId, spans]) => {
      const filePath = path.join(dir, sessionId + ".wal")
      const lines = spans.map((s) => JSON.stringify(s)).join("\n") + "\n"
      await Bun.write(filePath, lines, { createPath: true })
    })

    await Promise.all(writePromises)
  }

  static async loadSessionSpans(sessionId: string, traceDir?: string): Promise<FlightSpan[]> {
    const dir = this.getTraceDir(traceDir)
    const filePath = path.join(dir, sessionId + ".wal")
    const file = Bun.file(filePath)
    if (!(await file.exists())) return []

    const text = await file.text()
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as FlightSpan]
        } catch {
          return []
        }
      })
  }

  static async listSessions(traceDir?: string): Promise<string[]> {
    const dir = this.getTraceDir(traceDir)
    if (!fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir)
    return files
      .filter((f) => f.endsWith(".wal"))
      .map((f) => f.replace(/\.wal$/, ""))
  }
}

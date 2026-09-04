/**
 * Runtime provenance — git branch, commit SHA, dirty state, PID, start time.
 * Resolved once at module load and cached. Failures are swallowed silently so
 * the TUI never crashes due to missing git metadata.
 */

export interface RuntimeProvenance {
  readonly gitBranch: string
  readonly gitSha: string
  readonly isDirty: boolean
  readonly pid: number
  readonly processStartTime: string
}

async function readProvenance(): Promise<RuntimeProvenance> {
  const run = async (cmd: string[]): Promise<string> => {
    const proc = Bun.spawn(cmd, { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" })
    const text = await new Response(proc.stdout).text()
    return text.trim()
  }

  const [branch, sha, status] = await Promise.all([
    run(["git", "branch", "--show-current"]).catch(() => "unknown"),
    run(["git", "rev-parse", "--short", "HEAD"]).catch(() => "unknown"),
    run(["git", "status", "--porcelain"]).catch(() => ""),
  ])

  return {
    gitBranch: branch || "unknown",
    gitSha: sha || "unknown",
    isDirty: status.length > 0,
    pid: process.pid,
    processStartTime: new Date().toISOString(),
  }
}

// Eagerly kick off the read; callers await the same promise.
const _promise = readProvenance().catch(
  (): RuntimeProvenance => ({
    gitBranch: "unknown",
    gitSha: "unknown",
    isDirty: false,
    pid: process.pid,
    processStartTime: new Date().toISOString(),
  }),
)

let _cached: RuntimeProvenance | undefined

_promise.then((p) => {
  _cached = p
})

/** Synchronous best-effort accessor — returns the cached value once resolved, or defaults. */
export function getProvenance(): RuntimeProvenance {
  return (
    _cached ?? {
      gitBranch: "…",
      gitSha: "…",
      isDirty: false,
      pid: process.pid,
      processStartTime: new Date().toISOString(),
    }
  )
}

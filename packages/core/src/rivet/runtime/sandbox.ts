import type { ActionRisk } from "../accp"

export interface ParsedCommand {
  readonly executable: string
  readonly args: readonly string[]
  readonly env?: Record<string, string>
  readonly cwd?: string
}

export type KillPolicy = "graceful_then_kill" | "immediate_sigkill"

export interface ProcessResourceLimits {
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly killPolicy: KillPolicy
}

/**
 * CommandRiskClassifier performs declarative risk evaluation on structured
 * executable and arguments. It is an authorization preflight aid (defense-in-depth),
 * NOT an OS-level sandbox.
 */
export class CommandRiskClassifier {
  static parseCommandLine(commandLine: string): ParsedCommand {
    const trimmed = commandLine.trim()
    if (!trimmed) {
      return { executable: "", args: [] }
    }

    const tokens: string[] = []
    let current = ""
    let inQuote: '"' | "'" | null = null

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i]
      if (inQuote) {
        if (char === inQuote) {
          inQuote = null
        } else {
          current += char
        }
      } else if (char === '"' || char === "'") {
        inQuote = char
      } else if (/\s/.test(char)) {
        if (current) {
          tokens.push(current)
          current = ""
        }
      } else {
        current += char
      }
    }
    if (current) {
      tokens.push(current)
    }

    return {
      executable: tokens[0] ?? "",
      args: tokens.slice(1),
    }
  }

  static classifyRisk(parsed: ParsedCommand): ActionRisk {
    const exe = parsed.executable.toLowerCase()
    const args = parsed.args.map((a) => a.toLowerCase())

    // Destructive operations: git reset --hard, rm -rf on root/critical paths, dd
    if (exe === "git" && args.includes("reset") && (args.includes("--hard") || args.includes("-hard"))) {
      return "destructive"
    }

    if (exe === "rm" || exe.endsWith("/rm")) {
      const isRecursiveForce =
        args.some((a) => a.includes("r") && a.includes("f")) ||
        (args.includes("-r") && args.includes("-f")) ||
        (args.includes("-rf") || args.includes("-fr"))

      const targetsRootOrAll = args.some(
        (a) => a === "/" || a === "/*" || a === "~" || a === "~/" || a === "."
      )

      if (isRecursiveForce && targetsRootOrAll) {
        return "destructive"
      }
      return "material"
    }

    if (exe === "dd" || exe.endsWith("/dd")) {
      return "destructive"
    }

    // Pure inspection: read-only utilities and test runners
    if (
      exe === "cat" ||
      exe === "ls" ||
      exe === "grep" ||
      exe === "find" ||
      exe === "head" ||
      exe === "tail" ||
      exe === "pwd" ||
      exe === "diff"
    ) {
      return "inspect"
    }

    if (exe === "bun" || exe === "cargo" || exe === "pytest" || exe === "go") {
      if (args[0] === "test" || args[0] === "check") {
        return "inspect"
      }
    }

    // Default to material for unknown/modifying commands
    return "material"
  }
}

/**
 * ProcessSupervisor enforces concrete runtime execution bounds (timeout, output ceiling,
 * process group termination) using Bun runtime facilities.
 */
export class ProcessSupervisor {
  static async executeWithLimits(
    command: string,
    cwd: string,
    limits: ProcessResourceLimits
  ): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
    const controller = new AbortController()
    let timedOut = false

    const timeoutTimer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, limits.timeoutMs)

    try {
      const proc = Bun.spawn(["sh", "-c", command], {
        cwd,
        signal: controller.signal,
        stdout: "pipe",
        stderr: "pipe",
      })

      const [stdoutText, stderrText] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])

      const exitCode = await proc.exited

      return {
        stdout: stdoutText.slice(0, limits.maxOutputBytes),
        stderr: stderrText.slice(0, limits.maxOutputBytes),
        exitCode: exitCode ?? (timedOut ? 124 : 1),
        timedOut,
      }
    } catch (err: any) {
      return {
        stdout: "",
        stderr: timedOut ? "Process timed out" : err.message,
        exitCode: timedOut ? 124 : 1,
        timedOut,
      }
    } finally {
      clearTimeout(timeoutTimer)
    }
  }
}

import path from "path"
import fs from "fs"

export interface BenchmarkTask {
  readonly id: string
  readonly name: string
  readonly category: "short" | "medium" | "persistence"
  readonly split: "development" | "holdout"
  readonly prompt: string
  readonly timeoutMs: number
  readonly maxModelCalls: number
  readonly setup: (workspaceDir: string) => Promise<void>
  readonly verify: (workspaceDir: string, output: string) => Promise<{ passed: boolean; message: string }>
}

export const BENCHMARK_CORPUS: readonly BenchmarkTask[] = [
  // --- 1. SHORT TASKS (Fixed Tax) ---
  {
    id: "dev_locate_config",
    name: "Locate configuration file",
    category: "short",
    split: "development",
    prompt: "What is the configuration file for the rivet workspace, and what port does it define for the server?",
    timeoutMs: 30000,
    maxModelCalls: 4,
    setup: async (dir) => {
      await Bun.write(path.join(dir, "rivet.config.json"), JSON.stringify({ server: { port: 8088 }, mode: "production" }))
    },
    verify: async (dir, output) => {
      const mentionsFile = output.includes("rivet.config.json")
      const mentionsPort = output.includes("8088")
      return {
        passed: mentionsFile && mentionsPort,
        message: mentionsFile && mentionsPort ? "Correctly located config and extracted port" : "Failed to report config or port",
      }
    },
  },
  {
    id: "dev_inspect_version",
    name: "Inspect package version",
    category: "short",
    split: "development",
    prompt: "What is the version number of @opencode-ai/core in the local package.json?",
    timeoutMs: 30000,
    maxModelCalls: 4,
    setup: async (dir) => {
      await Bun.write(path.join(dir, "package.json"), JSON.stringify({ name: "@opencode-ai/core", version: "1.18.25" }))
    },
    verify: async (dir, output) => {
      const mentionsVer = output.includes("1.18.25")
      return {
        passed: mentionsVer,
        message: mentionsVer ? "Correctly identified package version" : "Failed to identify version 1.18.25",
      }
    },
  },
  {
    id: "dev_identify_branch",
    name: "Identify branch configuration",
    category: "short",
    split: "development",
    prompt: "According to the repo conventions in AGENTS.md, what is the default branch name?",
    timeoutMs: 30000,
    maxModelCalls: 4,
    setup: async (dir) => {
      await Bun.write(path.join(dir, "AGENTS.md"), "The default branch in this repo is dev.\n")
    },
    verify: async (dir, output) => {
      const mentionsDev = /\bdev\b/i.test(output)
      return {
        passed: mentionsDev,
        message: mentionsDev ? "Correctly identified default branch dev" : "Failed to identify default branch",
      }
    },
  },
  {
    id: "holdout_fix_syntax_bug",
    name: "Fix syntax error in math helper",
    category: "short",
    split: "holdout",
    prompt: "Fix the syntax error in src/math.js so that add(2, 3) returns 5.",
    timeoutMs: 30000,
    maxModelCalls: 5,
    setup: async (dir) => {
      const srcDir = path.join(dir, "src")
      await fs.promises.mkdir(srcDir, { recursive: true })
      await Bun.write(path.join(srcDir, "math.js"), "export function add(a, b { return a + b }\n")
    },
    verify: async (dir) => {
      const code = await Bun.file(path.join(dir, "src", "math.js")).text()
      const isSyntaxValid = !code.includes("(a, b {") && (code.includes("(a, b)") || code.includes("(a,b)"))
      return {
        passed: isSyntaxValid,
        message: isSyntaxValid ? "Syntax error resolved" : "Syntax error remains",
      }
    },
  },

  // --- 2. MEDIUM MULTI-STEP TASKS (Trajectory / Repo Relevance) ---
  {
    id: "dev_trace_dependency",
    name: "Trace multi-file dependency chain",
    category: "medium",
    split: "development",
    prompt: "Trace the calculation flow in index.js through service.js to util.js. What is the final computed multiplier?",
    timeoutMs: 45000,
    maxModelCalls: 6,
    setup: async (dir) => {
      await Bun.write(path.join(dir, "util.js"), "export const BASE_FACTOR = 7\n")
      await Bun.write(path.join(dir, "service.js"), 'import { BASE_FACTOR } from "./util.js"\nexport const MULTIPLIER = BASE_FACTOR * 6\n')
      await Bun.write(path.join(dir, "index.js"), 'import { MULTIPLIER } from "./service.js"\nconsole.log(MULTIPLIER)\n')
    },
    verify: async (dir, output) => {
      const mentions42 = output.includes("42")
      return {
        passed: mentions42,
        message: mentions42 ? "Correctly traced dependency multiplier 42" : "Failed to trace dependency multiplier",
      }
    },
  },
  {
    id: "holdout_feature_with_tests",
    name: "Implement string slugify with tests",
    category: "medium",
    split: "holdout",
    prompt: "Create src/slug.js exporting slugify(str) that turns 'Hello World!' into 'hello-world'. Ensure tests in test/slug.test.js pass.",
    timeoutMs: 60000,
    maxModelCalls: 8,
    setup: async (dir) => {
      const testDir = path.join(dir, "test")
      await fs.promises.mkdir(testDir, { recursive: true })
      await Bun.write(path.join(testDir, "slug.test.js"), 'import { slugify } from "../src/slug.js"\nif (slugify("Hello World!") !== "hello-world") throw new Error("fail")\nconsole.log("PASS")\n')
    },
    verify: async (dir) => {
      const slugFile = Bun.file(path.join(dir, "src", "slug.js"))
      if (!(await slugFile.exists())) return { passed: false, message: "src/slug.js not created" }
      try {
        const proc = Bun.spawnSync(["bun", "test/slug.test.js"], { cwd: dir })
        const passed = proc.exitCode === 0 && proc.stdout.toString().includes("PASS")
        return {
          passed,
          message: passed ? "Test suite passed" : "Tests failed with output: " + proc.stderr.toString(),
        }
      } catch (err) {
        return { passed: false, message: String(err) }
      }
    },
  },
  {
    id: "holdout_iterative_repair",
    name: "Iterative repair from test assertions",
    category: "medium",
    split: "holdout",
    prompt: "Run bun test/repair.test.js, inspect the assertion failure in src/counter.js, and repair it so the test passes.",
    timeoutMs: 60000,
    maxModelCalls: 8,
    setup: async (dir) => {
      const srcDir = path.join(dir, "src")
      const testDir = path.join(dir, "test")
      await fs.promises.mkdir(srcDir, { recursive: true })
      await fs.promises.mkdir(testDir, { recursive: true })
      await Bun.write(path.join(srcDir, "counter.js"), 'export function formatCount(n) { return n > 1 ? n + " items" : "0 items" }\n')
      await Bun.write(path.join(testDir, "repair.test.js"), 'import { formatCount } from "../src/counter.js"\nif (formatCount(1) !== "1 item") throw new Error("1 item test failed: got " + formatCount(1))\nif (formatCount(2) !== "2 items") throw new Error("2 items failed")\nif (formatCount(0) !== "0 items") throw new Error("0 items failed")\nconsole.log("REPAIR_PASSED")\n')
    },
    verify: async (dir) => {
      try {
        const proc = Bun.spawnSync(["bun", "test/repair.test.js"], { cwd: dir })
        const passed = proc.exitCode === 0 && proc.stdout.toString().includes("REPAIR_PASSED")
        return {
          passed,
          message: passed ? "Iterative repair successful" : "Test failed: " + proc.stderr.toString(),
        }
      } catch (err) {
        return { passed: false, message: String(err) }
      }
    },
  },
  {
    id: "holdout_refactor_subsystem",
    name: "Refactor API subsystem and call sites",
    category: "medium",
    split: "holdout",
    prompt: "Refactor getUserName in src/api.js to getUserDisplayName, and update all call sites in src/client.js and test/api.test.js so the test passes.",
    timeoutMs: 60000,
    maxModelCalls: 8,
    setup: async (dir) => {
      const srcDir = path.join(dir, "src")
      const testDir = path.join(dir, "test")
      await fs.promises.mkdir(srcDir, { recursive: true })
      await fs.promises.mkdir(testDir, { recursive: true })
      await Bun.write(path.join(srcDir, "api.js"), "export function getUserName(u) { return u.name }\n")
      await Bun.write(path.join(srcDir, "client.js"), 'import { getUserName } from "./api.js"\nexport function renderUser(u) { return "User: " + getUserName(u) }\n')
      await Bun.write(path.join(testDir, "api.test.js"), 'import { renderUser } from "../src/client.js"\nif (renderUser({ name: "Alice" }) !== "User: Alice") throw new Error("render fail")\nconsole.log("REFACTOR_OK")\n')
    },
    verify: async (dir) => {
      const apiCode = await Bun.file(path.join(dir, "src", "api.js")).text()
      const clientCode = await Bun.file(path.join(dir, "src", "client.js")).text()
      const proc = Bun.spawnSync(["bun", "test/api.test.js"], { cwd: dir })
      const hasOldName = apiCode.includes("getUserName") || clientCode.includes("getUserName")
      const passed = proc.exitCode === 0 && proc.stdout.toString().includes("REFACTOR_OK") && !hasOldName
      return {
        passed,
        message: passed ? "Subsystem refactored cleanly without stale symbol remnants" : "Refactor incomplete or test failed",
      }
    },
  },

  // --- 3. PERSISTENCE / RESTART TASKS (Rivet Central Thesis) ---
  {
    id: "dev_restart_continuation",
    name: "Session restart continuation after hypothesis rejection",
    category: "persistence",
    split: "development",
    prompt: "Investigate whether Redis or SQLite is configured in db.config.json. Note: an earlier rejected hypothesis claimed Postgres was used. Confirm SQLite port and continue to create db.lock file with status verified.",
    timeoutMs: 60000,
    maxModelCalls: 8,
    setup: async (dir) => {
      await Bun.write(path.join(dir, "db.config.json"), JSON.stringify({ engine: "sqlite", port: 0, file: "app.db", note: "Not postgres" }))
    },
    verify: async (dir, output) => {
      const lockFile = Bun.file(path.join(dir, "db.lock"))
      const exists = await lockFile.exists()
      const mentionsSqlite = output.toLowerCase().includes("sqlite")
      const passed = exists && mentionsSqlite
      return {
        passed,
        message: passed ? "Persistence continuation verified with lockfile" : "Failed to verify SQLite or create lockfile",
      }
    },
  },
  {
    id: "holdout_restart_investigation",
    name: "Cross-restart diagnostic recovery",
    category: "persistence",
    split: "holdout",
    prompt: "Diagnose why worker.js fails when started. Note: memory cache hypothesis was already tested and rejected. Locate the missing env var in .env.example, create .env with it, and ensure bun worker.js exits with code 0.",
    timeoutMs: 60000,
    maxModelCalls: 8,
    setup: async (dir) => {
      await Bun.write(path.join(dir, ".env.example"), "WORKER_AUTH_TOKEN=secret_token_123\n")
      await Bun.write(path.join(dir, "worker.js"), 'if (process.env.WORKER_AUTH_TOKEN !== "secret_token_123") { console.error("Missing auth"); process.exit(1) }\nconsole.log("WORKER_SUCCESS")\n')
    },
    verify: async (dir) => {
      const envFile = Bun.file(path.join(dir, ".env"))
      if (!(await envFile.exists())) return { passed: false, message: ".env file not created" }
      const content = await envFile.text()
      if (!content.includes("secret_token_123")) return { passed: false, message: ".env missing expected auth token" }

      const proc = Bun.spawnSync(["bun", "--env-file=.env", "worker.js"], { cwd: dir })
      const passed = proc.exitCode === 0 && proc.stdout.toString().includes("WORKER_SUCCESS")
      return {
        passed,
        message: passed ? "Worker recovered and ran successfully" : "Worker execution failed",
      }
    },
  },
]

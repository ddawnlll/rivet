import { Config } from "effect"

export function env(key: string): string | undefined {
  return process.env[`RIVET_${key}`] ?? process.env[`OPENCODE_${key}`]
}

export function truthy(key: string) {
  const value = (process.env[`RIVET_${key}`] ?? process.env[`OPENCODE_${key}`] ?? process.env[key])?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["RIVET_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"] ?? process.env["OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["RIVET_DISABLE_FFF"] ?? process.env["OPENCODE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  const specific = process.env[`RIVET_${key}`] ?? process.env[`OPENCODE_${key}`] ?? process.env[key]
  return specific === undefined
    ? truthy("EXPERIMENTAL") || truthy("RIVET_EXPERIMENTAL") || truthy("OPENCODE_EXPERIMENTAL")
    : specific.toLowerCase() === "true" || specific === "1"
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  RIVET_AUTO_HEAP_SNAPSHOT: truthy("AUTO_HEAP_SNAPSHOT"),
  OPENCODE_AUTO_HEAP_SNAPSHOT: truthy("AUTO_HEAP_SNAPSHOT"),
  RIVET_GIT_BASH_PATH: env("GIT_BASH_PATH"),
  OPENCODE_GIT_BASH_PATH: env("GIT_BASH_PATH"),
  RIVET_CONFIG: env("CONFIG"),
  OPENCODE_CONFIG: env("CONFIG"),
  RIVET_CONFIG_CONTENT: env("CONFIG_CONTENT"),
  OPENCODE_CONFIG_CONTENT: env("CONFIG_CONTENT"),
  RIVET_DISABLE_AUTOUPDATE: truthy("DISABLE_AUTOUPDATE"),
  OPENCODE_DISABLE_AUTOUPDATE: truthy("DISABLE_AUTOUPDATE"),
  RIVET_ALWAYS_NOTIFY_UPDATE: truthy("ALWAYS_NOTIFY_UPDATE"),
  OPENCODE_ALWAYS_NOTIFY_UPDATE: truthy("ALWAYS_NOTIFY_UPDATE"),
  RIVET_DISABLE_PRUNE: truthy("DISABLE_PRUNE"),
  OPENCODE_DISABLE_PRUNE: truthy("DISABLE_PRUNE"),
  RIVET_DISABLE_TERMINAL_TITLE: truthy("DISABLE_TERMINAL_TITLE"),
  OPENCODE_DISABLE_TERMINAL_TITLE: truthy("DISABLE_TERMINAL_TITLE"),
  RIVET_SHOW_TTFD: truthy("SHOW_TTFD"),
  OPENCODE_SHOW_TTFD: truthy("SHOW_TTFD"),
  RIVET_DISABLE_AUTOCOMPACT: truthy("DISABLE_AUTOCOMPACT"),
  OPENCODE_DISABLE_AUTOCOMPACT: truthy("DISABLE_AUTOCOMPACT"),
  RIVET_DISABLE_MODELS_FETCH: truthy("DISABLE_MODELS_FETCH"),
  OPENCODE_DISABLE_MODELS_FETCH: truthy("DISABLE_MODELS_FETCH"),
  RIVET_DISABLE_MOUSE: truthy("DISABLE_MOUSE"),
  OPENCODE_DISABLE_MOUSE: truthy("DISABLE_MOUSE"),
  RIVET_FAKE_VCS: env("FAKE_VCS"),
  OPENCODE_FAKE_VCS: env("FAKE_VCS"),
  RIVET_SERVER_PASSWORD: env("SERVER_PASSWORD"),
  OPENCODE_SERVER_PASSWORD: env("SERVER_PASSWORD"),
  RIVET_SERVER_USERNAME: env("SERVER_USERNAME"),
  OPENCODE_SERVER_USERNAME: env("SERVER_USERNAME"),
  RIVET_DISABLE_FFF: fff === undefined ? process.platform === "win32" : fff.toLowerCase() === "true" || fff === "1",
  OPENCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : fff.toLowerCase() === "true" || fff === "1",

  // Experimental
  RIVET_EXPERIMENTAL_FILEWATCHER: Config.boolean("RIVET_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.orElse(() => Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER")),
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  RIVET_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("RIVET_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.orElse(() => Config.boolean("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER")),
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  RIVET_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : copy.toLowerCase() === "true" || copy === "1",
  OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : copy.toLowerCase() === "true" || copy === "1",
  RIVET_MODELS_URL: env("MODELS_URL"),
  OPENCODE_MODELS_URL: env("MODELS_URL"),
  RIVET_MODELS_PATH: env("MODELS_PATH"),
  OPENCODE_MODELS_PATH: env("MODELS_PATH"),
  RIVET_DB: env("DB"),
  OPENCODE_DB: env("DB"),

  RIVET_WORKSPACE_ID: env("WORKSPACE_ID"),
  OPENCODE_WORKSPACE_ID: env("WORKSPACE_ID"),
  RIVET_EXPERIMENTAL_WORKSPACES:
    enabledByExperimental("EXPERIMENTAL_WORKSPACES") || enabledByExperimental("WORKSPACES"),
  OPENCODE_EXPERIMENTAL_WORKSPACES:
    enabledByExperimental("EXPERIMENTAL_WORKSPACES") || enabledByExperimental("WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get RIVET_DISABLE_PROJECT_CONFIG() {
    return truthy("DISABLE_PROJECT_CONFIG")
  },
  get OPENCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("DISABLE_PROJECT_CONFIG")
  },
  get RIVET_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("EXPERIMENTAL_REFERENCES") || enabledByExperimental("REFERENCES")
  },
  get OPENCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("EXPERIMENTAL_REFERENCES") || enabledByExperimental("REFERENCES")
  },
  get RIVET_TUI_CONFIG() {
    return env("TUI_CONFIG")
  },
  get OPENCODE_TUI_CONFIG() {
    return env("TUI_CONFIG")
  },
  get RIVET_CONFIG_DIR() {
    return env("CONFIG_DIR")
  },
  get OPENCODE_CONFIG_DIR() {
    return env("CONFIG_DIR")
  },
  get RIVET_PURE() {
    return truthy("PURE")
  },
  get OPENCODE_PURE() {
    return truthy("PURE")
  },
  get RIVET_PERMISSION() {
    return env("PERMISSION")
  },
  get OPENCODE_PERMISSION() {
    return env("PERMISSION")
  },
  get RIVET_PLUGIN_META_FILE() {
    return env("PLUGIN_META_FILE")
  },
  get OPENCODE_PLUGIN_META_FILE() {
    return env("PLUGIN_META_FILE")
  },
  get RIVET_CLIENT() {
    return env("CLIENT") ?? "cli"
  },
  get OPENCODE_CLIENT() {
    return env("CLIENT") ?? "cli"
  },
}

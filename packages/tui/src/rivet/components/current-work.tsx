import { createMemo, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useRivet } from "../context"

export function CurrentWork() {
  const rivet = useRivet()
  const { theme } = useTheme()

  const goal = createMemo(() => rivet.goal ?? "No active task goal")
  const phase = createMemo(() => rivet.phase)
  const relevantFiles = createMemo(() => rivet.code.relevantFiles.slice(0, 5))
  const obligations = createMemo(() => rivet.obligations.slice(0, 5))

  const statusLabel = createMemo(() => {
    switch (phase()) {
      case "orientation":
        return "Orientation"
      case "diagnosis":
        return "Diagnosis"
      case "planning":
        return "Planning"
      case "implementing":
        return "Implementing"
      case "verifying":
        return "Verifying"
      case "idle":
      default:
        return "Idle"
    }
  })

  return (
    <box flexDirection="column" gap={1}>
      {/* Title */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          CURRENT WORK
        </text>
      </box>

      {/* Goal */}
      <box flexDirection="column">
        <text fg={theme.textMuted}>Goal</text>
        <text fg={theme.text} wrapMode="word">
          {goal()}
        </text>
      </box>

      {/* Status */}
      <box flexDirection="column">
        <text fg={theme.textMuted}>Status</text>
        <text fg={theme.info} attributes={TextAttributes.BOLD}>
          {statusLabel()}
        </text>
      </box>

      {/* Relevant Code */}
      <Show when={relevantFiles().length > 0}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>Relevant code</text>
          <For each={relevantFiles()}>
            {(file) => (
              <box flexDirection="row" gap={1}>
                <text fg={file.starred ? theme.warning : theme.textMuted}>
                  {file.starred ? "★" : " "}
                </text>
                <text fg={theme.text} wrapMode="none">
                  {file.path.split("/").pop() ?? file.path}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* Tasks / Obligations */}
      <Show when={obligations().length > 0}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>Tasks</text>
          <For each={obligations()}>
            {(task) => {
              const icon =
                task.status === "passed"
                  ? { sym: "✓", fg: theme.success }
                  : task.status === "running"
                    ? { sym: "●", fg: theme.info }
                    : task.status === "outdated"
                      ? { sym: "⚠", fg: theme.warning }
                      : task.status === "failed"
                        ? { sym: "✗", fg: theme.error }
                        : { sym: "○", fg: theme.textMuted }

              return (
                <box flexDirection="row" gap={1}>
                  <text fg={icon.fg}>{icon.sym}</text>
                  <text fg={theme.text} wrapMode="none">
                    {task.description}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>

      {/* Verification State */}
      <box flexDirection="column" marginTop={0}>
        <text fg={theme.textMuted}>Verification</text>
        <Show
          when={rivet.completion.status === "ready"}
          fallback={
            <text
              fg={rivet.completion.status === "outdated" ? theme.warning : theme.error}
              attributes={TextAttributes.BOLD}
            >
              {rivet.completion.status === "outdated"
                ? "⚠ OUTDATED"
                : `⚠ BLOCKED (${rivet.completion.remainingCount} check remaining)`}
            </text>
          }
        >
          <text fg={theme.success} attributes={TextAttributes.BOLD}>
            ✓ READY
          </text>
        </Show>
      </box>
    </box>
  )
}

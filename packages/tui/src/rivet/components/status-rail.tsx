import { createMemo, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useRivet } from "../context"

export interface StatusRailProps {
  onClick?: () => void
}

export function StatusRail(props: StatusRailProps) {
  const rivet = useRivet()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const status = () => rivet.statusRail
  const width = () => dimensions().width

  const phaseShort = createMemo(() => {
    switch (status().phase) {
      case "orientation":
        return "orient"
      case "diagnosis":
        return "diag"
      case "planning":
        return "plan"
      case "implementing":
        return "impl"
      case "verifying":
        return "verify"
      case "idle":
      default:
        return "idle"
    }
  })

  const verifyLabel = createMemo(() => {
    switch (status().verifyStatus) {
      case "ready":
        return { full: "verify ready", short: "V✓", fg: theme.success }
      case "outdated":
        return { full: "verify outdated", short: "V~", fg: theme.warning }
      case "blocked":
        return { full: "verify pending", short: "V!", fg: theme.warning }
      case "pending":
      default:
        return { full: "verify pending", short: "V○", fg: theme.textMuted }
    }
  })

  return (
    <box
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      height={1}
      backgroundColor={theme.backgroundPanel}
      onMouseDown={props.onClick}
      flexShrink={0}
    >
      <Show
        when={width() > 70}
        fallback={
          <box flexDirection="row" gap={1}>
            <text fg={theme.primary}>◆</text>
            <text fg={theme.textMuted}>{status().revision}</text>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.text}>{phaseShort()}</text>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.text}>T{status().taskCount}</text>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.text}>Δ{status().changedFileCount}</text>
            <text fg={theme.textMuted}>·</text>
            <text fg={verifyLabel().fg}>{verifyLabel().short}</text>
          </box>
        }
      >
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            ◆ Rivet
          </text>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.textMuted}>{status().revision}</text>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.text}>{status().phase}</text>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.text}>
            {status().taskCount} task{status().taskCount !== 1 ? "s" : ""}
          </text>
          <text fg={theme.text}>{status().changedFileCount} changed</text>
          <text fg={theme.textMuted}>·</text>
          <text fg={verifyLabel().fg}>{verifyLabel().full}</text>
          <Show when={status().cacheHitRatio !== undefined}>
            <text fg={theme.textMuted}>·</text>
            <text
              fg={
                (status().cacheHitRatio ?? 0) >= 0.8
                  ? theme.success
                  : (status().cacheHitRatio ?? 0) >= 0.5
                    ? theme.warning
                    : theme.error
              }
            >
              Cache {Math.round((status().cacheHitRatio ?? 0) * 100)}%
            </text>
          </Show>
          <Show when={status().recallLatencyMs !== undefined}>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.textMuted}>Recall {Math.round(status().recallLatencyMs!)}ms</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

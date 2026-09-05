import { createMemo, createSignal, createEffect, onCleanup, Show } from "solid-js"
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

  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!status().activeSpan) return
    const timer = setInterval(() => setNow(Date.now()), 200)
    onCleanup(() => clearInterval(timer))
  })

  const elapsedText = createMemo(() => {
    const span = status().activeSpan
    if (!span) return ""
    const diff = Math.max(0, now() - span.startTimestamp)
    return `${(diff / 1000).toFixed(1)}s`
  })

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
            <Show
              when={status().activeSpan !== undefined}
              fallback={
                <>
                  <text fg={theme.text}>{phaseShort()}</text>
                  <text fg={theme.textMuted}>·</text>
                  <text fg={theme.text}>T{status().taskCount}</text>
                  <text fg={theme.textMuted}>·</text>
                  <text fg={theme.text}>Δ{status().changedFileCount}</text>
                  <text fg={theme.textMuted}>·</text>
                  <text fg={verifyLabel().fg}>{verifyLabel().short}</text>
                </>
              }
            >
              <text fg={theme.info} attributes={TextAttributes.BOLD}>
                ◈ {status().activeSpan!.label}
              </text>
              <text fg={theme.textMuted}>{elapsedText()}</text>
            </Show>
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
          <Show when={status().activeSpan !== undefined}>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.info} attributes={TextAttributes.BOLD}>
              ◈ {status().activeSpan!.label}
            </text>
            <text fg={theme.textMuted}>
              · {elapsedText()}
            </text>
          </Show>
          <Show when={status().activeSpan === undefined && status().lastCompletedSpan !== undefined}>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.textMuted}>
              ✓ {status().lastCompletedSpan!.label} · {(status().lastCompletedSpan!.durationMs / 1000).toFixed(2)}s
            </text>
          </Show>
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
        <Show when={width() > 100}>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.textMuted}>
              {status().gitBranch}@{status().gitSha}
              {status().isDirty ? " *" : ""}
            </text>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.textMuted}>pid {status().pid}</text>
          </box>
        </Show>
      </Show>
    </box>
  )
}

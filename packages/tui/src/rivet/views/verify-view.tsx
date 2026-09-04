import { createSignal, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useRoute } from "../../context/route"
import { useRivet } from "../context"
import type { UiObligation, UiTestResult } from "../types"

export interface VerifyViewProps {
  onClose?: () => void
}

export function VerifyView(props: VerifyViewProps) {
  const rivet = useRivet()
  const route = useRoute()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const [selectedObligationId, setSelectedObligationId] = createSignal<string | undefined>()

  const handleClose = () => {
    if (props.onClose) {
      props.onClose()
      return
    }
    const returnRoute = ("data" in route.data && (route.data.data as any)?.returnRoute) || { type: "home" }
    route.navigate(returnRoute)
  }

  const completionBanner = () => {
    const c = rivet.completion
    if (c.status === "ready") {
      return {
        title: "✓ READY",
        subtitle: c.message,
        fg: theme.success,
        bg: theme.backgroundElement,
        borderColor: theme.success,
      }
    }
    if (c.status === "outdated") {
      return {
        title: "⚠ OUTDATED",
        subtitle: c.message,
        fg: theme.warning,
        bg: theme.backgroundElement,
        borderColor: theme.warning,
      }
    }
    return {
      title: "⚠ BLOCKED",
      subtitle: c.message,
      fg: theme.error,
      bg: theme.backgroundElement,
      borderColor: theme.error,
    }
  }

  const obligationIcon = (status: UiObligation["status"]) => {
    switch (status) {
      case "passed":
        return { icon: "✓", fg: theme.success }
      case "running":
        return { icon: "●", fg: theme.info }
      case "outdated":
        return { icon: "⚠", fg: theme.warning }
      case "failed":
        return { icon: "✗", fg: theme.error }
      case "pending":
      default:
        return { icon: "○", fg: theme.textMuted }
    }
  }

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
    >
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" alignItems="center" flexShrink={0}>
        <box flexDirection="row" gap={2} alignItems="center">
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            ◆ VERIFY
          </text>
          <text fg={theme.textMuted}>Praxis obligations & completion state</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>esc to return</text>
        </box>
      </box>

      {/* Main Content Area */}
      <scrollbox flexGrow={1} minHeight={0}>
        <box flexDirection="column" gap={2}>
          {/* Goal */}
          <box flexDirection="column" gap={0}>
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              Goal
            </text>
            <text fg={theme.text}>{rivet.goal ?? "No active task goal defined."}</text>
          </box>

          {/* Completion Status Card */}
          <box
            flexDirection="column"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={completionBanner().bg}
            border={["left"]}
            borderColor={completionBanner().borderColor}
          >
            <text fg={theme.textMuted}>COMPLETION</text>
            <text fg={completionBanner().fg} attributes={TextAttributes.BOLD}>
              {completionBanner().title}
            </text>
            <text fg={theme.text}>{completionBanner().subtitle}</text>
          </box>

          {/* REQUIRED OBLIGATIONS */}
          <box flexDirection="column" gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              REQUIRED
            </text>
            <Show
              when={rivet.obligations.length > 0}
              fallback={
                <box padding={1} backgroundColor={theme.backgroundPanel}>
                  <text fg={theme.textMuted}>No verification requirements have been registered yet.</text>
                </box>
              }
            >
              <box flexDirection="column" gap={1}>
                <For each={rivet.obligations}>
                  {(ob) => {
                    const iconInfo = obligationIcon(ob.status)
                    const isSelected = () => selectedObligationId() === ob.id
                    return (
                      <box
                        flexDirection="column"
                        paddingLeft={2}
                        paddingRight={2}
                        paddingTop={1}
                        paddingBottom={1}
                        backgroundColor={isSelected() ? theme.backgroundElement : theme.backgroundPanel}
                        border={["left"]}
                        borderColor={iconInfo.fg}
                        onMouseDown={() => setSelectedObligationId(isSelected() ? undefined : ob.id)}
                      >
                        <box flexDirection="row" justifyContent="space-between">
                          <box flexDirection="row" gap={1}>
                            <text fg={iconInfo.fg} attributes={TextAttributes.BOLD}>
                              {iconInfo.icon}
                            </text>
                            <text fg={theme.text}>{ob.description}</text>
                          </box>
                          <text fg={theme.textMuted}>{ob.status}</text>
                        </box>

                        <Show when={ob.diagnostics}>
                          <text fg={theme.warning}>{ob.diagnostics}</text>
                        </Show>

                        {/* Expandable details */}
                        <Show when={isSelected() && ob.receiptId}>
                          <box
                            marginTop={1}
                            paddingTop={1}
                            border={["top"]}
                            borderColor={theme.border}
                            flexDirection="column"
                          >
                            <text fg={theme.textMuted}>
                              Receipt ID: <span style={{ fg: theme.text }}>{ob.receiptId}</span>
                            </text>
                            <text fg={theme.textMuted}>
                              Obligation ID: <span style={{ fg: theme.text }}>{ob.id}</span>
                            </text>
                          </box>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
          </box>

          {/* RESULTS */}
          <Show when={rivet.testResults.length > 0}>
            <box flexDirection="column" gap={1}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                RESULTS
              </text>
              <box flexDirection="column" gap={1}>
                <For each={rivet.testResults}>
                  {(result) => (
                    <box
                      flexDirection="column"
                      paddingLeft={2}
                      paddingRight={2}
                      paddingTop={1}
                      paddingBottom={1}
                      backgroundColor={theme.backgroundPanel}
                      border={["left"]}
                      borderColor={result.status === "passed" ? theme.success : theme.error}
                    >
                      <box flexDirection="row" gap={1}>
                        <text fg={result.status === "passed" ? theme.success : theme.error}>
                          {result.status === "passed" ? "✓" : "✗"}
                        </text>
                        <text fg={theme.text} attributes={TextAttributes.BOLD}>
                          {result.name}
                        </text>
                      </box>
                      <text fg={theme.textMuted}>
                        {result.passed} passed · {result.failed} failed
                        {result.skipped ? ` · ${result.skipped} skipped` : ""}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            </box>
          </Show>
        </box>
      </scrollbox>
    </box>
  )
}

import { createSignal, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useRoute } from "../../context/route"
import { useRivet } from "../context"

export interface CodeViewProps {
  onClose?: () => void
}

export function CodeView(props: CodeViewProps) {
  const rivet = useRivet()
  const route = useRoute()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const handleClose = () => {
    if (props.onClose) {
      props.onClose()
      return
    }
    const returnRoute = ("data" in route.data && (route.data.data as any)?.returnRoute) || { type: "home" }
    route.navigate(returnRoute)
  }

  const code = () => rivet.code

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
            ◆ CODE
          </text>
          <text fg={theme.textMuted}>Task-relevant repository context</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>esc to return</text>
        </box>
      </box>

      {/* Main Content Area */}
      <scrollbox flexGrow={1} minHeight={0}>
        <box flexDirection="column" gap={2}>
          {/* Relevant Files */}
          <box flexDirection="column" gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Relevant files
            </text>
            <Show
              when={code().relevantFiles.length > 0}
              fallback={
                <box padding={1} backgroundColor={theme.backgroundPanel}>
                  <text fg={theme.textMuted}>No task-relevant files indexed yet.</text>
                </box>
              }
            >
              <For each={code().relevantFiles}>
                {(file) => (
                  <box
                    flexDirection="column"
                    paddingLeft={2}
                    paddingRight={2}
                    paddingTop={1}
                    paddingBottom={1}
                    backgroundColor={theme.backgroundPanel}
                    border={["left"]}
                    borderColor={file.starred ? theme.warning : theme.border}
                  >
                    <box flexDirection="row" gap={1}>
                      <text fg={file.starred ? theme.warning : theme.textMuted}>
                        {file.starred ? "★" : " "}
                      </text>
                      <text fg={theme.text} attributes={file.starred ? TextAttributes.BOLD : undefined}>
                        {file.path}
                      </text>
                    </box>
                    <Show when={file.symbols && file.symbols.length > 0}>
                      <box flexDirection="column" paddingLeft={3} marginTop={0}>
                        <For each={file.symbols}>
                          {(sym) => <text fg={theme.textMuted}>{sym}</text>}
                        </For>
                      </box>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
          </box>

          {/* Related Symbols */}
          <Show when={code().relatedSymbols.length > 0}>
            <box flexDirection="column" gap={1}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                Related symbols
              </text>
              <box
                flexDirection="column"
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
              >
                <For each={code().relatedSymbols}>
                  {(sym) => <text fg={theme.text}>{sym}</text>}
                </For>
              </box>
            </box>
          </Show>

          {/* Relations */}
          <Show when={code().relations.length > 0}>
            <box flexDirection="column" gap={1}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                Relations
              </text>
              <box
                flexDirection="column"
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
              >
                <For each={code().relations}>
                  {(rel, i) => (
                    <box flexDirection="column">
                      <text fg={theme.text}>{rel.from}</text>
                      <text fg={theme.textMuted}>    ↓ ({rel.relation})</text>
                      <Show when={i() === code().relations.length - 1}>
                        <text fg={theme.text}>{rel.to}</text>
                      </Show>
                    </box>
                  )}
                </For>
              </box>
            </box>
          </Show>

          {/* Tests */}
          <box flexDirection="column" gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Tests
            </text>
            <Show
              when={code().tests.length > 0}
              fallback={
                <box padding={1} backgroundColor={theme.backgroundPanel}>
                  <text fg={theme.textMuted}>No test files associated with current task.</text>
                </box>
              }
            >
              <box
                flexDirection="column"
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
              >
                <For each={code().tests}>
                  {(test) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        fg={
                          test.status === "passed"
                            ? theme.success
                            : test.status === "failed"
                              ? theme.error
                              : theme.textMuted
                        }
                      >
                        {test.status === "passed" ? "✓" : test.status === "failed" ? "✗" : "○"}
                      </text>
                      <text fg={theme.text}>{test.file}</text>
                      <Show when={test.details}>
                        <text fg={theme.textMuted}>({test.details})</text>
                      </Show>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>

          {/* Uncertain */}
          <Show when={code().uncertain.length > 0}>
            <box flexDirection="column" gap={1}>
              <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                Uncertain
              </text>
              <box
                flexDirection="column"
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
                border={["left"]}
                borderColor={theme.warning}
              >
                <For each={code().uncertain}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.warning}>?</text>
                      <text fg={theme.text}>{item}</text>
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

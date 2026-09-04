import { createSignal, createMemo, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useRoute } from "../../context/route"
import { useRivet } from "../context"

export interface ChangesViewProps {
  onClose?: () => void
  onOpenDiff?: (file?: string) => void
}

export function ChangesView(props: ChangesViewProps) {
  const rivet = useRivet()
  const route = useRoute()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const [selectedFileIndex, setSelectedFileIndex] = createSignal<number>(0)

  const sessionID = createMemo(() => {
    if (route.data.type === "session") return route.data.sessionID
    if (route.data.type === "plugin" && typeof route.data.data?.sessionID === "string") {
      return route.data.data.sessionID
    }
    return undefined
  })

  const files = createMemo(() => rivet.changedFiles)

  const totals = createMemo(() => {
    let additions = 0
    let deletions = 0
    for (const f of files()) {
      additions += f.additions
      deletions += f.deletions
    }
    return { additions, deletions, count: files().length }
  })

  // Grounded semantic context: why changed & verification status
  const whyChanged = createMemo(() => rivet.goal)
  const verifications = createMemo(() => {
    return rivet.obligations.map((o) => ({
      name: o.description,
      status: o.status,
    }))
  })

  const handleClose = () => {
    if (props.onClose) {
      props.onClose()
      return
    }
    const returnRoute = ("data" in route.data && (route.data.data as any)?.returnRoute) || { type: "home" }
    route.navigate(returnRoute)
  }

  const handleOpenFullDiff = () => {
    if (props.onOpenDiff) {
      props.onOpenDiff(files()[selectedFileIndex()]?.file)
      return
    }
    route.navigate({
      type: "plugin",
      id: "diff",
      data: {
        mode: "git",
        sessionID: sessionID(),
        returnRoute: route.data,
      },
    })
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
            ◆ CHANGES
          </text>
          <text fg={theme.text}>
            {totals().count} file{totals().count !== 1 ? "s" : ""} changed
          </text>
          <Show when={totals().additions > 0 || totals().deletions > 0}>
            <text>
              <span style={{ fg: theme.diffAdded }}>+{totals().additions} </span>
              <span style={{ fg: theme.diffRemoved }}>-{totals().deletions}</span>
            </text>
          </Show>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted} onMouseDown={handleOpenFullDiff}>
            enter: view full diff
          </text>
          <text fg={theme.textMuted} onMouseDown={handleClose}>
            esc: return
          </text>
        </box>
      </box>

      {/* Semantic context if grounded */}
      <Show when={whyChanged() || verifications().length > 0}>
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.backgroundPanel}
          flexDirection="column"
          gap={0}
        >
          <Show when={whyChanged()}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Why changed:</text>
              <text fg={theme.text}>{whyChanged()}</text>
            </box>
          </Show>
          <Show when={verifications().length > 0}>
            <box flexDirection="row" gap={2} marginTop={0}>
              <text fg={theme.textMuted}>Verification:</text>
              <For each={verifications()}>
                {(v) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text}>{v.name}</text>
                    <text
                      fg={
                        v.status === "passed"
                          ? theme.success
                          : v.status === "failed"
                            ? theme.error
                            : theme.textMuted
                      }
                    >
                      {v.status === "passed" ? "✓" : v.status === "failed" ? "✗" : "○"}
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      </Show>

      {/* Changed Files List */}
      <scrollbox flexGrow={1} minHeight={0}>
        <Show
          when={files().length > 0}
          fallback={
            <box padding={2} backgroundColor={theme.backgroundPanel}>
              <text fg={theme.textMuted}>No working tree or session changes.</text>
            </box>
          }
        >
          <box flexDirection="column" gap={1}>
            <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                FILES
              </text>
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                CHANGES
              </text>
            </box>
            <For each={files()}>
              {(file, i) => {
                const isSelected = () => selectedFileIndex() === i()
                const statusSymbol = file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"
                const statusFg =
                  file.status === "added"
                    ? theme.diffAdded
                    : file.status === "deleted"
                      ? theme.diffRemoved
                      : theme.info

                return (
                  <box
                    flexDirection="row"
                    justifyContent="space-between"
                    paddingLeft={2}
                    paddingRight={2}
                    paddingTop={0}
                    paddingBottom={0}
                    backgroundColor={isSelected() ? theme.backgroundElement : theme.backgroundPanel}
                    border={["left"]}
                    borderColor={isSelected() ? theme.primary : theme.border}
                    onMouseDown={() => {
                      setSelectedFileIndex(i())
                      handleOpenFullDiff()
                    }}
                  >
                    <box flexDirection="row" gap={2}>
                      <text fg={statusFg} attributes={TextAttributes.BOLD} width={2}>
                        {statusSymbol}
                      </text>
                      <text fg={theme.text}>{file.file}</text>
                    </box>
                    <box flexDirection="row" gap={1}>
                      <Show when={file.additions > 0}>
                        <text fg={theme.diffAdded}>+{file.additions}</text>
                      </Show>
                      <Show when={file.deletions > 0}>
                        <text fg={theme.diffRemoved}>-{file.deletions}</text>
                      </Show>
                    </box>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
      </scrollbox>
    </box>
  )
}

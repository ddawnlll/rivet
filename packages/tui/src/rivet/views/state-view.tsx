import { createSignal, createMemo, For, Show, Switch, Match } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, RGBA } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useRoute } from "../../context/route"
import { useRivet } from "../context"
import type { UiHardClaim, UiMemoryItem } from "../types"

export type StateTab = "control" | "hard" | "workspace" | "memory" | "history" | "economics"

export interface StateViewProps {
  initialTab?: StateTab
  onClose?: () => void
}

export function StateView(props: StateViewProps) {
  const rivet = useRivet()
  const route = useRoute()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const [activeTab, setActiveTab] = createSignal<StateTab>(props.initialTab ?? "control")
  const [memoryFilter, setMemoryFilter] = createSignal<"all" | "used" | "ignored">("all")
  const [selectedClaimId, setSelectedClaimId] = createSignal<string | undefined>()
  const [selectedMemoryId, setSelectedMemoryId] = createSignal<string | undefined>()

  const handleClose = () => {
    if (props.onClose) {
      props.onClose()
      return
    }
    const returnRoute = ("data" in route.data && (route.data.data as any)?.returnRoute) || { type: "home" }
    route.navigate(returnRoute)
  }

  const claimStatusBadge = (status: UiHardClaim["status"]) => {
    switch (status) {
      case "verified":
        return { text: "✓ VERIFIED", fg: theme.success }
      case "supported":
        return { text: "● SUPPORTED", fg: theme.info }
      case "dirty":
        return { text: "⚠ DIRTY", fg: theme.warning }
      case "superseded":
        return { text: "~ SUPERSEDED", fg: theme.textMuted }
      case "rejected":
        return { text: "× REJECTED", fg: theme.error }
    }
  }

  const memoryItems = createMemo(() => {
    const list = rivet.memory
    const filter = memoryFilter()
    if (filter === "used") return list.filter((m) => m.used)
    if (filter === "ignored") return list.filter((m) => !m.used)
    return list
  })

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
            ◆ STATE
          </text>
          <text fg={theme.textMuted}>
            {rivet.revision} · {rivet.phase}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>esc to return</text>
        </box>
      </box>

      {/* Tabs */}
      <box flexDirection="row" gap={1} flexShrink={0}>
        <TabButton
          label="Control"
          count={rivet.taskControl.recovery.length}
          active={activeTab() === "control"}
          onClick={() => setActiveTab("control")}
        />
        <TabButton
          label="Hard State"
          count={rivet.hardState.length}
          active={activeTab() === "hard"}
          onClick={() => setActiveTab("hard")}
        />
        <TabButton
          label="Workspace"
          count={rivet.workspace.hypotheses.length + rivet.workspace.unknowns.length + rivet.workspace.plan.length}
          active={activeTab() === "workspace"}
          onClick={() => setActiveTab("workspace")}
        />
        <TabButton
          label="Memory"
          count={rivet.memory.length}
          active={activeTab() === "memory"}
          onClick={() => setActiveTab("memory")}
        />
        <TabButton
          label="History"
          count={rivet.history.length}
          active={activeTab() === "history"}
          onClick={() => setActiveTab("history")}
        />
        <TabButton label="Economics" active={activeTab() === "economics"} onClick={() => setActiveTab("economics")} />
      </box>

      {/* Main Content Area */}
      <scrollbox flexGrow={1} minHeight={0}>
        <Switch>
          {/* TASK CONTROL PLANE */}
          <Match when={activeTab() === "control"}>
            <box flexDirection="column" gap={1}>
              <box padding={1} backgroundColor={theme.backgroundElement} border={["left"]} borderColor={theme.primary}>
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                  AUTHORITATIVE TRAJECTORY
                </text>
                <text fg={theme.textMuted}>
                  Harness-owned task, focus, evidence progress, recovery stack, and mechanical resume target.
                </text>
              </box>

              <box padding={1} backgroundColor={theme.backgroundPanel} flexDirection="column">
                <text fg={theme.textMuted}>ROOT</text>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {rivet.taskControl.root?.objective ?? rivet.goal ?? "No active root goal"}
                </text>
                <Show when={rivet.taskControl.root}>
                  <text fg={theme.textMuted}>
                    {rivet.taskControl.root?.taskId} · r{rivet.taskControl.root?.revision ?? "—"}
                  </text>
                </Show>
              </box>

              <box padding={1} backgroundColor={theme.backgroundPanel} flexDirection="column">
                <text fg={theme.textMuted}>CURRENT FOCUS</text>
                <Show
                  when={rivet.taskControl.focus}
                  fallback={<text fg={theme.textMuted}>No active autonomous focus.</text>}
                >
                  <text fg={theme.info} attributes={TextAttributes.BOLD}>
                    {rivet.taskControl.focus?.kind.toUpperCase()} · {rivet.taskControl.focus?.id}
                  </text>
                  <text fg={theme.text}>{rivet.taskControl.focus?.objective}</text>
                  <text fg={theme.textMuted}>Acceptance: {rivet.taskControl.focus?.acceptanceCriteria.join("; ")}</text>
                  <text fg={theme.textMuted}>Evidence: {rivet.taskControl.focus?.requiredEvidence.join(", ")}</text>
                  <text fg={theme.textMuted}>
                    Effort: {rivet.taskControl.focus?.effort.used}/{rivet.taskControl.focus?.effort.budget ?? "∞"} tool
                    calls
                  </text>
                </Show>
              </box>

              <box padding={1} backgroundColor={theme.backgroundPanel} flexDirection="column">
                <text fg={theme.textMuted}>PROGRESS</text>
                <text
                  fg={
                    rivet.taskControl.progress.verified >= rivet.taskControl.progress.required
                      ? theme.success
                      : theme.warning
                  }
                  attributes={TextAttributes.BOLD}
                >
                  {rivet.taskControl.progress.verified} verified / {rivet.taskControl.progress.required} required
                </text>
                <text fg={theme.textMuted}>Control revision {rivet.taskControl.progress.revision}</text>
              </box>

              <box padding={1} backgroundColor={theme.backgroundPanel} flexDirection="column">
                <text fg={theme.textMuted}>RECOVERY</text>
                <Show
                  when={rivet.taskControl.recovery.length > 0}
                  fallback={<text fg={theme.success}>No active recovery.</text>}
                >
                  <For each={rivet.taskControl.recovery}>
                    {(frame) => (
                      <box flexDirection="column" border={["left"]} borderColor={theme.warning} paddingLeft={1}>
                        <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                          {frame.id} · {frame.failureClass}
                        </text>
                        <text fg={theme.text}>{frame.objective}</text>
                        <text fg={theme.textMuted}>Status: {frame.status}</text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>

              <box padding={1} backgroundColor={theme.backgroundPanel} flexDirection="column">
                <text fg={theme.textMuted}>RESUME</text>
                <text fg={rivet.taskControl.resumeTarget ? theme.info : theme.textMuted}>
                  {rivet.taskControl.resumeTarget ?? "No recovery detour; continue current focus."}
                </text>
              </box>
            </box>
          </Match>

          {/* 1. HARD STATE */}
          <Match when={activeTab() === "hard"}>
            <box flexDirection="column" gap={1}>
              <text fg={theme.textMuted}>
                Authoritative epistemic claims established by proof, tests, or verified evidence.
              </text>
              <Show
                when={rivet.hardState.length > 0}
                fallback={
                  <box padding={2} backgroundColor={theme.backgroundPanel}>
                    <text fg={theme.textMuted}>No authoritative project claims have been admitted yet.</text>
                  </box>
                }
              >
                <For each={rivet.hardState}>
                  {(claim) => {
                    const badge = claimStatusBadge(claim.status)
                    const isSelected = () => selectedClaimId() === claim.id
                    return (
                      <box
                        flexDirection="column"
                        paddingLeft={2}
                        paddingRight={2}
                        paddingTop={1}
                        paddingBottom={1}
                        backgroundColor={isSelected() ? theme.backgroundElement : theme.backgroundPanel}
                        border={["left"]}
                        borderColor={badge.fg}
                        onMouseDown={() => setSelectedClaimId(isSelected() ? undefined : claim.id)}
                      >
                        <box flexDirection="row" justifyContent="space-between" alignItems="center">
                          <text fg={badge.fg} attributes={TextAttributes.BOLD}>
                            {badge.text}
                          </text>
                          <text fg={theme.textMuted}>{claim.sinceRevision}</text>
                        </box>
                        <text fg={theme.text} marginTop={0}>
                          {claim.proposition}
                        </text>
                        <Show when={claim.reason}>
                          <text fg={theme.warning}>{claim.reason}</text>
                        </Show>
                        <Show when={claim.validToRevision}>
                          <text fg={theme.textMuted}>
                            valid: {claim.sinceRevision} → {claim.validToRevision}
                          </text>
                        </Show>

                        {/* Expanded details */}
                        <Show when={isSelected()}>
                          <box
                            marginTop={1}
                            paddingTop={1}
                            border={["top"]}
                            borderColor={theme.border}
                            flexDirection="column"
                            gap={0}
                          >
                            <text fg={theme.textMuted}>
                              Claim ID: <span style={{ fg: theme.text }}>{claim.id}</span>
                            </text>
                            <Show when={claim.scope}>
                              <text fg={theme.textMuted}>
                                Scope: <span style={{ fg: theme.text }}>{claim.scope}</span>
                              </text>
                            </Show>
                            <Show when={claim.evidence.length > 0}>
                              <text fg={theme.textMuted}>
                                Evidence: <span style={{ fg: theme.text }}>{claim.evidence.join(", ")}</span>
                              </text>
                            </Show>
                            <Show when={(claim.sourceRefs ?? []).length > 0}>
                              <text fg={theme.textMuted}>
                                Source refs:{" "}
                                <span style={{ fg: theme.text }}>{(claim.sourceRefs ?? []).join(", ")}</span>
                              </text>
                            </Show>
                          </box>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </Show>
            </box>
          </Match>

          {/* 2. WORKSPACE */}
          <Match when={activeTab() === "workspace"}>
            <box flexDirection="column" gap={1}>
              <box padding={1} backgroundColor={theme.backgroundElement} border={["left"]} borderColor={theme.info}>
                <text fg={theme.info} attributes={TextAttributes.BOLD}>
                  WORKSPACE (SOFT STATE)
                </text>
                <text fg={theme.textMuted}>
                  Provisional working cognition — what Rivet is currently investigating, not authoritative project
                  truth.
                </text>
              </box>

              {/* Hypotheses */}
              <box flexDirection="column" gap={1} marginTop={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Hypotheses
                </text>
                <Show
                  when={rivet.workspace.hypotheses.length > 0}
                  fallback={<text fg={theme.textMuted}>No active hypotheses under investigation.</text>}
                >
                  <For each={rivet.workspace.hypotheses}>
                    {(hyp) => (
                      <box
                        paddingLeft={2}
                        paddingRight={2}
                        paddingTop={1}
                        paddingBottom={1}
                        backgroundColor={theme.backgroundPanel}
                        border={["left"]}
                        borderColor={theme.warning}
                      >
                        <text fg={theme.warning}>? HYPOTHESIS</text>
                        <text fg={theme.text}>{hyp}</text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>

              {/* Unknowns */}
              <box flexDirection="column" gap={1} marginTop={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Unknowns
                </text>
                <Show
                  when={rivet.workspace.unknowns.length > 0}
                  fallback={<text fg={theme.textMuted}>No unresolved unknowns recorded.</text>}
                >
                  <For each={rivet.workspace.unknowns}>
                    {(unk) => (
                      <box
                        paddingLeft={2}
                        paddingRight={2}
                        paddingTop={1}
                        paddingBottom={1}
                        backgroundColor={theme.backgroundPanel}
                        border={["left"]}
                        borderColor={theme.info}
                      >
                        <text fg={theme.info}>? UNKNOWN</text>
                        <text fg={theme.text}>{unk}</text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>

              {/* Current Plan */}
              <box flexDirection="column" gap={1} marginTop={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Current Plan
                </text>
                <Show
                  when={rivet.workspace.plan.length > 0}
                  fallback={<text fg={theme.textMuted}>No explicit plan registered.</text>}
                >
                  <box
                    paddingLeft={2}
                    paddingRight={2}
                    paddingTop={1}
                    paddingBottom={1}
                    backgroundColor={theme.backgroundPanel}
                    flexDirection="column"
                  >
                    <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                      → CURRENT PLAN
                    </text>
                    <For each={rivet.workspace.plan}>
                      {(step, i) => (
                        <text fg={theme.text}>
                          {i() + 1}. {step}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
              </box>
            </box>
          </Match>

          {/* 3. MEMORY */}
          <Match when={activeTab() === "memory"}>
            <box flexDirection="column" gap={1}>
              <box flexDirection="row" justifyContent="space-between" alignItems="center">
                <text fg={theme.textMuted}>
                  Memory admission decisions: what was remembered, what was excluded, and why.
                </text>
                <box flexDirection="row" gap={1}>
                  <FilterChip label="All" active={memoryFilter() === "all"} onClick={() => setMemoryFilter("all")} />
                  <FilterChip label="Used" active={memoryFilter() === "used"} onClick={() => setMemoryFilter("used")} />
                  <FilterChip
                    label="Ignored"
                    active={memoryFilter() === "ignored"}
                    onClick={() => setMemoryFilter("ignored")}
                  />
                </box>
              </box>

              <Show
                when={memoryItems().length > 0}
                fallback={
                  <box padding={2} backgroundColor={theme.backgroundPanel}>
                    <text fg={theme.textMuted}>No memories were evaluated for this turn.</text>
                  </box>
                }
              >
                {/* USED MEMORIES */}
                <Show when={memoryFilter() !== "ignored"}>
                  {(() => {
                    const used = memoryItems().filter((m) => m.used)
                    return (
                      <Show when={used.length > 0}>
                        <text fg={theme.success} attributes={TextAttributes.BOLD} marginTop={1}>
                          USED THIS TURN
                        </text>
                        <For each={used}>
                          {(item) => {
                            const isSelected = () => selectedMemoryId() === item.id
                            return (
                              <box
                                flexDirection="column"
                                paddingLeft={2}
                                paddingRight={2}
                                paddingTop={1}
                                paddingBottom={1}
                                backgroundColor={isSelected() ? theme.backgroundElement : theme.backgroundPanel}
                                border={["left"]}
                                borderColor={theme.success}
                                onMouseDown={() => setSelectedMemoryId(isSelected() ? undefined : item.id)}
                              >
                                <box flexDirection="row" justifyContent="space-between">
                                  <text fg={theme.success} attributes={TextAttributes.BOLD}>
                                    ✓ {item.kind === "procedure" ? "Procedure" : "Episode"}
                                  </text>
                                  <Show when={item.relevance}>
                                    <text fg={theme.textMuted}>relevance: {item.relevance}</text>
                                  </Show>
                                </box>
                                <text fg={theme.text}>{item.summary}</text>

                                <Show when={isSelected() && item.details}>
                                  <box
                                    marginTop={1}
                                    paddingTop={1}
                                    border={["top"]}
                                    borderColor={theme.border}
                                    flexDirection="column"
                                  >
                                    <Show when={item.details?.score !== undefined}>
                                      <text fg={theme.textMuted}>
                                        Score: <span style={{ fg: theme.text }}>{item.details!.score}</span>
                                      </text>
                                    </Show>
                                    <Show when={item.details?.horizon}>
                                      <text fg={theme.textMuted}>
                                        Horizon: <span style={{ fg: theme.text }}>{item.details!.horizon}</span>
                                      </text>
                                    </Show>
                                  </box>
                                </Show>
                              </box>
                            )
                          }}
                        </For>
                      </Show>
                    )
                  })()}
                </Show>

                {/* IGNORED MEMORIES */}
                <Show when={memoryFilter() !== "used"}>
                  {(() => {
                    const ignored = memoryItems().filter((m) => !m.used)
                    return (
                      <Show when={ignored.length > 0}>
                        <text fg={theme.textMuted} attributes={TextAttributes.BOLD} marginTop={1}>
                          IGNORED (SUPPRESSED)
                        </text>
                        <For each={ignored}>
                          {(item) => {
                            const isSelected = () => selectedMemoryId() === item.id
                            return (
                              <box
                                flexDirection="column"
                                paddingLeft={2}
                                paddingRight={2}
                                paddingTop={1}
                                paddingBottom={1}
                                backgroundColor={isSelected() ? theme.backgroundElement : theme.backgroundPanel}
                                border={["left"]}
                                borderColor={theme.textMuted}
                                onMouseDown={() => setSelectedMemoryId(isSelected() ? undefined : item.id)}
                              >
                                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                                  ⊘ {item.kind === "provisional" ? "Provisional" : "Historical"}
                                </text>
                                <text fg={theme.text}>{item.summary}</text>

                                <Show when={item.whyIgnored && item.whyIgnored.length > 0}>
                                  <box flexDirection="column" marginTop={1}>
                                    <text fg={theme.warning}>Why ignored:</text>
                                    <For each={item.whyIgnored}>
                                      {(reason) => <text fg={theme.textMuted}> - {reason}</text>}
                                    </For>
                                  </box>
                                </Show>

                                <Show when={isSelected() && item.details}>
                                  <box
                                    marginTop={1}
                                    paddingTop={1}
                                    border={["top"]}
                                    borderColor={theme.border}
                                    flexDirection="column"
                                  >
                                    <Show when={item.details?.horizon}>
                                      <text fg={theme.textMuted}>
                                        Horizon: <span style={{ fg: theme.text }}>{item.details!.horizon}</span>
                                      </text>
                                    </Show>
                                    <Show when={item.details?.score !== undefined}>
                                      <text fg={theme.textMuted}>
                                        Relevance Score: <span style={{ fg: theme.text }}>{item.details!.score}</span>
                                      </text>
                                    </Show>
                                  </box>
                                </Show>
                              </box>
                            )
                          }}
                        </For>
                      </Show>
                    )
                  })()}
                </Show>
              </Show>
            </box>
          </Match>

          {/* 4. HISTORY */}
          <Match when={activeTab() === "history"}>
            <box flexDirection="column" gap={1}>
              <text fg={theme.textMuted}>Temporal log of verified epistemic transitions and modifications.</text>
              <Show
                when={rivet.history.length > 0}
                fallback={
                  <box padding={2} backgroundColor={theme.backgroundPanel}>
                    <text fg={theme.textMuted}>No revision history recorded yet.</text>
                  </box>
                }
              >
                <For each={rivet.history}>
                  {(entry) => (
                    <box
                      flexDirection="row"
                      gap={2}
                      paddingLeft={2}
                      paddingRight={2}
                      paddingTop={1}
                      paddingBottom={1}
                      backgroundColor={theme.backgroundPanel}
                    >
                      <text fg={theme.info} width={8} flexShrink={0} attributes={TextAttributes.BOLD}>
                        {entry.revision}
                      </text>
                      <box flexDirection="column" flexGrow={1}>
                        <text fg={theme.text}>{entry.summary}</text>
                        <Show when={entry.detail}>
                          <text fg={theme.textMuted}>{entry.detail}</text>
                        </Show>
                      </box>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </Match>
          {/* 5. ECONOMICS */}
          <Match when={activeTab() === "economics"}>
            <box flexDirection="column" gap={1}>
              <box padding={1} backgroundColor={theme.backgroundElement} border={["left"]} borderColor={theme.primary}>
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                  RUNTIME ECONOMICS & TOKEN EFFICIENCY
                </text>
                <text fg={theme.textMuted}>
                  Real-time flight recorder timeline, prompt-cache reuse, token expenditures, and latencies.
                </text>
              </box>

              {/* Flight Recorder Timeline Card */}
              <Show when={rivet.statusRail.flightTimeline !== undefined || rivet.statusRail.activeSpan !== undefined}>
                <box
                  flexDirection="column"
                  paddingLeft={2}
                  paddingRight={2}
                  paddingTop={1}
                  paddingBottom={1}
                  backgroundColor={theme.backgroundPanel}
                  border={["left"]}
                  borderColor={theme.primary}
                >
                  <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                    FLIGHT RECORDER · TURN {rivet.statusRail.flightTimeline?.turnId ?? 1} ·{" "}
                    {((rivet.statusRail.flightTimeline?.totalElapsedMs ?? 0) / 1000).toFixed(3)}s
                  </text>
                  <Show when={rivet.statusRail.activeSpan !== undefined}>
                    <box flexDirection="row" gap={1} marginTop={1}>
                      <text fg={theme.textMuted}>NOW:</text>
                      <text fg={theme.info} attributes={TextAttributes.BOLD}>
                        ◈ {rivet.statusRail.activeSpan?.label}
                      </text>
                    </box>
                  </Show>
                  <Show when={rivet.statusRail.recentSpans && rivet.statusRail.recentSpans.length > 0}>
                    <box flexDirection="column" marginTop={1} gap={0}>
                      <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                        RECENT LIFECYCLE SPANS
                      </text>
                      <For each={rivet.statusRail.recentSpans}>
                        {(span) => (
                          <box flexDirection="row" justifyContent="space-between">
                            <text fg={theme.text}>◈ {span.label}</text>
                            <text fg={theme.textMuted}>{(span.durationMs / 1000).toFixed(2)}s</text>
                          </box>
                        )}
                      </For>
                    </box>
                  </Show>
                  <box flexDirection="column" marginTop={1} gap={0}>
                    <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                      TURN TIMELINE
                    </text>
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.text}>Rivet-owned</text>
                      <text fg={theme.text}>
                        {rivet.statusRail.flightTimeline?.rivetOwnedMs !== undefined
                          ? `${rivet.statusRail.flightTimeline.rivetOwnedMs.toFixed(1)} ms`
                          : "—"}
                      </text>
                    </box>
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.text}>Provider → TTFT</text>
                      <text fg={theme.text}>
                        {rivet.statusRail.flightTimeline?.providerTtftMs !== undefined
                          ? `${rivet.statusRail.flightTimeline.providerTtftMs.toFixed(1)} ms`
                          : "—"}
                      </text>
                    </box>
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.text}>Provider generation</text>
                      <text fg={theme.text}>
                        {rivet.statusRail.flightTimeline?.providerGenerationMs !== undefined
                          ? `${rivet.statusRail.flightTimeline.providerGenerationMs.toFixed(1)} ms`
                          : "—"}
                      </text>
                    </box>
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.text}>Tool execution</text>
                      <text fg={theme.text}>
                        {rivet.statusRail.flightTimeline?.toolExecutionMs !== undefined &&
                        rivet.statusRail.flightTimeline.toolExecutionMs > 0
                          ? `${rivet.statusRail.flightTimeline.toolExecutionMs.toFixed(1)} ms`
                          : "—"}
                      </text>
                    </box>
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.text}>Settlement & Finalize</text>
                      <text fg={theme.text}>
                        {rivet.statusRail.flightTimeline?.providerFinalizeMs !== undefined &&
                        rivet.statusRail.flightTimeline.providerFinalizeMs > 0
                          ? `${rivet.statusRail.flightTimeline.providerFinalizeMs.toFixed(1)} ms`
                          : "—"}
                      </text>
                    </box>
                    <box flexDirection="row" justifyContent="space-between" marginTop={1}>
                      <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                        Unattributed
                      </text>
                      <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                        {rivet.statusRail.flightTimeline?.unattributedMs !== undefined
                          ? `${rivet.statusRail.flightTimeline.unattributedMs.toFixed(1)} ms`
                          : "—"}
                      </text>
                    </box>
                  </box>
                </box>
              </Show>

              {/* Cache Efficiency Card */}
              <box
                flexDirection="column"
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
                border={["left"]}
                borderColor={
                  (rivet.statusRail.cacheHitRatio ?? 0) >= 0.8
                    ? theme.success
                    : (rivet.statusRail.cacheHitRatio ?? 0) >= 0.5
                      ? theme.warning
                      : theme.error
                }
              >
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                  PROMPT CACHE REUSE
                </text>
                <text fg={theme.text}>
                  Effective Cache Hit Ratio:{" "}
                  <span
                    style={{
                      fg:
                        (rivet.statusRail.cacheHitRatio ?? 0) >= 0.8
                          ? theme.success
                          : (rivet.statusRail.cacheHitRatio ?? 0) >= 0.5
                            ? theme.warning
                            : theme.error,
                      attributes: TextAttributes.BOLD,
                    }}
                  >
                    {rivet.statusRail.cacheHitRatio !== undefined
                      ? `${Math.round(rivet.statusRail.cacheHitRatio * 100)}%`
                      : "Pending first turn"}
                  </span>
                </text>
                <Show when={rivet.statusRail.totalTokens !== undefined}>
                  <text fg={theme.textMuted}>
                    Total Prompt Tokens: {rivet.statusRail.totalTokens?.toLocaleString()} · Cached Tokens:{" "}
                    {rivet.statusRail.cachedTokens?.toLocaleString()}
                  </text>
                </Show>
              </box>

              {/* Recall Latency Card */}
              <box
                flexDirection="column"
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={theme.backgroundPanel}
                border={["left"]}
                borderColor={theme.info}
              >
                <text fg={theme.info} attributes={TextAttributes.BOLD}>
                  SQLITE RECALL STORAGE & QUERY LATENCY
                </text>
                <text fg={theme.text}>
                  Query Duration:{" "}
                  <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>
                    {rivet.statusRail.recallLatencyMs !== undefined
                      ? `${Math.round(rivet.statusRail.recallLatencyMs)}ms`
                      : "< 5ms (Indexed FTS5 + Candidate Filtering)"}
                  </span>
                </text>
                <text fg={theme.textMuted}>
                  Indexing Strategy: Single-Event Delta Projection (O(1) semantic append: 0.69ms at 5,000 docs)
                </text>
                <text fg={theme.textMuted}>
                  Pre-filtering: Compound status + scope indices + BM25 FTS5 candidate matching
                </text>
              </box>

              {/* Context Optimization Summary */}
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
                <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                  CONTEXT LIFECYCLE & PREFIX STABILITY
                </text>
                <text fg={theme.text}>
                  Byte-Stable Prefix: Anchored CognitiveView layout with immutable goal/contract header
                </text>
                <text fg={theme.text}>
                  Historical Tool Folding: Results older than 3 turns folded to semantic reference stubs
                </text>
                <text fg={theme.text}>
                  Modal Action Exposure: Epistemic tool schemas gated to active autonomous goals
                </text>
              </box>
            </box>
          </Match>
        </Switch>
      </scrollbox>
      <box
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.backgroundElement}
      >
        <text fg={rivet.statusRail.activeSpan ? theme.info : theme.textMuted}>
          {rivet.statusRail.activeSpan
            ? `${rivet.statusRail.activeSpan.label} · ${rivet.statusRail.activeSpan.elapsedMs.toFixed(0)}ms`
            : "Idle"}
        </text>
        <text fg={theme.textMuted}>
          {rivet.statusRail.lastCompletedSpan
            ? `${rivet.statusRail.lastCompletedSpan.label} · ${rivet.statusRail.lastCompletedSpan.durationMs.toFixed(0)}ms`
            : rivet.revision}
        </text>
      </box>
    </box>
  )
}

function TabButton(props: { label: string; count?: number; active: boolean; onClick: () => void }) {
  const { theme } = useTheme()
  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      paddingTop={0}
      paddingBottom={0}
      backgroundColor={props.active ? theme.primary : theme.backgroundElement}
      onMouseDown={props.onClick}
    >
      <text
        fg={props.active ? theme.background : theme.text}
        attributes={props.active ? TextAttributes.BOLD : undefined}
      >
        {props.label} {props.count !== undefined ? `(${props.count})` : ""}
      </text>
    </box>
  )
}

function FilterChip(props: { label: string; active: boolean; onClick: () => void }) {
  const { theme } = useTheme()
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.active ? theme.primary : theme.backgroundPanel}
      onMouseDown={props.onClick}
    >
      <text fg={props.active ? theme.background : theme.textMuted}>{props.label}</text>
    </box>
  )
}

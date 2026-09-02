import { useParams } from "@solidjs/router"
import { createMemo, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"

type Tab = "state" | "workspace" | "praxis"

const SEMANTIC_TOOLS = new Set(["propose_claim", "request_verification", "request_completion"])

export function RivetControlPlane() {
  const language = useLanguage()
  const sync = useServerSync()
  const params = useParams<{ id?: string }>()
  const [state, setState] = createStore({ open: false, tab: "state" as Tab })

  const session = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))
  const messages = createMemo(() => (params.id ? (sync().session.data.message[params.id] ?? []) : []))
  const parts = createMemo(() => messages().flatMap((message) => sync().session.data.part[message.id] ?? []))
  const toolParts = createMemo(() => parts().filter(isToolPart))
  const completedTools = createMemo(() => toolParts().filter((part) => part.state.status === "completed"))
  const semanticParts = createMemo(() => completedTools().filter((part) => SEMANTIC_TOOLS.has(part.tool)))
  const active = createMemo(() => {
    const id = params.id
    return id ? sync().session.data.session_status[id]?.type ?? "idle" : "idle"
  })

  const project = createMemo(() => {
    const current = session()
    if (current) return sync().data.project.find((item) => item.id === current.projectID)
    const directory = sync().data.path.directory
    return sync().data.project.find((item) => item.worktree === directory)
  })

  const goal = createMemo(() => {
    const current = session()
    const metadata = current?.metadata
    if (!isRecord(metadata)) return undefined
    const rivet = metadata.rivet
    if (!isRecord(rivet)) return undefined
    return typeof rivet.goal === "string" ? rivet.goal : undefined
  })

  const obligations = createMemo(() => {
    const completion = [...semanticParts()].reverse().find((part) => part.tool === "request_completion")
    if (!completion || completion.state.status !== "completed") return []
    return readStringArray(completion.state.metadata.obligations)
  })

  const claimCount = createMemo(() => semanticParts().filter((part) => part.tool === "propose_claim").length)
  const verificationParts = createMemo(() => semanticParts().filter((part) => part.tool === "request_verification"))
  const executionCount = createMemo(() => completedTools().filter((part) => !SEMANTIC_TOOLS.has(part.tool)).length)
  const lastVerification = createMemo(() => {
    const part = verificationParts().at(-1)
    if (!part || part.state.status !== "completed") return undefined
    return part.state.metadata.passed === true
  })
  const revision = createMemo(() => semanticParts().length)
  const statusLabel = createMemo(() => {
    if (active() === "busy") return language.t("rivet.status.busy")
    if (active() === "retry") return language.t("rivet.status.retry")
    return language.t("rivet.status.idle")
  })

  return (
    <aside
      class="pointer-events-none fixed inset-y-0 end-0 z-40 flex items-center pe-3 pt-14 pb-3 sm:pe-4"
      aria-label={language.t("rivet.surface.label")}
    >
      <div
        classList={{
          "pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden rounded-[14px] border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-overlay)]": true,
          "w-[min(344px,calc(100vw_-_24px))]": state.open,
          "w-10": !state.open,
        }}
      >
        <Show
          when={state.open}
          fallback={
            <button
              type="button"
              class="flex h-10 w-10 shrink-0 items-center justify-center text-v2-icon-icon-base transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
              onClick={() => setState("open", true)}
              aria-label={language.t("rivet.panel.open")}
              title={language.t("rivet.panel.open")}
            >
              <span class="relative flex size-5 items-center justify-center">
                <span class="absolute size-2 rounded-full bg-v2-icon-icon-info" />
                <span class="absolute size-4 rounded-full border border-v2-icon-icon-info opacity-35" />
              </span>
            </button>
          }
        >
          <div class="flex min-h-0 flex-1 flex-col">
            <header class="flex shrink-0 items-start justify-between gap-3 border-b-[0.5px] border-v2-border-border-muted px-4 py-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2 text-[13px] font-[600] leading-5 text-v2-text-text-base">
                  <span class="relative flex size-4 items-center justify-center">
                    <span class="absolute size-1.5 rounded-full bg-v2-icon-icon-info" />
                    <span class="absolute size-3.5 rounded-full border border-v2-icon-icon-info opacity-35" />
                  </span>
                  {language.t("rivet.surface.label")}
                </div>
                <div class="mt-0.5 text-[11px] leading-4 text-v2-text-text-muted">
                  {language.t("rivet.surface.description")}
                </div>
              </div>
              <button
                type="button"
                class="flex size-6 shrink-0 items-center justify-center rounded-md text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                onClick={() => setState("open", false)}
                aria-label={language.t("rivet.panel.close")}
                title={language.t("rivet.panel.close")}
              >
                <Icon name="close" size="small" />
              </button>
            </header>

            <div class="grid shrink-0 grid-cols-3 gap-1 border-b-[0.5px] border-v2-border-border-muted p-2">
              <TabButton active={state.tab === "state"} onClick={() => setState("tab", "state")}>
                {language.t("rivet.panel.state")}
              </TabButton>
              <TabButton active={state.tab === "workspace"} onClick={() => setState("tab", "workspace")}>
                {language.t("rivet.panel.workspace")}
              </TabButton>
              <TabButton active={state.tab === "praxis"} onClick={() => setState("tab", "praxis")}>
                {language.t("rivet.panel.praxis")}
              </TabButton>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <Show when={state.tab === "state"}>
                <div class="flex flex-col gap-3">
                  <StatusCard status={active()} label={statusLabel()} />
                  <section class="rounded-lg border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base p-3">
                    <div class="text-[10px] font-[600] uppercase tracking-[0.08em] text-v2-text-text-muted">
                      {language.t("rivet.state.goal")}
                    </div>
                    <div class="mt-2 line-clamp-3 text-[13px] leading-5 text-v2-text-text-base">
                      {goal() ?? session()?.title ?? language.t("rivet.state.noGoal")}
                    </div>
                  </section>
                  <div class="grid grid-cols-3 gap-2">
                    <Metric label={language.t("rivet.state.revision")} value={revision()} />
                    <Metric label={language.t("rivet.state.claims")} value={claimCount()} />
                    <Metric label={language.t("rivet.state.obligations")} value={obligations().length} />
                  </div>
                  <Show when={obligations().length > 0}>
                    <section class="rounded-lg border-[0.5px] border-v2-border-border-warning bg-v2-background-bg-base p-3">
                      <For each={obligations()}>
                        {(obligation) => (
                          <div class="flex gap-2 py-1 text-[12px] leading-4 text-v2-text-text-base">
                            <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-v2-icon-icon-warning" />
                            <span>{obligation}</span>
                          </div>
                        )}
                      </For>
                    </section>
                  </Show>
                  <Show when={semanticParts().length === 0}>
                    <div class="px-1 text-[12px] leading-5 text-v2-text-text-muted">
                      {language.t("rivet.state.awaiting")}
                    </div>
                  </Show>
                </div>
              </Show>

              <Show when={state.tab === "workspace"}>
                <div class="flex flex-col gap-2">
                  <WorkspaceRow label={language.t("rivet.workspace.project")} value={project()?.name ?? project()?.id ?? "—"} />
                  <WorkspaceRow
                    label={language.t("rivet.workspace.directory")}
                    value={session()?.directory ?? sync().data.path.directory ?? "—"}
                    truncate
                  />
                  <WorkspaceRow
                    label={language.t("rivet.workspace.provider")}
                    value={session()?.model?.providerID ?? language.t("rivet.workspace.local")}
                  />
                  <div class="mt-1 grid grid-cols-2 gap-2">
                    <Metric label={language.t("rivet.workspace.messages")} value={messages().length} />
                    <Metric label={language.t("rivet.workspace.tools")} value={executionCount()} />
                  </div>
                  <div class="mt-1 rounded-lg border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2 text-[12px] text-v2-text-text-muted">
                    {sync().data.provider.connected.length} {language.t("rivet.workspace.connected").toLocaleLowerCase()}
                  </div>
                </div>
              </Show>

              <Show when={state.tab === "praxis"}>
                <div class="flex flex-col gap-3">
                  <section class="rounded-lg border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base p-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-[12px] font-[600] text-v2-text-text-base">
                        {language.t("rivet.praxis.verification")}
                      </div>
                      <span
                        classList={{
                          "text-[11px]": true,
                          "text-v2-icon-icon-success": lastVerification() === true,
                          "text-v2-text-text-muted": lastVerification() !== true,
                        }}
                      >
                        {lastVerification() === true
                          ? language.t("rivet.praxis.passed")
                          : language.t("rivet.praxis.pending")}
                      </span>
                    </div>
                    <div class="mt-2 text-[12px] leading-5 text-v2-text-text-muted">
                      {verificationParts().length > 0
                        ? `${verificationParts().length} ${language.t("rivet.praxis.verification").toLocaleLowerCase()}`
                        : language.t("rivet.praxis.none")}
                    </div>
                  </section>
                  <Metric label={language.t("rivet.praxis.execution")} value={executionCount()} />
                  <Show when={semanticParts().length > 0}>
                    <div class="flex flex-col gap-1">
                      <For each={semanticParts().slice(-5).reverse()}>
                        {(part) => (
                          <div class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-v2-text-text-muted">
                            <Icon name={part.tool === "request_verification" ? "shield" : "check"} size="small" />
                            <span class="truncate">{part.tool.replaceAll("_", " ")}</span>
                            <span class="ms-auto size-1.5 shrink-0 rounded-full bg-v2-icon-icon-success" />
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </aside>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <button
      type="button"
      classList={{
        "rounded-md px-1.5 py-1.5 text-[10px] font-[600] leading-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus": true,
        "bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-raised)]": props.active,
        "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base": !props.active,
      }}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function StatusCard(props: { status: string; label: string }) {
  const running = props.status === "busy"
  return (
    <div class="flex items-center gap-3 rounded-lg border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2.5">
      <span
        classList={{
          "size-2 shrink-0 rounded-full": true,
          "bg-v2-icon-icon-info shadow-[0_0_0_4px_color-mix(in_srgb,var(--v2-icon-icon-info)_12%,transparent)]": running,
          "bg-v2-icon-icon-success": !running,
        }}
      />
      <span class="text-[12px] font-[600] text-v2-text-text-base">{props.label}</span>
      <span class="ms-auto text-[10px] uppercase tracking-[0.08em] text-v2-text-text-muted">Noesis</span>
    </div>
  )
}

function Metric(props: { label: string; value: number }) {
  return (
    <div class="min-w-0 rounded-lg border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base p-2">
      <div class="truncate text-[10px] leading-4 text-v2-text-text-muted">{props.label}</div>
      <div class="mt-1 text-[16px] font-[600] leading-5 tabular-nums text-v2-text-text-base">{props.value}</div>
    </div>
  )
}

function WorkspaceRow(props: { label: string; value: string; truncate?: boolean }) {
  return (
    <div class="rounded-lg border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2">
      <div class="text-[10px] leading-4 text-v2-text-text-muted">{props.label}</div>
      <div classList={{ "mt-0.5 text-[12px] text-v2-text-text-base": true, "truncate": props.truncate }} title={props.value}>
        {props.value}
      </div>
    </div>
  )
}

function isToolPart(part: Part): part is Extract<Part, { type: "tool" }> {
  return part.type === "tool"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

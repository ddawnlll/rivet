import { createMemo, createContext, onCleanup, onMount, createSignal, useContext, type JSX } from "solid-js"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { projectRivetState, type RivetProjection } from "./projection"

const RivetContext = createContext<() => RivetProjection>()

/**
 * Drives projection refreshes while a provider is silent. Session sync events
 * are not a reliable render clock: a request can remain busy for seconds
 * without producing a chunk, so the status rail would otherwise freeze.
 */
export function createRivetRenderClock(intervalMs = 250) {
  const [now, setNow] = createSignal(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined

  const start = () => {
    if (timer !== undefined) return
    timer = setInterval(() => setNow(Date.now()), intervalMs)
  }

  const stop = () => {
    if (timer === undefined) return
    clearInterval(timer)
    timer = undefined
  }

  return { now, start, stop }
}

export function RivetProvider(props: { children: JSX.Element; sessionID?: () => string | undefined }) {
  const sync = useSync()
  const route = useRoute()

  const sessionID = createMemo(() => {
    if (props.sessionID) return props.sessionID()
    if (route.data.type === "session") return route.data.sessionID
    if (route.data.type === "plugin" && typeof route.data.data?.sessionID === "string") {
      return route.data.data.sessionID
    }
    return undefined
  })

  const session = createMemo(() => (sessionID() ? sync.session.get(sessionID()!) : undefined))
  const messages = createMemo(() => (sessionID() ? (sync.data.message[sessionID()!] ?? []) : []))
  const parts = createMemo(() => messages().flatMap((m) => sync.data.part[m.id] ?? []))
  const changedFiles = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return (sync.data.session_diff[id] ?? []).flatMap((item) =>
      item.file ? [{ file: item.file, additions: item.additions, deletions: item.deletions, status: item.status }] : [],
    )
  })
  const sessionStatus = createMemo(() => {
    const id = sessionID()
    return id ? sync.data.session_status[id] : undefined
  })

  const renderClock = createRivetRenderClock()
  onMount(renderClock.start)
  onCleanup(renderClock.stop)

  const projection = createMemo<RivetProjection>(() => {
    // Subscribe to the local clock so elapsed active spans advance even when
    // the provider emits no events.
    renderClock.now()
    const s = session()
    return projectRivetState({
      sessionID: s?.id,
      title: s?.title,
      directory: s?.directory,
      metadata: s?.metadata,
      messages: messages(),
      parts: parts(),
      changedFiles: changedFiles(),
      sessionStatus: sessionStatus(),
    })
  })

  return <RivetContext.Provider value={projection}>{props.children}</RivetContext.Provider>
}

export function useRivet(): RivetProjection {
  const ctx = useContext(RivetContext)
  if (!ctx) {
    // Fallback when called outside provider (e.g. initial render or standalone test)
    return projectRivetState({})
  }
  return ctx()
}

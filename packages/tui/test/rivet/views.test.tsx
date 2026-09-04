/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { ParentProps } from "solid-js"
import { ThemeProvider } from "../../src/context/theme"
import { RouteProvider } from "../../src/context/route"
import { KVProvider } from "../../src/context/kv"
import { TuiConfigProvider } from "../../src/config"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { StateView } from "../../src/rivet/views/state-view"
import { CodeView } from "../../src/rivet/views/code-view"
import { VerifyView } from "../../src/rivet/views/verify-view"
import { ChangesView } from "../../src/rivet/views/changes-view"
import { StatusRail } from "../../src/rivet/components/status-rail"
import { CurrentWork } from "../../src/rivet/components/current-work"

function TestWrapper(props: ParentProps) {
  const config = createTuiResolvedConfig({})
  return (
    <TestTuiContexts>
      <TuiConfigProvider config={config}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <RouteProvider>{props.children}</RouteProvider>
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </TestTuiContexts>
  )
}

async function captureSettledFrame(app: Awaited<ReturnType<typeof testRender>>) {
  await app.renderOnce()
  await new Promise((r) => setTimeout(r, 50))
  await app.renderOnce()
  return app.captureCharFrame()
}

describe("Rivet TUI Views", () => {
  test("StateView: renders Hard State with visible indicators", async () => {
    let closed = false
    const app = await testRender(
      () => (
        <TestWrapper>
          <StateView initialTab="hard" onClose={() => (closed = true)} />
        </TestWrapper>
      ),
      { width: 100, height: 30 },
    )

    try {
      const text = await captureSettledFrame(app)
      expect(text).toContain("STATE")
      expect(text).toContain("Hard State")
      expect(text).toContain("Workspace")
      expect(text).toContain("Memory")
      expect(text).toContain("History")
    } finally {
      app.renderer.destroy()
    }
  })

  test("StateView: renders Workspace tab with hypotheses and plans", async () => {
    const app = await testRender(
      () => (
        <TestWrapper>
          <StateView initialTab="workspace" />
        </TestWrapper>
      ),
      { width: 100, height: 30 },
    )

    try {
      const text = await captureSettledFrame(app)
      expect(text).toContain("WORKSPACE (SOFT STATE)")
      expect(text).toContain("Hypotheses")
      expect(text).toContain("Unknowns")
      expect(text).toContain("Current Plan")
    } finally {
      app.renderer.destroy()
    }
  })

  test("StateView: renders Memory tab with Used vs Ignored", async () => {
    const app = await testRender(
      () => (
        <TestWrapper>
          <StateView initialTab="memory" />
        </TestWrapper>
      ),
      { width: 100, height: 30 },
    )

    try {
      const text = await captureSettledFrame(app)
      expect(text).toContain("Memory")
      expect(text).toContain("All")
      expect(text).toContain("Used")
      expect(text).toContain("Ignored")
    } finally {
      app.renderer.destroy()
    }
  })

  test("CodeView: renders relevant files, relations, tests, and uncertain section", async () => {
    const app = await testRender(
      () => (
        <TestWrapper>
          <CodeView />
        </TestWrapper>
      ),
      { width: 100, height: 30 },
    )

    try {
      const text = await captureSettledFrame(app)
      expect(text).toContain("CODE")
      expect(text).toContain("Relevant files")
      expect(text).toContain("Tests")
      expect(text).not.toContain("Task Neighborhood")
      expect(text).not.toContain("Repository Frontier")
    } finally {
      app.renderer.destroy()
    }
  })

  test("VerifyView: renders obligations and completion status", async () => {
    const app = await testRender(
      () => (
        <TestWrapper>
          <VerifyView />
        </TestWrapper>
      ),
      { width: 100, height: 30 },
    )

    try {
      const text = await captureSettledFrame(app)
      expect(text).toContain("VERIFY")
      expect(text).toContain("Goal")
      expect(text).toContain("COMPLETION")
      expect(text).toContain("REQUIRED")
    } finally {
      app.renderer.destroy()
    }
  })

  test("ChangesView: renders file list and diff context", async () => {
    const app = await testRender(
      () => (
        <TestWrapper>
          <ChangesView />
        </TestWrapper>
      ),
      { width: 100, height: 30 },
    )

    try {
      const text = await captureSettledFrame(app)
      expect(text).toContain("CHANGES")
      expect(text).toContain("No working tree or session changes")
    } finally {
      app.renderer.destroy()
    }
  })

  test("StatusRail: adapts layout between wide and narrow terminals", async () => {
    // Wide terminal
    const wideApp = await testRender(
      () => (
        <TestWrapper>
          <StatusRail />
        </TestWrapper>
      ),
      { width: 120, height: 5 },
    )

    try {
      const text = await captureSettledFrame(wideApp)
      expect(text).toContain("Rivet")
      expect(text).toContain("task")
      expect(text).toContain("changed")
    } finally {
      wideApp.renderer.destroy()
    }

    // Narrow terminal
    const narrowApp = await testRender(
      () => (
        <TestWrapper>
          <StatusRail />
        </TestWrapper>
      ),
      { width: 45, height: 5 },
    )

    try {
      const text = await captureSettledFrame(narrowApp)
      expect(text).toContain("◆")
      expect(text).toContain("T0")
      expect(text).toContain("Δ0")
    } finally {
      narrowApp.renderer.destroy()
    }
  })

  test("CurrentWork: renders sidebar with goal, status, and verification", async () => {
    const app = await testRender(
      () => (
        <TestWrapper>
          <CurrentWork />
        </TestWrapper>
      ),
      { width: 40, height: 25 },
    )

    try {
      const text = await captureSettledFrame(app)
      expect(text).toContain("CURRENT WORK")
      expect(text).toContain("Goal")
      expect(text).toContain("Status")
      expect(text).toContain("Verification")
    } finally {
      app.renderer.destroy()
    }
  })
})

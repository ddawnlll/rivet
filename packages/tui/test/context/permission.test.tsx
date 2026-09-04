/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ArgsProvider } from "../../src/context/args"
import { PermissionProvider, usePermission } from "../../src/context/permission"

test("initializes permission mode to normal when auto flag is not set", async () => {
  let mode: string | undefined
  function TestComponent() {
    const permission = usePermission()
    mode = permission.mode
    return <box />
  }

  const app = await testRender(() => (
    <ArgsProvider>
      <PermissionProvider>
        <TestComponent />
      </PermissionProvider>
    </ArgsProvider>
  ))

  try {
    expect(mode).toBe("normal")
  } finally {
    app.renderer.destroy()
  }
})

test("initializes permission mode to auto when auto flag is set (via --yolo / --auto)", async () => {
  let mode: string | undefined
  function TestComponent() {
    const permission = usePermission()
    mode = permission.mode
    return <box />
  }

  const app = await testRender(() => (
    <ArgsProvider auto={true}>
      <PermissionProvider>
        <TestComponent />
      </PermissionProvider>
    </ArgsProvider>
  ))

  try {
    expect(mode).toBe("auto")
  } finally {
    app.renderer.destroy()
  }
})

test("toggles permission mode between normal and auto", async () => {
  let perm: ReturnType<typeof usePermission> | undefined
  function TestComponent() {
    perm = usePermission()
    return <box />
  }

  const app = await testRender(() => (
    <ArgsProvider>
      <PermissionProvider>
        <TestComponent />
      </PermissionProvider>
    </ArgsProvider>
  ))

  try {
    expect(perm?.mode).toBe("normal")
    perm?.toggle()
    expect(perm?.mode).toBe("auto")
    perm?.toggle()
    expect(perm?.mode).toBe("normal")
    perm?.set("auto")
    expect(perm?.mode).toBe("auto")
    perm?.set("normal")
    expect(perm?.mode).toBe("normal")
  } finally {
    app.renderer.destroy()
  }
})

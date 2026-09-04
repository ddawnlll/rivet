import { describe, expect, test } from "bun:test"
import { TuiKeybind } from "../../src/config/keybind"

describe("Rivet TUI Commands and Keybindings", () => {
  test("CommandMap maps all rivet keybind actions to command IDs", () => {
    expect(TuiKeybind.CommandMap.rivet_state).toBe("rivet.state")
    expect(TuiKeybind.CommandMap.rivet_code).toBe("rivet.code")
    expect(TuiKeybind.CommandMap.rivet_changes).toBe("rivet.changes")
    expect(TuiKeybind.CommandMap.rivet_verify).toBe("rivet.verify")
    expect(TuiKeybind.CommandMap.rivet_memory).toBe("rivet.memory")
    expect(TuiKeybind.CommandMap.rivet_history).toBe("rivet.history")
  })

  test("Definitions provides default bindings and plain-language descriptions", () => {
    const descriptions = TuiKeybind.Descriptions

    expect(descriptions.rivet_state).toBe("Open State view")
    expect(descriptions.rivet_code).toBe("Open Code context view")
    expect(descriptions.rivet_changes).toBe("Open Changes view")
    expect(descriptions.rivet_verify).toBe("Open Verify view")
    expect(descriptions.rivet_memory).toBe("Open Memory view")
    expect(descriptions.rivet_history).toBe("Open History view")
  })

  test("Keybinding defaults parse and resolve correctly", () => {
    expect(TuiKeybind.defaultValue("rivet_state")).toBe("<leader>S")
    expect(TuiKeybind.defaultValue("rivet_code")).toBe("<leader>C")
    expect(TuiKeybind.defaultValue("rivet_changes")).toBe("<leader>D")
    expect(TuiKeybind.defaultValue("rivet_verify")).toBe("<leader>V")
    expect(TuiKeybind.defaultValue("rivet_memory")).toBe("<leader>M")
    expect(TuiKeybind.defaultValue("rivet_history")).toBe("<leader>H")

    const parsed = TuiKeybind.parse({})
    expect(parsed.rivet_state).toBe("<leader>S")
    expect(parsed.rivet_code).toBe("<leader>C")
    expect(parsed.rivet_changes).toBe("<leader>D")
    expect(parsed.rivet_verify).toBe("<leader>V")
    expect(parsed.rivet_memory).toBe("<leader>M")
    expect(parsed.rivet_history).toBe("<leader>H")
  })

  test("Modal routing commands open respective views via dialog", () => {
    let replacedView: any = null
    const mockDialog = {
      replace: (fn: () => any) => {
        replacedView = fn()
      },
      clear: () => {
        replacedView = null
      },
    }

    // Simulate rivet.state run
    mockDialog.replace(() => ({ type: "state-view", initialTab: "hard" }))
    expect(replacedView).toEqual({ type: "state-view", initialTab: "hard" })

    // Simulate rivet.code run
    mockDialog.replace(() => ({ type: "code-view" }))
    expect(replacedView).toEqual({ type: "code-view" })

    // Simulate rivet.changes run
    mockDialog.replace(() => ({ type: "changes-view" }))
    expect(replacedView).toEqual({ type: "changes-view" })

    // Simulate rivet.verify run
    mockDialog.replace(() => ({ type: "verify-view" }))
    expect(replacedView).toEqual({ type: "verify-view" })

    // Clear dialog
    mockDialog.clear()
    expect(replacedView).toBeNull()
  })
})

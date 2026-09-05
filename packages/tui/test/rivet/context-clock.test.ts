import { createEffect, createRoot } from "solid-js"
import { describe, expect, test } from "bun:test"
import { createRivetRenderClock } from "../../src/rivet/context"

describe("Rivet render clock", () => {
  test("ticks without provider events and stops on cleanup", async () => {
    const observed: number[] = []
    let clockStop = () => {}

    const dispose = createRoot(() => {
      const clock = createRivetRenderClock(5)
      createEffect(() => observed.push(clock.now()))
      clock.start()
      clockStop = clock.stop
      return () => {}
    })

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        clockStop()
        resolve()
      }, 30)
    })

    const stoppedCount = observed.length
    await new Promise((resolve) => setTimeout(resolve, 20))
    dispose()
    expect(observed.length).toBeGreaterThan(1)
    expect(observed.length).toBe(stoppedCount)
  })
})

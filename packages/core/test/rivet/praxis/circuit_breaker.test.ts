import { describe, expect, test } from "bun:test"
import { CircuitBreaker } from "../../../src/rivet/praxis/circuit-breaker"

describe("Praxis Circuit Breaker", () => {
  test("Trips open on high failure rate and resets after timeout", async () => {
    const cb = new CircuitBreaker({
      failureRateThreshold: 0.5,
      minimumRequests: 3,
      windowSize: 4,
      resetTimeoutMs: 50,
    })

    expect(cb.state).toBe("closed")
    expect(cb.canExecute()).toBe(true)

    cb.recordResult(false)
    cb.recordResult(false)
    cb.recordResult(false)

    // Tripped open
    expect(cb.state).toBe("open")
    expect(cb.canExecute()).toBe(false)

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(cb.canExecute()).toBe(true)
    expect(cb.state).toBe("half_open")

    // Successful execution closes the circuit
    cb.recordResult(true)
    expect(cb.state).toBe("closed")
  })
})

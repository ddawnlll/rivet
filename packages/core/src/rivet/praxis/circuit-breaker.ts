export type CircuitBreakerState = "closed" | "open" | "half_open"

export interface CircuitBreakerConfig {
  readonly failureRateThreshold: number // e.g. 0.5 (50%)
  readonly minimumRequests: number // e.g. 5
  readonly windowSize: number // e.g. 10
  readonly resetTimeoutMs: number // e.g. 30000ms
}

export class CircuitBreaker {
  readonly config: CircuitBreakerConfig
  state: CircuitBreakerState = "closed"
  private history: boolean[] = [] // true = success, false = failure
  private lastStateChange: number = Date.now()

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureRateThreshold: config?.failureRateThreshold ?? 0.5,
      minimumRequests: config?.minimumRequests ?? 5,
      windowSize: config?.windowSize ?? 10,
      resetTimeoutMs: config?.resetTimeoutMs ?? 30000,
    }
  }

  canExecute(): boolean {
    switch (this.state) {
      case "closed":
        return true
      case "open": {
        if (Date.now() - this.lastStateChange >= this.config.resetTimeoutMs) {
          this.state = "half_open"
          this.lastStateChange = Date.now()
          return true
        }
        return false
      }
      case "half_open":
        return true
    }
  }

  recordResult(success: boolean): void {
    this.history.push(success)
    if (this.history.length > this.config.windowSize) {
      this.history.shift()
    }

    switch (this.state) {
      case "closed": {
        if (this.history.length >= this.config.minimumRequests) {
          const failures = this.history.filter((s) => !s).length
          const rate = failures / this.history.length
          if (rate >= this.config.failureRateThreshold) {
            this.state = "open"
            this.lastStateChange = Date.now()
          }
        }
        break
      }
      case "half_open": {
        if (success) {
          this.state = "closed"
          this.history.length = 0
          this.lastStateChange = Date.now()
        } else {
          this.state = "open"
          this.lastStateChange = Date.now()
        }
        break
      }
      case "open":
        break
    }
  }

  reset(): void {
    this.state = "closed"
    this.history.length = 0
    this.lastStateChange = Date.now()
  }
}

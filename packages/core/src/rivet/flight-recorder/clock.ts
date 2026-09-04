export class MonotonicClock {
  static now(): number {
    return performance.now()
  }

  static wallNow(): string {
    return new Date().toISOString()
  }

  static elapsed(startMs: number): number {
    return performance.now() - startMs
  }
}

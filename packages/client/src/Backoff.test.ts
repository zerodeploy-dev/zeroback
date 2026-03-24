import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Backoff } from "./Backoff"

describe("Backoff", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // jitter factor = 0.5 + 0.5 = 1.0 → deterministic
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5)
  })

  afterEach(() => {
    randomSpy.mockRestore()
  })

  // ---------- defaults ----------
  describe("defaults", () => {
    it("uses baseMs=1000 by default", () => {
      const b = new Backoff()
      // attempt 0: 1000 * 2^0 * 1.0 = 1000
      expect(b.next()).toBe(1000)
    })

    it("uses maxMs=30000 by default", () => {
      const b = new Backoff({ baseMs: 100_000 })
      // 100000 * 1.0 = 100000, capped at 30000
      expect(b.next()).toBe(30000)
    })

    it("uses maxAttempts=5 by default", () => {
      const b = new Backoff()
      for (let i = 0; i < 5; i++) b.next()
      expect(b.shouldRetry()).toBe(false)
    })
  })

  // ---------- next() ----------
  describe("next()", () => {
    it("grows exponentially", () => {
      const b = new Backoff({ baseMs: 100, maxMs: 100_000 })
      // attempt 0: 100 * 1 * 1.0 = 100
      expect(b.next()).toBe(100)
      // attempt 1: 100 * 2 * 1.0 = 200
      expect(b.next()).toBe(200)
      // attempt 2: 100 * 4 * 1.0 = 400
      expect(b.next()).toBe(400)
    })

    it("caps at maxMs", () => {
      const b = new Backoff({ baseMs: 1000, maxMs: 5000, maxAttempts: 10 })
      // attempt 0: 1000
      b.next()
      // attempt 1: 2000
      b.next()
      // attempt 2: 4000
      b.next()
      // attempt 3: 8000, capped to 5000
      expect(b.next()).toBe(5000)
    })

    it("returns integers (Math.floor)", () => {
      randomSpy.mockReturnValue(0.3)
      const b = new Backoff({ baseMs: 100, maxMs: 100_000 })
      // 100 * 1 * (0.5 + 0.3) = 80
      expect(b.next()).toBe(80)
    })

    it("includes jitter from Math.random", () => {
      randomSpy.mockReturnValue(0)
      const b = new Backoff({ baseMs: 100, maxMs: 100_000 })
      // 100 * 1 * (0.5 + 0) = 50
      expect(b.next()).toBe(50)
    })

    it("increments attempt counter each call", () => {
      const b = new Backoff({ baseMs: 100, maxMs: 100_000, maxAttempts: 3 })
      expect(b.shouldRetry()).toBe(true)
      b.next()
      expect(b.shouldRetry()).toBe(true)
      b.next()
      expect(b.shouldRetry()).toBe(true)
      b.next()
      expect(b.shouldRetry()).toBe(false)
    })
  })

  // ---------- reset() ----------
  describe("reset()", () => {
    it("resets the attempt counter", () => {
      const b = new Backoff({ baseMs: 100, maxMs: 100_000 })
      b.next() // attempt 0 → 100
      b.next() // attempt 1 → 200
      b.reset()
      // back to attempt 0 → 100
      expect(b.next()).toBe(100)
    })
  })

  // ---------- shouldRetry() ----------
  describe("shouldRetry()", () => {
    it("returns true when under maxAttempts", () => {
      const b = new Backoff({ maxAttempts: 3 })
      expect(b.shouldRetry()).toBe(true)
      b.next()
      expect(b.shouldRetry()).toBe(true)
    })

    it("returns false after exhausting attempts", () => {
      const b = new Backoff({ maxAttempts: 2 })
      b.next()
      b.next()
      expect(b.shouldRetry()).toBe(false)
    })

    it("returns true again after reset", () => {
      const b = new Backoff({ maxAttempts: 1 })
      b.next()
      expect(b.shouldRetry()).toBe(false)
      b.reset()
      expect(b.shouldRetry()).toBe(true)
    })
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import { ConnectionManager } from "./ConnectionManager"

function makeWs(): WebSocket {
  return { send: vi.fn(), close: vi.fn() } as unknown as WebSocket
}

describe("ConnectionManager", () => {
  let cm: ConnectionManager

  beforeEach(() => {
    cm = new ConnectionManager()
  })

  describe("add() and get()", () => {
    it("stores and retrieves connection by ws", () => {
      const ws = makeWs()
      cm.add(ws, "conn-1")
      expect(cm.get(ws)).toBe("conn-1")
    })

    it("returns undefined for unknown ws", () => {
      expect(cm.get(makeWs())).toBeUndefined()
    })
  })

  describe("getById()", () => {
    it("retrieves ws by connection id", () => {
      const ws = makeWs()
      cm.add(ws, "conn-1")
      expect(cm.getById("conn-1")).toBe(ws)
    })

    it("returns undefined for unknown id", () => {
      expect(cm.getById("unknown")).toBeUndefined()
    })
  })

  describe("remove()", () => {
    it("removes by ws reference", () => {
      const ws = makeWs()
      cm.add(ws, "conn-1")
      cm.remove(ws)
      expect(cm.get(ws)).toBeUndefined()
      expect(cm.getById("conn-1")).toBeUndefined()
    })

    it("no-ops for unknown ws", () => {
      cm.remove(makeWs()) // no error
    })
  })

  describe("removeById()", () => {
    it("removes by connection id", () => {
      const ws = makeWs()
      cm.add(ws, "conn-1")
      cm.removeById("conn-1")
      expect(cm.get(ws)).toBeUndefined()
      expect(cm.getById("conn-1")).toBeUndefined()
    })

    it("no-ops for unknown id", () => {
      cm.removeById("unknown")
    })
  })

  describe("size()", () => {
    it("returns 0 when empty", () => {
      expect(cm.size()).toBe(0)
    })

    it("tracks connection count", () => {
      cm.add(makeWs(), "a")
      cm.add(makeWs(), "b")
      expect(cm.size()).toBe(2)
    })

    it("decrements on remove", () => {
      const ws = makeWs()
      cm.add(ws, "a")
      cm.remove(ws)
      expect(cm.size()).toBe(0)
    })
  })

  describe("isFull()", () => {
    it("returns false when under limit", () => {
      expect(cm.isFull()).toBe(false)
    })

    it("returns true at MAX_CONNECTIONS", () => {
      for (let i = 0; i < ConnectionManager.MAX_CONNECTIONS; i++) {
        cm.add(makeWs(), `conn-${i}`)
      }
      expect(cm.isFull()).toBe(true)
    })
  })

  describe("getAll()", () => {
    it("returns empty array when empty", () => {
      expect(cm.getAll()).toEqual([])
    })

    it("returns all connected websockets", () => {
      const ws1 = makeWs()
      const ws2 = makeWs()
      cm.add(ws1, "a")
      cm.add(ws2, "b")
      expect(cm.getAll()).toHaveLength(2)
      expect(cm.getAll()).toContain(ws1)
      expect(cm.getAll()).toContain(ws2)
    })
  })

  describe("checkRateLimit()", () => {
    it("allows messages under the limit", () => {
      cm.add(makeWs(), "conn-1")
      expect(cm.checkRateLimit("conn-1")).toBe(true)
    })

    it("returns false for unknown connection", () => {
      expect(cm.checkRateLimit("unknown")).toBe(false)
    })

    it("blocks after MAX_MESSAGES in window", () => {
      cm.add(makeWs(), "conn-1")
      // Fill up the rate limit window
      for (let i = 0; i < ConnectionManager.RATE_LIMIT_MAX_MESSAGES; i++) {
        expect(cm.checkRateLimit("conn-1")).toBe(true)
      }
      // Next one should be blocked
      expect(cm.checkRateLimit("conn-1")).toBe(false)
    })

    it("allows again after window expires", () => {
      vi.useFakeTimers()
      try {
        cm.add(makeWs(), "conn-1")
        // Fill up
        for (let i = 0; i < ConnectionManager.RATE_LIMIT_MAX_MESSAGES; i++) {
          cm.checkRateLimit("conn-1")
        }
        expect(cm.checkRateLimit("conn-1")).toBe(false)

        // Advance past the window
        vi.advanceTimersByTime(ConnectionManager.RATE_LIMIT_WINDOW_MS + 1)
        expect(cm.checkRateLimit("conn-1")).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it("cleans rate limit on remove", () => {
      const ws = makeWs()
      cm.add(ws, "conn-1")
      cm.checkRateLimit("conn-1")
      cm.remove(ws)
      // After removal, rate limit check returns false (no window found)
      expect(cm.checkRateLimit("conn-1")).toBe(false)
    })
  })
})

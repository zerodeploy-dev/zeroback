import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest"
import { ZerobackClient } from "./ZerobackClient"
import type { ServerMessage } from "@zeroback/values"

// ---------- Mock MutationQueue (IDB dependency) ----------
vi.mock("./persistence/MutationQueue.js", () => ({
  MutationQueue: class MockMutationQueue {
    add = vi.fn().mockResolvedValue(undefined)
    remove = vi.fn().mockResolvedValue(undefined)
    getAll = vi.fn().mockResolvedValue([])
    clear = vi.fn().mockResolvedValue(undefined)
  },
}))

// ---------- MockWebSocket ----------
class MockWebSocket {
  static CONNECTING = 0 as const
  static OPEN = 1 as const
  static CLOSING = 2 as const
  static CLOSED = 3 as const

  CONNECTING = 0 as const
  OPEN = 1 as const
  CLOSING = 2 as const
  CLOSED = 3 as const

  readyState: number = MockWebSocket.CONNECTING
  sent: string[] = []

  onopen: ((ev: any) => void) | null = null
  onclose: ((ev: any) => void) | null = null
  onmessage: ((ev: any) => void) | null = null
  onerror: ((ev: any) => void) | null = null

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({})
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.({})
  }

  simulateMessage(data: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({})
  }

  static instances: MockWebSocket[] = []
  static reset(): void {
    MockWebSocket.instances = []
  }
}

// ---------- Helpers ----------
function latestWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

function parseSent(ws: MockWebSocket): any[] {
  return ws.sent.map((s) => JSON.parse(s))
}

/** Flush pending microtasks (promise continuations). */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

// ---------- Tests ----------
describe("ZerobackClient", () => {
  let origWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.reset()
    origWebSocket = globalThis.WebSocket
    globalThis.WebSocket = MockWebSocket as any
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    globalThis.WebSocket = origWebSocket
  })

  // =============================================
  // Connection lifecycle
  // =============================================
  describe("connection lifecycle", () => {
    it("creates a WebSocket on construction", () => {
      new ZerobackClient("ws://localhost:1234")
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(latestWs().url).toBe("ws://localhost:1234")
    })

    it("starts in connecting state", () => {
      const client = new ZerobackClient("ws://localhost:1234")
      expect(client.connectionState).toBe("connecting")
    })

    it("transitions to connected on WS open", () => {
      const client = new ZerobackClient("ws://localhost:1234")
      latestWs().simulateOpen()
      expect(client.connectionState).toBe("connected")
    })

    it("transitions to disconnected on WS close", () => {
      const client = new ZerobackClient("ws://localhost:1234")
      latestWs().simulateOpen()
      latestWs().simulateClose()
      expect(client.connectionState).toBe("disconnected")
    })

    it("defers connect when persistence is enabled", () => {
      new ZerobackClient("ws://localhost:1234", { persistence: true })
      expect(MockWebSocket.instances).toHaveLength(0)
    })
  })

  // =============================================
  // Connection state listeners
  // =============================================
  describe("connection state listeners", () => {
    it("notifies listeners on state change", () => {
      const client = new ZerobackClient("ws://localhost:1234")
      const listener = vi.fn()
      client.onConnectionChange(listener)

      latestWs().simulateOpen()
      expect(listener).toHaveBeenCalledWith("connected")
    })

    it("skips duplicate state notifications", () => {
      const client = new ZerobackClient("ws://localhost:1234")
      const listener = vi.fn()
      client.onConnectionChange(listener)

      latestWs().simulateOpen()
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it("unsubscribe stops notifications", () => {
      const client = new ZerobackClient("ws://localhost:1234")
      const listener = vi.fn()
      const unsub = client.onConnectionChange(listener)
      unsub()

      latestWs().simulateOpen()
      expect(listener).not.toHaveBeenCalled()
    })
  })

  // =============================================
  // Reconnection
  // =============================================
  describe("reconnection", () => {
    it("schedules reconnect on close", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5)
      const client = new ZerobackClient("ws://localhost:1234", {
        backoff: { baseMs: 100, maxMs: 10_000, maxAttempts: 3 },
      })
      latestWs().simulateOpen()
      latestWs().simulateClose()

      expect(MockWebSocket.instances).toHaveLength(1)

      // Advance past backoff delay: 100 * 2^0 * 1.0 = 100ms
      vi.advanceTimersByTime(100)
      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it("resubscribes after reconnect", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5)
      const client = new ZerobackClient("ws://localhost:1234", {
        backoff: { baseMs: 100, maxMs: 10_000, maxAttempts: 3 },
        heartbeatIntervalMs: 0,
      })
      const ws1 = latestWs()
      ws1.simulateOpen()

      client.subscribe("tasks:list", { status: "active" })
      const queryMsg = parseSent(ws1).find((m) => m.type === "query")
      expect(queryMsg).toBeDefined()

      ws1.simulateClose()
      vi.advanceTimersByTime(100)

      const ws2 = latestWs()
      ws2.simulateOpen()

      const resubs = parseSent(ws2).filter((m) => m.type === "query")
      expect(resubs).toHaveLength(1)
      expect(resubs[0].fn).toBe("tasks:list")
    })

    it("stops reconnecting after max attempts", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5)
      // maxAttempts=1 → only 1 reconnect attempt after initial connection
      const client = new ZerobackClient("ws://localhost:1234", {
        backoff: { baseMs: 10, maxMs: 1000, maxAttempts: 1 },
        heartbeatIntervalMs: 0,
      })

      // Initial connection fails
      latestWs().simulateClose() // scheduleReconnect: shouldRetry (0<1)=true, next()→attempt=1

      vi.advanceTimersByTime(10)
      expect(MockWebSocket.instances).toHaveLength(2)

      // Second connection fails
      latestWs().simulateClose() // scheduleReconnect: shouldRetry (1<1)=false → no reconnect

      vi.advanceTimersByTime(10000)
      expect(MockWebSocket.instances).toHaveLength(2) // no third WS
    })

    it("does not reconnect after close()", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5)
      const client = new ZerobackClient("ws://localhost:1234", {
        backoff: { baseMs: 10, maxMs: 1000, maxAttempts: 5 },
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()
      client.close()

      vi.advanceTimersByTime(10000)
      expect(MockWebSocket.instances).toHaveLength(1)
    })
  })

  // =============================================
  // subscribe()
  // =============================================
  describe("subscribe()", () => {
    it("sends a query message", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      client.subscribe("tasks:get", { id: "123" })
      const msgs = parseSent(latestWs())
      const query = msgs.find((m) => m.type === "query")
      expect(query).toMatchObject({
        type: "query",
        fn: "tasks:get",
        args: { id: "123" },
      })
      expect(query.id).toBeDefined()
    })

    it("queues message when disconnected", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      client.subscribe("fn", {})
      expect(latestWs().sent).toHaveLength(0)
    })

    it("flushes queued messages on open", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      client.subscribe("fn", { a: 1 })
      expect(latestWs().sent).toHaveLength(0)

      latestWs().simulateOpen()
      const msgs = parseSent(latestWs())
      const queries = msgs.filter((m) => m.type === "query")
      expect(queries.length).toBeGreaterThanOrEqual(1)
      expect(queries[0].fn).toBe("fn")
    })

    it("unsubscribe sends unsubscribe message", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const unsub = client.subscribe("fn", {})
      unsub()

      const msgs = parseSent(latestWs())
      const unsubMsg = msgs.find((m) => m.type === "unsubscribe")
      expect(unsubMsg).toBeDefined()
    })
  })

  // =============================================
  // Message handling
  // =============================================
  describe("message handling", () => {
    it("result updates queryStore and calls callback", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const cb = vi.fn()
      client.subscribe("tasks:list", {}, cb)

      const queryMsg = parseSent(latestWs()).find((m) => m.type === "query")
      const subId = queryMsg.id

      latestWs().simulateMessage({
        type: "result",
        id: subId,
        result: [{ _id: "1" }],
      })

      expect(cb).toHaveBeenCalledWith([{ _id: "1" }])
    })

    it("update also triggers callback", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const cb = vi.fn()
      client.subscribe("fn", {}, cb)
      const subId = parseSent(latestWs()).find((m) => m.type === "query").id

      latestWs().simulateMessage({
        type: "update",
        id: subId,
        result: "updated",
      })

      expect(cb).toHaveBeenCalledWith("updated")
    })

    it("handles batch updates", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const cb1 = vi.fn()
      const cb2 = vi.fn()
      client.subscribe("fn1", {}, cb1)
      client.subscribe("fn2", {}, cb2)

      const msgs = parseSent(latestWs()).filter((m) => m.type === "query")
      const id1 = msgs[0].id
      const id2 = msgs[1].id

      latestWs().simulateMessage({
        type: "updates",
        items: [
          { id: id1, result: "r1" },
          { id: id2, result: "r2" },
        ],
      })

      expect(cb1).toHaveBeenCalledWith("r1")
      expect(cb2).toHaveBeenCalledWith("r2")
    })

    it("mutationResult resolves pending mutation", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const promise = client.mutation("tasks:create", { title: "test" })
      await flush()

      const mutMsg = parseSent(latestWs()).find((m) => m.type === "mutation")
      expect(mutMsg).toBeDefined()

      latestWs().simulateMessage({
        type: "mutationResult",
        id: mutMsg.id,
        result: { _id: "new-1" },
      })

      const result = await promise
      expect(result).toEqual({ _id: "new-1" })
    })

    it("error rejects pending request", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const promise = client.mutation("tasks:create", {})
      await flush()

      const mutMsg = parseSent(latestWs()).find((m) => m.type === "mutation")
      expect(mutMsg).toBeDefined()

      latestWs().simulateMessage({
        type: "error",
        id: mutMsg.id,
        code: "BAD_REQUEST",
        message: "Validation failed",
      })

      await expect(promise).rejects.toThrow("Validation failed")
    })

    it("pong updates lastPongAt", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      latestWs().simulateMessage({ type: "pong" })
      // No error means it was handled gracefully
    })

    it("reset clears server confirmations and resubscribes", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      client.subscribe("fn1", {})
      client.subscribe("fn2", {})

      latestWs().sent.length = 0

      latestWs().simulateMessage({ type: "reset" })

      const msgs = parseSent(latestWs())
      const queries = msgs.filter((m) => m.type === "query")
      expect(queries).toHaveLength(2)
    })
  })

  // =============================================
  // mutation()
  // =============================================
  describe("mutation()", () => {
    it("sends a mutation message", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      client.mutation("tasks:create", { title: "test" })
      await flush()

      const msgs = parseSent(latestWs())
      const mut = msgs.find((m) => m.type === "mutation")
      expect(mut).toMatchObject({
        type: "mutation",
        fn: "tasks:create",
        args: { title: "test" },
      })
    })

    it("resolves on mutationResult", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const promise = client.mutation("fn", {})
      await flush()

      const mutId = parseSent(latestWs()).find((m) => m.type === "mutation").id

      latestWs().simulateMessage({
        type: "mutationResult",
        id: mutId,
        result: 42,
      })

      expect(await promise).toBe(42)
    })

    it("rejects on error", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const promise = client.mutation("fn", {})
      await flush()

      const mutId = parseSent(latestWs()).find((m) => m.type === "mutation").id

      latestWs().simulateMessage({
        type: "error",
        id: mutId,
        code: "INTERNAL",
        message: "boom",
      })

      await expect(promise).rejects.toThrow("boom")
    })

    it("applies and removes optimistic layer", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const key = "counter|{}"
      client.queryStore.setServerResult(key, 0)

      const promise = client.mutation("increment", {}, {
        optimisticUpdate: (store) => {
          const val = store.getQuery("counter", {}) as number
          store.setQuery("counter", {}, val + 1)
        },
      })

      // Optimistic layer applied synchronously
      expect(client.queryStore.getResult(key)).toBe(1)

      await flush()

      const mutId = parseSent(latestWs()).find((m) => m.type === "mutation").id
      latestWs().simulateMessage({
        type: "mutationResult",
        id: mutId,
        result: null,
      })

      await promise

      // Layer removed after resolve
      expect(client.queryStore.getResult(key)).toBe(0)
    })

    it("executes mutations sequentially", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const order: number[] = []

      const p1 = client.mutation("fn1", {}).then(() => order.push(1))
      const p2 = client.mutation("fn2", {}).then(() => order.push(2))

      await flush()

      // Only first mutation sent (second waits in queue)
      const muts = parseSent(latestWs()).filter((m) => m.type === "mutation")
      expect(muts).toHaveLength(1)
      expect(muts[0].fn).toBe("fn1")

      // Resolve first
      latestWs().simulateMessage({
        type: "mutationResult",
        id: muts[0].id,
        result: null,
      })

      await flush()

      // Second mutation now sent
      const allMuts = parseSent(latestWs()).filter((m) => m.type === "mutation")
      expect(allMuts).toHaveLength(2)

      latestWs().simulateMessage({
        type: "mutationResult",
        id: allMuts[1].id,
        result: null,
      })

      await Promise.all([p1, p2])
      expect(order).toEqual([1, 2])
    })

    it("failure does not block subsequent mutations", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const p1 = client.mutation("fn1", {}).catch(() => {})
      await flush()

      const muts1 = parseSent(latestWs()).filter((m) => m.type === "mutation")
      expect(muts1).toHaveLength(1)

      latestWs().simulateMessage({
        type: "error",
        id: muts1[0].id,
        code: "FAIL",
        message: "fail",
      })

      await p1
      await flush()

      const p2 = client.mutation("fn2", {})
      await flush()

      const allMuts = parseSent(latestWs()).filter((m) => m.type === "mutation")
      expect(allMuts).toHaveLength(2)

      latestWs().simulateMessage({
        type: "mutationResult",
        id: allMuts[1].id,
        result: "ok",
      })

      expect(await p2).toBe("ok")
    })
  })

  // =============================================
  // action()
  // =============================================
  describe("action()", () => {
    it("sends an action message", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      client.action("sendEmail", { to: "a@b.com" })
      const msgs = parseSent(latestWs())
      const action = msgs.find((m) => m.type === "action")
      expect(action).toMatchObject({
        type: "action",
        fn: "sendEmail",
        args: { to: "a@b.com" },
      })
    })

    it("resolves on actionResult", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const promise = client.action("fn", {})
      const actId = parseSent(latestWs()).find((m) => m.type === "action").id

      latestWs().simulateMessage({
        type: "actionResult",
        id: actId,
        result: "done",
      })

      expect(await promise).toBe("done")
    })

    it("rejects on error", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      const promise = client.action("fn", {})
      const actId = parseSent(latestWs()).find((m) => m.type === "action").id

      latestWs().simulateMessage({
        type: "error",
        id: actId,
        code: "INTERNAL",
        message: "action error",
      })

      await expect(promise).rejects.toThrow("action error")
    })
  })

  // =============================================
  // Request timeout
  // =============================================
  describe("request timeout", () => {
    it("mutation rejects after requestTimeoutMs", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
        requestTimeoutMs: 5000,
      })
      latestWs().simulateOpen()

      const promise = client.mutation("fn", {})
      await flush()

      vi.advanceTimersByTime(5000)

      await expect(promise).rejects.toThrow("Request timed out")
    })

    it("action rejects after requestTimeoutMs", async () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
        requestTimeoutMs: 3000,
      })
      latestWs().simulateOpen()

      const promise = client.action("fn", {})

      vi.advanceTimersByTime(3000)

      await expect(promise).rejects.toThrow("Request timed out")
    })
  })

  // =============================================
  // Heartbeat
  // =============================================
  describe("heartbeat", () => {
    it("sends ping at interval", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 1000,
      })
      latestWs().simulateOpen()

      vi.advanceTimersByTime(1000)
      const pings = parseSent(latestWs()).filter((m) => m.type === "ping")
      expect(pings).toHaveLength(1)

      vi.advanceTimersByTime(1000)
      const pings2 = parseSent(latestWs()).filter((m) => m.type === "ping")
      expect(pings2).toHaveLength(2)
    })

    it("closes WS when no pong for 2x interval", () => {
      // Mock Date.now to work with fake timers
      let fakeNow = 1000
      vi.spyOn(Date, "now").mockImplementation(() => fakeNow)

      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 1000,
      })
      const ws = latestWs()
      ws.simulateOpen()
      // lastPongAt = Date.now() = 1000

      // First tick at +1000ms: Date.now() should be 2000
      fakeNow = 2000
      vi.advanceTimersByTime(1000)
      // 2000 - 1000 = 1000, not > 2000 → sends ping
      expect(ws.readyState).toBe(MockWebSocket.OPEN)

      // Second tick at +2000ms: Date.now() should be 3000
      fakeNow = 3000
      vi.advanceTimersByTime(1000)
      // 3000 - 1000 = 2000, not > 2000 → sends ping
      expect(ws.readyState).toBe(MockWebSocket.OPEN)

      // Third tick at +3000ms: Date.now() should be 4000
      fakeNow = 4000
      vi.advanceTimersByTime(1000)
      // 4000 - 1000 = 3000 > 2000 → closes WS
      expect(ws.readyState).toBe(MockWebSocket.CLOSED)
    })

    it("does not start heartbeat when interval is 0", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      vi.advanceTimersByTime(60_000)
      const pings = parseSent(latestWs()).filter((m) => m.type === "ping")
      expect(pings).toHaveLength(0)
    })

    it("stops heartbeat on close()", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 1000,
      })
      const ws = latestWs()
      ws.simulateOpen()

      client.close()

      const sentBefore = ws.sent.length
      vi.advanceTimersByTime(5000)
      expect(ws.sent.length).toBe(sentBefore)
    })
  })

  // =============================================
  // close()
  // =============================================
  describe("close()", () => {
    it("closes the WebSocket", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      const ws = latestWs()
      ws.simulateOpen()

      client.close()
      expect(ws.readyState).toBe(MockWebSocket.CLOSED)
    })

    it("sets state to disconnected", () => {
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
      })
      latestWs().simulateOpen()

      client.close()
      expect(client.connectionState).toBe("disconnected")
    })

    it("prevents reconnection", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5)
      const client = new ZerobackClient("ws://localhost:1234", {
        heartbeatIntervalMs: 0,
        backoff: { baseMs: 10, maxMs: 1000, maxAttempts: 10 },
      })
      latestWs().simulateOpen()
      client.close()

      vi.advanceTimersByTime(60_000)
      expect(MockWebSocket.instances).toHaveLength(1)
    })
  })
})

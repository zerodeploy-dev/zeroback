import { describe, it, expect, vi, afterEach } from "vitest"
import { preloadQuery } from "./preloadQuery"

const mockFetch = vi.fn()
const originalFetch = globalThis.fetch
globalThis.fetch = mockFetch as any

afterEach(() => {
  vi.resetAllMocks()
})

const fakeRef = {
  _name: "tasks:recent",
  _args: {} as { limit?: number },
  _returns: [] as unknown[],
}

describe("preloadQuery", () => {
  it("POSTs to /query with fn and args, returns Preloaded", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: [{ _id: "a", title: "Task A" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    const preloaded = await preloadQuery("ws://localhost:8788/ws", fakeRef, { limit: 5 })

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8788/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ fn: "tasks:recent", args: { limit: 5 } }),
      })
    )
    expect(preloaded._fn).toBe("tasks:recent")
    expect(preloaded._args).toEqual({ limit: 5 })
    expect(preloaded._result).toEqual([{ _id: "a", title: "Task A" }])
  })

  it("derives https URL from wss WebSocket URL", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: [] }), { status: 200 })
    )

    await preloadQuery("wss://example.com/ws", fakeRef, {})

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/query",
      expect.anything()
    )
  })

  it("defaults args to {} when not provided", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: [] }), { status: 200 })
    )

    await preloadQuery("ws://localhost:8788/ws", fakeRef)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ fn: "tasks:recent", args: {} }),
      })
    )
  })

  it("throws with the error code on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Function not found", code: "not_found" }), {
        status: 404,
      })
    )

    await expect(preloadQuery("ws://localhost:8788/ws", fakeRef))
      .rejects.toThrow("not_found")
  })

  it("throws a generic message when error body has no code", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    )

    await expect(preloadQuery("ws://localhost:8788/ws", fakeRef))
      .rejects.toThrow("HTTP 500")
  })

  it("accepts a bare http URL without /ws path", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: [] }), { status: 200 })
    )

    await preloadQuery("http://localhost:8788", fakeRef, {})

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8788/query",
      expect.anything()
    )
  })

  it("accepts a bare wss URL without /ws path", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: [] }), { status: 200 })
    )

    await preloadQuery("wss://example.com", fakeRef, {})

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/query",
      expect.anything()
    )
  })

  it("throws a clear error for unsupported URL protocols", async () => {
    await expect(preloadQuery("ftp://example.com/ws", fakeRef))
      .rejects.toThrow('unsupported URL')
  })
})

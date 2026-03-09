import { describe, it, expect, vi } from "vitest"
import { ErrorCode, errorMessage, sendError } from "./errors"

describe("ErrorCode", () => {
  it("defines expected codes", () => {
    expect(ErrorCode.EXECUTION_ERROR).toBe("execution_error")
    expect(ErrorCode.CONFLICT).toBe("conflict")
    expect(ErrorCode.FORBIDDEN).toBe("forbidden")
    expect(ErrorCode.RATE_LIMITED).toBe("rate_limited")
    expect(ErrorCode.NOT_FOUND).toBe("not_found")
  })
})

describe("errorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
  })

  it("returns 'Unknown error' for non-Error values", () => {
    expect(errorMessage("string error")).toBe("Unknown error")
    expect(errorMessage(42)).toBe("Unknown error")
    expect(errorMessage(null)).toBe("Unknown error")
    expect(errorMessage(undefined)).toBe("Unknown error")
  })
})

describe("sendError", () => {
  it("sends JSON error message over WebSocket", () => {
    const ws = { send: vi.fn() } as unknown as WebSocket
    sendError(ws, "req-1", ErrorCode.EXECUTION_ERROR, "Something failed")

    const sent = JSON.parse((ws.send as any).mock.calls[0][0] as string)
    expect(sent).toEqual({
      type: "error",
      id: "req-1",
      code: "execution_error",
      message: "Something failed",
    })
  })

  it("sends undefined id when not provided", () => {
    const ws = { send: vi.fn() } as unknown as WebSocket
    sendError(ws, undefined, ErrorCode.NOT_FOUND, "Not found")

    const sent = JSON.parse((ws.send as any).mock.calls[0][0] as string)
    expect(sent.type).toBe("error")
    expect(sent.id).toBeUndefined()
    expect(sent.code).toBe("not_found")
  })
})

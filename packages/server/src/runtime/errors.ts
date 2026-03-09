import type { ServerMessage } from "@zeroback/values";

/** Standard error codes used across WebSocket and HTTP responses. */
export const ErrorCode = {
  EXECUTION_ERROR: "execution_error",
  CONFLICT: "conflict",
  FORBIDDEN: "forbidden",
  RATE_LIMITED: "rate_limited",
  NOT_FOUND: "not_found",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Extract a human-readable message from an unknown caught error. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

/** Send a typed error message over a WebSocket. */
export function sendError(ws: WebSocket, id: string | undefined, code: ErrorCode, message: string): void {
  ws.send(JSON.stringify({ type: "error", id, code, message } as ServerMessage));
}

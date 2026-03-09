/** Standard error codes used across WebSocket and HTTP responses. */
export const ErrorCode = {
    EXECUTION_ERROR: "execution_error",
    CONFLICT: "conflict",
    FORBIDDEN: "forbidden",
    RATE_LIMITED: "rate_limited",
    NOT_FOUND: "not_found",
};
/** Extract a human-readable message from an unknown caught error. */
export function errorMessage(e) {
    return e instanceof Error ? e.message : "Unknown error";
}
/** Send a typed error message over a WebSocket. */
export function sendError(ws, id, code, message) {
    ws.send(JSON.stringify({ type: "error", id, code, message }));
}
//# sourceMappingURL=errors.js.map
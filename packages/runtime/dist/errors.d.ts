/** Standard error codes used across WebSocket and HTTP responses. */
export declare const ErrorCode: {
    readonly EXECUTION_ERROR: "execution_error";
    readonly CONFLICT: "conflict";
    readonly FORBIDDEN: "forbidden";
    readonly RATE_LIMITED: "rate_limited";
    readonly NOT_FOUND: "not_found";
};
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
/** Extract a human-readable message from an unknown caught error. */
export declare function errorMessage(e: unknown): string;
/** Send a typed error message over a WebSocket. */
export declare function sendError(ws: WebSocket, id: string | undefined, code: ErrorCode, message: string): void;
//# sourceMappingURL=errors.d.ts.map
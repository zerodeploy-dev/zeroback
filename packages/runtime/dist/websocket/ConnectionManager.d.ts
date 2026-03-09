export declare class ConnectionManager {
    private connections;
    private connectionIds;
    /** Per-connection sliding window rate limiter: [timestamps of recent messages] */
    private rateLimitWindows;
    static readonly MAX_CONNECTIONS = 1000;
    static readonly RATE_LIMIT_WINDOW_MS = 1000;
    static readonly RATE_LIMIT_MAX_MESSAGES = 50;
    add(ws: WebSocket, connectionId: string): void;
    get(ws: WebSocket): string | undefined;
    getById(connectionId: string): WebSocket | undefined;
    remove(ws: WebSocket): void;
    removeById(connectionId: string): void;
    size(): number;
    isFull(): boolean;
    /**
     * Check if a message from this connection should be allowed.
     * Returns true if within rate limit, false if exceeded.
     */
    checkRateLimit(connectionId: string): boolean;
    getAll(): WebSocket[];
}
//# sourceMappingURL=ConnectionManager.d.ts.map
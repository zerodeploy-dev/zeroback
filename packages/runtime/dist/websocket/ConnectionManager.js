export class ConnectionManager {
    connections = new Map();
    connectionIds = new Map();
    /** Per-connection sliding window rate limiter: [timestamps of recent messages] */
    rateLimitWindows = new Map();
    static MAX_CONNECTIONS = 1_000;
    static RATE_LIMIT_WINDOW_MS = 1_000;
    static RATE_LIMIT_MAX_MESSAGES = 50;
    add(ws, connectionId) {
        this.connections.set(ws, connectionId);
        this.connectionIds.set(connectionId, ws);
        this.rateLimitWindows.set(connectionId, []);
    }
    get(ws) {
        return this.connections.get(ws);
    }
    getById(connectionId) {
        return this.connectionIds.get(connectionId);
    }
    remove(ws) {
        const id = this.connections.get(ws);
        if (id) {
            this.connectionIds.delete(id);
            this.rateLimitWindows.delete(id);
        }
        this.connections.delete(ws);
    }
    removeById(connectionId) {
        const ws = this.connectionIds.get(connectionId);
        if (ws) {
            this.connections.delete(ws);
        }
        this.connectionIds.delete(connectionId);
        this.rateLimitWindows.delete(connectionId);
    }
    size() {
        return this.connections.size;
    }
    isFull() {
        return this.connections.size >= ConnectionManager.MAX_CONNECTIONS;
    }
    /**
     * Check if a message from this connection should be allowed.
     * Returns true if within rate limit, false if exceeded.
     */
    checkRateLimit(connectionId) {
        const window = this.rateLimitWindows.get(connectionId);
        if (!window)
            return false;
        const now = Date.now();
        const cutoff = now - ConnectionManager.RATE_LIMIT_WINDOW_MS;
        // Remove expired entries
        while (window.length > 0 && window[0] <= cutoff) {
            window.shift();
        }
        if (window.length >= ConnectionManager.RATE_LIMIT_MAX_MESSAGES) {
            return false;
        }
        window.push(now);
        return true;
    }
    getAll() {
        return Array.from(this.connections.keys());
    }
}
//# sourceMappingURL=ConnectionManager.js.map
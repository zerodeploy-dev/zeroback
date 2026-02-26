export class ConnectionManager {
  private connections = new Map<WebSocket, string>();
  private connectionIds = new Map<string, WebSocket>();

  /** Per-connection sliding window rate limiter: [timestamps of recent messages] */
  private rateLimitWindows = new Map<string, number[]>();

  static readonly MAX_CONNECTIONS = 100;
  static readonly RATE_LIMIT_WINDOW_MS = 1_000;
  static readonly RATE_LIMIT_MAX_MESSAGES = 50;

  add(ws: WebSocket, connectionId: string): void {
    this.connections.set(ws, connectionId);
    this.connectionIds.set(connectionId, ws);
    this.rateLimitWindows.set(connectionId, []);
  }

  get(ws: WebSocket): string | undefined {
    return this.connections.get(ws);
  }

  getById(connectionId: string): WebSocket | undefined {
    return this.connectionIds.get(connectionId);
  }

  remove(ws: WebSocket): void {
    const id = this.connections.get(ws);
    if (id) {
      this.connectionIds.delete(id);
      this.rateLimitWindows.delete(id);
    }
    this.connections.delete(ws);
  }

  removeById(connectionId: string): void {
    const ws = this.connectionIds.get(connectionId);
    if (ws) {
      this.connections.delete(ws);
    }
    this.connectionIds.delete(connectionId);
    this.rateLimitWindows.delete(connectionId);
  }

  size(): number {
    return this.connections.size;
  }

  isFull(): boolean {
    return this.connections.size >= ConnectionManager.MAX_CONNECTIONS;
  }

  /**
   * Check if a message from this connection should be allowed.
   * Returns true if within rate limit, false if exceeded.
   */
  checkRateLimit(connectionId: string): boolean {
    const window = this.rateLimitWindows.get(connectionId);
    if (!window) return false;

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

  getAll(): WebSocket[] {
    return Array.from(this.connections.keys());
  }
}

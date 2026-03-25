import type { BaseClient, ConnectionState } from "./BaseClient.js"
import { QueryStore } from "./QueryStore.js"
import type { QueryKey, LocalStore } from "./QueryStore.js"

export interface ZerobackHttpClientOptions {
  /** Request timeout in milliseconds. Default: 30000 (30s). */
  requestTimeoutMs?: number
}

/**
 * HTTP-based Zeroback client for D1 mode.
 * No WebSocket, no realtime subscriptions — queries are fetched via HTTP
 * and refetched after mutations.
 *
 * Implements the same BaseClient interface as ZerobackClient so React hooks
 * work identically with either client.
 */
export class ZerobackHttpClient implements BaseClient {
  private url: string
  private requestTimeoutMs: number
  private closed = false
  private _connectionState: ConnectionState = "connected"
  private connectionListeners = new Set<(state: ConnectionState) => void>()

  /** Centralized query result cache with optimistic update support. */
  readonly queryStore = new QueryStore()

  /** Active query subscriptions — tracked for post-mutation refetching. */
  private activeQueries = new Map<string, { fnName: string; args: unknown; refCount: number }>()

  /** Sequential mutation queue — ensures mutations execute one at a time in order. */
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(url: string, options?: ZerobackHttpClientOptions) {
    // Convert WebSocket URLs to HTTP if needed
    this.url = url.replace(/^ws(s?):/, "http$1:")
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 30_000
  }

  get connectionState(): ConnectionState {
    return this._connectionState
  }

  onConnectionChange(listener: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState === state) return
    this._connectionState = state
    for (const listener of this.connectionListeners) {
      listener(state)
    }
  }

  hasServerResult(key: QueryKey): boolean {
    return this.queryStore.hasServerConfirmation(key)
  }

  /**
   * Subscribe to a query. Fetches the result via HTTP and stores it.
   * Returns an unsubscribe function.
   */
  subscribe(fnName: string, args: unknown, _callback?: (data: unknown) => void): () => void {
    const key = QueryStore.makeKey(fnName, args)

    // Track active query
    const existing = this.activeQueries.get(key)
    if (existing) {
      existing.refCount++
    } else {
      this.activeQueries.set(key, { fnName, args, refCount: 1 })
    }

    // Fetch the query result
    this.fetchQuery(fnName, args).catch(() => {
      // Fetch failed — connection may be down
    })

    return () => {
      const entry = this.activeQueries.get(key)
      if (entry) {
        entry.refCount--
        if (entry.refCount <= 0) {
          this.activeQueries.delete(key)
        }
      }
    }
  }

  watchQuery(key: QueryKey, listener: () => void): () => void {
    return this.queryStore.subscribe(key, listener)
  }

  getQueryResult(key: QueryKey): unknown | undefined {
    return this.queryStore.getResult(key)
  }

  mutation(
    fnName: string,
    args: unknown,
    opts?: { optimisticUpdate?: (store: LocalStore) => void },
  ): Promise<unknown> {
    const id = crypto.randomUUID()

    // Apply optimistic update immediately
    if (opts?.optimisticUpdate) {
      this.queryStore.addLayer(id, opts.optimisticUpdate)
    }

    // Chain onto the mutation queue so mutations execute sequentially
    const result = this.mutationQueue.then(async () => {
      try {
        const res = await this.httpPost("/api/mutation", { fn: fnName, args })
        // After mutation succeeds, refetch all active queries
        await this.refetchActiveQueries()
        return res
      } finally {
        if (opts?.optimisticUpdate) {
          this.queryStore.removeLayer(id)
        }
      }
    })

    // Update the queue — always resolve so subsequent mutations aren't blocked by failures
    this.mutationQueue = result.then(() => {}, () => {})

    return result
  }

  async action(fnName: string, args: unknown): Promise<unknown> {
    return this.httpPost("/api/action", { fn: fnName, args })
  }

  close(): void {
    this.closed = true
    this.activeQueries.clear()
    this.setConnectionState("disconnected")
  }

  // -- Internal --

  private async fetchQuery(fnName: string, args: unknown): Promise<void> {
    try {
      const result = await this.httpPost("/api/query", { fn: fnName, args })
      const key = QueryStore.makeKey(fnName, args)
      this.queryStore.setServerResult(key, result)
      this.setConnectionState("connected")
    } catch {
      this.setConnectionState("disconnected")
    }
  }

  private async refetchActiveQueries(): Promise<void> {
    const fetches = Array.from(this.activeQueries.values()).map(({ fnName, args }) =>
      this.fetchQuery(fnName, args)
    )
    await Promise.all(fetches)
  }

  private async httpPost(path: string, body: unknown): Promise<unknown> {
    if (this.closed) throw new Error("Client is closed")

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const response = await fetch(`${this.url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const json = await response.json() as { success: boolean; result?: unknown; error?: string }

      if (!json.success) {
        throw new Error(json.error ?? "Request failed")
      }

      return json.result
    } finally {
      clearTimeout(timeout)
    }
  }
}

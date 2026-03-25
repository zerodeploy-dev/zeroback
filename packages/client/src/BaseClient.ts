import type { QueryKey, LocalStore } from "./QueryStore.js"

export type ConnectionState = "connecting" | "connected" | "disconnected"

/**
 * Common client interface consumed by React hooks and other integrations.
 * Both ZerobackClient (WebSocket/realtime) and ZerobackHttpClient (HTTP/polling)
 * implement this interface.
 */
export interface BaseClient {
  /** Subscribe to a query. Returns an unsubscribe function. */
  subscribe(fnName: string, args: unknown, callback?: (data: unknown) => void): () => void

  /** Watch a query key for changes in the store. Returns an unsubscribe function. */
  watchQuery(key: QueryKey, listener: () => void): () => void

  /** Get the current result for a query key (with optimistic updates applied). */
  getQueryResult(key: QueryKey): unknown | undefined

  /** Check if the server has confirmed the result for a query key. */
  hasServerResult(key: QueryKey): boolean

  /** Execute a mutation. */
  mutation(
    fnName: string,
    args: unknown,
    opts?: { optimisticUpdate?: (store: LocalStore) => void },
  ): Promise<unknown>

  /** Execute an action. */
  action(fnName: string, args: unknown): Promise<unknown>

  /** Current connection state. */
  readonly connectionState: ConnectionState

  /** Listen for connection state changes. Returns an unsubscribe function. */
  onConnectionChange(listener: (state: ConnectionState) => void): () => void

  /** Close the client and clean up resources. */
  close(): void
}

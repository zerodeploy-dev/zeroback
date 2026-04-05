---
title: Client
description: Type-safe WebSocket client with auto-reconnect, optimistic updates, and offline persistence.
---

The `@zeroback/client` package provides `ZerobackClient` — a WebSocket-based client for connecting to your Zeroback backend from the browser or any JavaScript environment.

## Installation

```bash
npm install @zeroback/client
```

## ZerobackClient

### Constructor

```ts
import { ZerobackClient } from "@zeroback/client";

const client = new ZerobackClient(url: string, options?: ZerobackClientOptions);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | WebSocket URL of your Zeroback backend |
| `options` | `ZerobackClientOptions` | Optional configuration |

### `ZerobackClientOptions`

```ts
interface ZerobackClientOptions {
  persistence?: boolean | PersistenceAdapter;
  maxCacheAge?: number;
  schemaVersion?: string;
  backoff?: BackoffOptions;
  heartbeatIntervalMs?: number;
  requestTimeoutMs?: number;
  auth?: boolean;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `persistence` | `boolean \| PersistenceAdapter` | `undefined` (disabled) | Enable IndexedDB caching. Pass `true` for the built-in adapter, or a custom `PersistenceAdapter`. |
| `maxCacheAge` | `number` | `604800000` (7 days) | Maximum cache age in milliseconds. Entries older than this are discarded on hydration. |
| `schemaVersion` | `string` | `undefined` | When changed, the entire cache is cleared. Use this to invalidate stale data after schema changes. |
| `backoff` | `BackoffOptions` | See below | Configure reconnection backoff behavior. |
| `heartbeatIntervalMs` | `number` | `30000` (30s) | How often the client sends a ping to keep the connection alive. |
| `requestTimeoutMs` | `number` | `60000` (60s) | How long to wait for a mutation/action response before timing out. |
| `auth` | `boolean` | `undefined` (disabled) | Enable the `client.auth` namespace for built-in authentication. See [Authentication](/authentication). |

#### `BackoffOptions`

```ts
interface BackoffOptions {
  baseMs?: number;       // Default: 1000
  maxMs?: number;        // Default: 30000
  maxAttempts?: number;  // Default: Infinity
}
```

When persistence is **disabled** (default), the client connects eagerly on construction.
When persistence is **enabled**, you must call `client.init()` before using the client.

## Methods

### `client.init()`

Initialize the client with persistence. Hydrates cached data from IndexedDB, connects the WebSocket, and replays any offline mutations.

```ts
await client.init(): Promise<void>
```

**Only needed when `persistence` is enabled.** Without persistence, the client connects automatically on construction.

```ts
const client = new ZerobackClient(url, { persistence: true });
await client.init(); // hydrate cache, connect, replay offline mutations
```

### `client.subscribe(fnName, args, callback?)`

Subscribe to a query. The server pushes updates whenever the query result changes.

```ts
client.subscribe(
  fnName: string,
  args: unknown,
  callback?: (data: unknown) => void
): () => void
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fnName` | `string` | Function name (e.g., `"tasks:listByProject"`) |
| `args` | `unknown` | Arguments to pass to the query |
| `callback` | `(data: unknown) => void` | Optional callback invoked on every update |

**Returns:** An unsubscribe function. Call it to stop the subscription.

```ts
const unsubscribe = client.subscribe("tasks:listByProject", { projectId: "proj123" });
// ... later
unsubscribe();
```

### `client.watchQuery(key, listener)`

Watch for changes to a specific query key in the centralized store. Used internally by React hooks via `useSyncExternalStore`.

```ts
client.watchQuery(key: QueryKey, listener: () => void): () => void
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | `QueryKey` | Query key from `QueryStore.makeKey()` |
| `listener` | `() => void` | Called when the query result changes |

**Returns:** An unsubscribe function.

### `client.getQueryResult(key)`

Get the current result for a query key (merged base + optimistic update layers).

```ts
client.getQueryResult(key: QueryKey): unknown | undefined
```

Returns `undefined` if no result is available yet.

### `client.hasServerResult(key)`

Whether this query key has been confirmed by the server (not just loaded from the persistence cache).

```ts
client.hasServerResult(key: QueryKey): boolean
```

### `client.mutation(fnName, args, opts?)`

Execute a mutation. Mutations are queued and execute sequentially in order.

```ts
client.mutation(
  fnName: string,
  args: unknown,
  opts?: { optimisticUpdate?: (store: LocalStore) => void }
): Promise<unknown>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fnName` | `string` | Mutation function name |
| `args` | `unknown` | Arguments to pass |
| `opts.optimisticUpdate` | `(store: LocalStore) => void` | Optional callback to modify local query results immediately |

**Returns:** The mutation's return value.

#### Optimistic Updates

Optimistic updates modify local query results immediately, before the server confirms the mutation. The optimistic layer is removed once the server responds.

```ts
await client.mutation("tasks:create", { title: "New task", ... }, {
  optimisticUpdate: (store) => {
    const current = store.getQuery("tasks:listByProject", { projectId: "proj123" });
    if (Array.isArray(current)) {
      store.setQuery("tasks:listByProject", { projectId: "proj123" }, [
        { title: "New task", _id: "temp", _creationTime: Date.now() },
        ...current,
      ]);
    }
  },
});
```

#### `LocalStore`

```ts
interface LocalStore {
  getQuery(ref: { _name: string } | string, args?: unknown): unknown | undefined;
  setQuery(ref: { _name: string } | string, args: unknown, value: unknown): void;
}
```

| Method | Description |
|--------|-------------|
| `getQuery(ref, args?)` | Read the current result for a query. `ref` can be a function reference or a string name. |
| `setQuery(ref, args, value)` | Set the local result for a query. |

### `client.action(fnName, args)`

Execute an action.

```ts
client.action(fnName: string, args: unknown): Promise<unknown>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fnName` | `string` | Action function name |
| `args` | `unknown` | Arguments to pass |

**Returns:** The action's return value.

### `client.onConnectionChange(listener)`

Listen for connection state changes. The listener is called immediately with the current state when registered, so late subscribers don't miss the initial state.

```ts
client.onConnectionChange(listener: (state: ConnectionState) => void): () => void
```

**Returns:** An unsubscribe function.

### `client.close()`

Close the WebSocket connection and clean up.

```ts
client.close(): void
```

## Properties

### `client.connectionState`

The current connection state.

```ts
client.connectionState: ConnectionState
```

```ts
type ConnectionState = "connecting" | "connected" | "disconnected";
```

| State | Description |
|-------|-------------|
| `"connecting"` | WebSocket is being established |
| `"connected"` | Connected and ready |
| `"disconnected"` | Not connected (will auto-reconnect unless `close()` was called) |

### `client.queryStore`

The centralized query result cache (read-only access).

```ts
client.queryStore: QueryStore
```

#### `QueryStore.makeKey(fnName, args)`

Create a deterministic cache key from a function name and arguments.

```ts
static makeKey(fnName: string, args: unknown): string
```

## Connection Behavior

- **Eager connect:** When persistence is disabled, the client opens a WebSocket connection immediately on construction — no subscription or send is needed to trigger it.
- **Auto-reconnect:** The client automatically reconnects with exponential backoff (1s base, 30s max) when disconnected. By default, retries are unlimited (`maxAttempts: Infinity`).
- **Message queuing:** Messages sent while disconnected are queued and flushed on reconnect.
- **Re-subscribe on reconnect:** All active subscriptions are automatically re-established.
- **Server reset handling:** If the server loses subscription state (e.g., after hibernation), the client re-subscribes all active queries.

## Persistence

When enabled, the client caches query results in IndexedDB for instant display on subsequent page loads.

```ts
const client = new ZerobackClient("wss://example.com/ws", {
  persistence: true,      // Use built-in IndexedDB adapter
  maxCacheAge: 86400000,  // 1 day cache
  schemaVersion: "v2",    // Clear cache on schema change
});
await client.init();
```

### Custom Persistence Adapter

Implement the `PersistenceAdapter` interface for custom storage backends:

```ts
interface PersistenceAdapter {
  getAll(): Promise<Map<string, CachedEntry>>;
  set(key: string, entry: CachedEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

interface CachedEntry {
  result: unknown;
  timestamp: number;
}
```

### Offline Mutation Replay

When persistence is enabled, mutations are persisted to IndexedDB before being sent. If the client disconnects before the server confirms, the mutations are replayed on the next `init()` call.

## SSR — `preloadQuery`

`preloadQuery` fetches a query result over HTTP (no WebSocket) for use during server-side rendering. Import it from `@zeroback/client` and call it in your server-side loader. Pass the result to `usePreloadedQuery` in the client component.

See the [React Hooks — SSR](/react#ssr--server-side-rendering) guide for the full pattern and a TanStack Start example.

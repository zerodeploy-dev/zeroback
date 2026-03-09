---
title: React
description: React hooks for real-time queries, mutations, actions, and paginated data.
---

The `@zeroback/react` package provides React hooks for building real-time UIs with Zeroback.

## Installation

```bash
npm install @zeroback/react
```

## Setup

Wrap your app with `ZerobackProvider` and pass a `ZerobackClient` instance:

```tsx
import { ZerobackClient, ZerobackProvider } from "@zeroback/react";

const client = new ZerobackClient("ws://localhost:8788/ws");

function App() {
  return (
    <ZerobackProvider client={client}>
      <MyApp />
    </ZerobackProvider>
  );
}
```

### With Persistence

```tsx
const client = new ZerobackClient("wss://example.com/ws", {
  persistence: true,
  schemaVersion: "v1",
});

// Must call init() before rendering when persistence is enabled
await client.init();

function App() {
  return (
    <ZerobackProvider client={client}>
      <MyApp />
    </ZerobackProvider>
  );
}
```

## `ZerobackProvider`

React context provider that makes the `ZerobackClient` available to all hooks.

```tsx
function ZerobackProvider({ children, client }: ZerobackProviderProps): JSX.Element
```

| Prop | Type | Description |
|------|------|-------------|
| `children` | `React.ReactNode` | Child components |
| `client` | `ZerobackClient` | A `ZerobackClient` instance from `@zeroback/react` |

## `useQuery(ref, args?)`

Subscribe to a query with real-time updates.

```ts
function useQuery<Ref extends FunctionReference<"query">>(
  ref: Ref,
  args?: Ref["_args"]
): Ref["_returns"] | undefined
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ref` | `FunctionReference<"query">` | A query reference from `api.*` |
| `args` | `Ref["_args"]` | Arguments to pass. Defaults to `{}`. |

**Returns:** The query result, or `undefined` while loading.

- Automatically subscribes via WebSocket on mount and unsubscribes on unmount.
- Only re-renders when this specific query's result changes (granular via `useSyncExternalStore`).
- Re-subscribes when `ref` or `args` change.

```tsx
import { api } from "../zeroback/_generated/api";
import { useQuery } from "@zeroback/react";

function TaskList({ projectId }: { projectId: string }) {
  const tasks = useQuery(api.tasks.listByProject, { projectId });

  if (tasks === undefined) return <div>Loading...</div>;

  return (
    <ul>
      {tasks.map((task) => (
        <li key={task._id}>{task.title}</li>
      ))}
    </ul>
  );
}
```

## `useQueryWithStatus(ref, args?)`

Like `useQuery` but returns additional loading/staleness status.

```ts
function useQueryWithStatus<Ref extends FunctionReference<"query">>(
  ref: Ref,
  args?: Ref["_args"]
): { data: Ref["_returns"] | undefined; isStale: boolean; isLoading: boolean }
```

**Returns:**

| Field | Type | Description |
|-------|------|-------------|
| `data` | `Ref["_returns"] \| undefined` | The query result, or `undefined` while loading |
| `isLoading` | `boolean` | `true` when `data` is `undefined` |
| `isStale` | `boolean` | `true` when data exists but hasn't been confirmed by the server (e.g., loaded from persistence cache) |

Useful with persistence enabled — you can show cached data immediately while indicating it may be stale:

```tsx
function TaskList({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading, isStale } = useQueryWithStatus(
    api.tasks.listByProject,
    { projectId }
  );

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      {isStale && <span>Updating...</span>}
      <ul>
        {tasks.map((task) => (
          <li key={task._id}>{task.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

## `useMutation(ref, opts?)`

Returns a function to execute a mutation.

```ts
function useMutation<Ref extends FunctionReference<"mutation">>(
  ref: Ref,
  opts?: {
    optimisticUpdate?: (store: LocalStore, args: Ref["_args"]) => void;
  }
): (args: Ref["_args"]) => Promise<Ref["_returns"]>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ref` | `FunctionReference<"mutation">` | A mutation reference from `api.*` |
| `opts.optimisticUpdate` | `(store: LocalStore, args) => void` | Optional: modify local query results immediately before the server confirms |

**Returns:** An async function that executes the mutation when called.

```tsx
import { api } from "../zeroback/_generated/api";
import { useMutation } from "@zeroback/react";

function CreateTask({ projectId }: { projectId: string }) {
  const createTask = useMutation(api.tasks.create);

  const handleCreate = async () => {
    await createTask({
      title: "New task",
      status: "todo",
      priority: "medium",
      projectId,
    });
  };

  return <button onClick={handleCreate}>Create Task</button>;
}
```

### With Optimistic Update

```tsx
const createTask = useMutation(api.tasks.create, {
  optimisticUpdate: (store, args) => {
    const current = store.getQuery(api.tasks.listByProject, {
      projectId: args.projectId,
    });
    if (Array.isArray(current)) {
      store.setQuery(api.tasks.listByProject, { projectId: args.projectId }, [
        { ...args, _id: "temp", _creationTime: Date.now() },
        ...current,
      ]);
    }
  },
});
```

The optimistic update layer is applied immediately and removed once the server responds (the real server result will replace it).

## `useAction(ref)`

Returns a function to execute an action.

```ts
function useAction<Ref extends FunctionReference<"action">>(
  ref: Ref
): (args: Ref["_args"]) => Promise<Ref["_returns"]>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ref` | `FunctionReference<"action">` | An action reference from `api.*` |

**Returns:** An async function that executes the action when called.

```tsx
const doAction = useAction(api.tasks.createViaAction);

const result = await doAction({
  title: "New task",
  status: "todo",
  priority: "medium",
  projectId: "proj123",
});
```

## `usePaginatedQuery(ref, args, opts)`

Load paginated data with a `loadMore` function. Each page is independently subscribed for real-time updates.

```ts
function usePaginatedQuery<Ref extends FunctionReference<"query">>(
  ref: Ref,
  args: Omit<Ref["_args"], "cursor" | "numItems">,
  opts: { initialNumItems: number }
): UsePaginatedQueryResult<any>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ref` | `FunctionReference<"query">` | A paginated query reference (must return `PaginationResult`) |
| `args` | `Omit<Args, "cursor" \| "numItems">` | Stable query arguments (without pagination params) |
| `opts.initialNumItems` | `number` | Number of items to fetch for the first page |

**Returns:**

```ts
type UsePaginatedQueryResult<T> = {
  results: T[];
  status: "LoadingFirstPage" | "CanLoadMore" | "Exhausted";
  loadMore: (numItems: number) => void;
};
```

| Field | Type | Description |
|-------|------|-------------|
| `results` | `T[]` | All loaded results, flattened across all pages |
| `status` | `string` | Current pagination state |
| `loadMore` | `(numItems: number) => void` | Call to load the next page |

**Status values:**

| Status | Description |
|--------|-------------|
| `"LoadingFirstPage"` | No data received yet |
| `"CanLoadMore"` | Data loaded, more pages available |
| `"Exhausted"` | All data loaded, no more pages |

Automatically resets when `args` change.

### Server-Side Paginated Query

The query function must accept `cursor` and `numItems` args and return a `PaginationResult`:

```ts
// zeroback/tasks.ts
export const listPaginated = query({
  args: {
    projectId: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: args.numItems ?? 10 });
  },
});
```

### Client Usage

```tsx
import { api } from "../zeroback/_generated/api";
import { usePaginatedQuery } from "@zeroback/react";

function TaskList({ projectId }: { projectId: string }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.tasks.listPaginated,
    { projectId },
    { initialNumItems: 20 }
  );

  return (
    <div>
      {status === "LoadingFirstPage" && <div>Loading...</div>}

      <ul>
        {results.map((task) => (
          <li key={task._id}>{task.title}</li>
        ))}
      </ul>

      {status === "CanLoadMore" && (
        <button onClick={() => loadMore(20)}>Load more</button>
      )}

      {status === "Exhausted" && <div>No more tasks</div>}
    </div>
  );
}
```

## `useConnectionState()`

Returns the current WebSocket connection state. Re-renders when the state changes.

```ts
function useConnectionState(): ConnectionState
```

**Returns:** `"connecting" | "connected" | "disconnected"`

```tsx
import { useConnectionState } from "@zeroback/react";

function ConnectionBanner() {
  const state = useConnectionState();

  if (state === "connected") return null;

  return (
    <div className="banner">
      {state === "connecting" ? "Connecting..." : "Disconnected. Reconnecting..."}
    </div>
  );
}
```

## `useZerobackClient()`

Returns the `ZerobackClient` instance from the closest `ZerobackProvider`. Useful for advanced use cases where you need direct client access.

```ts
function useZerobackClient(): ZerobackClient
```

Throws if called outside a `ZerobackProvider`.

```tsx
import { useZerobackClient } from "@zeroback/react";

function AdvancedComponent() {
  const client = useZerobackClient();
  // Direct access to client.subscribe(), client.mutation(), etc.
}
```

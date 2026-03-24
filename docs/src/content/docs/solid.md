---
title: Solid.js
description: Solid.js primitives for real-time queries, mutations, actions, and paginated data.
---

The `@zeroback/solid` package provides Solid.js primitives for building real-time UIs with Zeroback.

## Installation

```bash
npm install @zeroback/solid
```

## Setup

Wrap your app with `ZerobackProvider` and pass a `ZerobackClient` instance:

```tsx
import { ZerobackClient, ZerobackProvider } from "@zeroback/solid";

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

## `createQuery(ref, args?)`

Subscribe to a query with real-time updates. Returns a reactive accessor.

```ts
function createQuery<Ref extends FunctionReference<"query">>(
  ref: Ref,
  argsAccessor?: Accessor<Ref["_args"]> | Ref["_args"],
): Accessor<Ref["_returns"] | undefined>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ref` | `FunctionReference<"query">` | A query reference from `api.*` |
| `argsAccessor` | `Accessor<Args> \| Args` | Arguments — can be a static value or reactive accessor |

**Returns:** A reactive accessor with the query result, or `undefined` while loading.

- Automatically subscribes via WebSocket and unsubscribes on cleanup.
- Re-subscribes when args change.
- Args can be a reactive accessor (e.g., a signal) for dynamic queries.

```tsx
import { api } from "../zeroback/_generated/api";
import { createQuery } from "@zeroback/solid";

function TaskList(props: { projectId: string }) {
  const tasks = createQuery(api.tasks.listByProject, () => ({
    projectId: props.projectId,
  }));

  return (
    <ul>
      <For each={tasks()}>{(task) => <li>{task.title}</li>}</For>
    </ul>
  );
}
```

## `createQueryWithStatus(ref, args?)`

Like `createQuery` but returns additional loading/staleness status as reactive accessors.

```ts
function createQueryWithStatus<Ref extends FunctionReference<"query">>(
  ref: Ref,
  argsAccessor?: Accessor<Ref["_args"]> | Ref["_args"],
): { data: Accessor<Ref["_returns"] | undefined>; isStale: Accessor<boolean>; isLoading: Accessor<boolean> }
```

**Returns:**

| Field | Type | Description |
|-------|------|-------------|
| `data` | `Accessor<Ref["_returns"] \| undefined>` | The query result accessor |
| `isLoading` | `Accessor<boolean>` | `true` when `data()` is `undefined` |
| `isStale` | `Accessor<boolean>` | `true` when data is from persistence cache and hasn't been confirmed by the server |

```tsx
function TaskList(props: { projectId: string }) {
  const { data: tasks, isLoading, isStale } = createQueryWithStatus(
    api.tasks.listByProject,
    () => ({ projectId: props.projectId }),
  );

  return (
    <div>
      <Show when={isLoading()}>Loading...</Show>
      <Show when={isStale()}>
        <span>Updating...</span>
      </Show>
      <ul>
        <For each={tasks()}>{(task) => <li>{task.title}</li>}</For>
      </ul>
    </div>
  );
}
```

## `createMutation(ref, opts?)`

Returns a function to execute a mutation.

```ts
function createMutation<Ref extends FunctionReference<"mutation">>(
  ref: Ref,
  opts?: {
    optimisticUpdate?: (store: LocalStore, args: Ref["_args"]) => void;
  },
): (args: Ref["_args"]) => Promise<Ref["_returns"]>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ref` | `FunctionReference<"mutation">` | A mutation reference from `api.*` |
| `opts.optimisticUpdate` | `(store: LocalStore, args) => void` | Optional: modify local query results immediately before the server confirms |

```tsx
import { createMutation } from "@zeroback/solid";

function CreateTask(props: { projectId: string }) {
  const createTask = createMutation(api.tasks.create);

  const handleCreate = async () => {
    await createTask({
      title: "New task",
      status: "todo",
      priority: "medium",
      projectId: props.projectId,
    });
  };

  return <button onClick={handleCreate}>Create Task</button>;
}
```

### With Optimistic Update

```tsx
const createTask = createMutation(api.tasks.create, {
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

## `createAction(ref)`

Returns a function to execute an action.

```ts
function createAction<Ref extends FunctionReference<"action">>(
  ref: Ref,
): (args: Ref["_args"]) => Promise<Ref["_returns"]>
```

```tsx
const doAction = createAction(api.tasks.createViaAction);

const result = await doAction({
  title: "New task",
  status: "todo",
  priority: "medium",
  projectId: "proj123",
});
```

## `createPaginatedQuery(ref, args, opts)`

Load paginated data with a `loadMore` function. Each page is independently subscribed for real-time updates.

```ts
function createPaginatedQuery<Ref extends FunctionReference<"query">>(
  ref: Ref,
  argsAccessor: Accessor<Omit<Args, "cursor" | "numItems">> | Omit<Args, "cursor" | "numItems">,
  opts: { initialNumItems: number },
): CreatePaginatedQueryResult<any>
```

**Returns:**

| Field | Type | Description |
|-------|------|-------------|
| `results` | `Accessor<T[]>` | All loaded results, flattened across pages |
| `status` | `Accessor<PaginationStatus>` | `"LoadingFirstPage"` \| `"CanLoadMore"` \| `"Exhausted"` |
| `loadMore` | `(numItems: number) => void` | Load the next page |

Automatically resets when args change.

```tsx
import { createPaginatedQuery } from "@zeroback/solid";

function TaskList(props: { projectId: string }) {
  const { results, status, loadMore } = createPaginatedQuery(
    api.tasks.listPaginated,
    () => ({ projectId: props.projectId }),
    { initialNumItems: 20 },
  );

  return (
    <div>
      <Show when={status() === "LoadingFirstPage"}>Loading...</Show>

      <ul>
        <For each={results()}>{(task) => <li>{task.title}</li>}</For>
      </ul>

      <Show when={status() === "CanLoadMore"}>
        <button onClick={() => loadMore(20)}>Load more</button>
      </Show>

      <Show when={status() === "Exhausted"}>No more tasks</Show>
    </div>
  );
}
```

## `createConnectionState()`

Returns a reactive accessor for the current WebSocket connection state.

```ts
function createConnectionState(): Accessor<ConnectionState>
```

**Returns:** `Accessor<"connecting" | "connected" | "disconnected">`

```tsx
import { createConnectionState } from "@zeroback/solid";

function ConnectionBanner() {
  const state = createConnectionState();

  return (
    <Show when={state() !== "connected"}>
      <div class="banner">
        {state() === "connecting" ? "Connecting..." : "Disconnected. Reconnecting..."}
      </div>
    </Show>
  );
}
```

## `useZerobackClient()`

Returns the `ZerobackClient` instance from the closest `ZerobackProvider`. Useful for advanced use cases where you need direct client access.

```ts
function useZerobackClient(): ZerobackClient
```

Throws if called outside a `ZerobackProvider`.

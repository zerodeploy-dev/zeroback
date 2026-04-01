# SSR Query Fetching — Design Spec

**Date:** 2026-04-01
**Status:** Approved

## Overview

Add SSR-safe query pre-fetching to Zeroback following the Convex `preloadQuery` / `usePreloadedQuery` pattern. Enables TanStack Start (and any SSR framework) to fetch query data server-side, pass it to client components, and hydrate without a loading flash — while keeping real-time WebSocket subscriptions after hydration.

No breaking changes. Existing `useQuery` usage is unaffected. Adoption is opt-in per component.

## Architecture

Three pieces, each in an existing package:

### 1. DO: `POST /query` endpoint

New route added to `ZerobackDO.fetch()`:

```
POST /query
Body:     { fn: string, args: unknown }
Response: { result: unknown }
Error:    { error: string, code: string }
```

- Executes the named query at current `latestTs` — one-shot, no subscription created.
- Blocks `isInternal: true` functions with `403` (same guard as WebSocket `handleQuery`).
- Returns `400` if the function is not of type `"query"`.
- Returns `404` if the function is not found.
- No authentication — same trust model as existing WebSocket queries. Auth will be added later for both transports together.

### 2. `@zeroback/client`: `preloadQuery` + `Preloaded<T>`

New file `packages/client/src/preloadQuery.ts`:

```ts
export type Preloaded<Ref extends FunctionReference<"query", any, any>> = {
  _fn: string
  _args: unknown
  _result: Ref["_returns"]
}

export async function preloadQuery<Ref extends FunctionReference<"query", any, any>>(
  deploymentUrl: string,
  ref: Ref,
  args?: Ref["_args"]
): Promise<Preloaded<Ref>>
```

- Plain `fetch` call — no `ZerobackClient`, no WebSocket, no browser APIs.
- Safe to call in Node.js, Edge runtime, or any server environment.
- Throws on non-2xx response (propagates to the loader, handled by the framework error boundary).

Exported from `packages/client/src/index.ts`.

### 3. `@zeroback/react`: `usePreloadedQuery`

New hook added to `packages/react/src/hooks.tsx`:

```ts
function usePreloadedQuery<Ref extends FunctionReference<"query", any, any>>(
  preloaded: Preloaded<Ref>
): Ref["_returns"]
```

- Uses `useContext(ZerobackContext)` directly (not `useZerobackClient()`) so it does not throw when rendered without a `ZerobackProvider` during SSR.
- On render: provides `getServerSnapshot` returning `preloaded._result` — React SSR never sees `undefined`, no hydration mismatch.
- On mount (`useEffect`): seeds the QueryStore with the preloaded result, then calls `client.subscribe(fn, args)` for real-time WebSocket updates. Skipped when `client` is `null` (SSR).
- After hydration: behaves identically to `useQuery` — live updates flow through the existing QueryStore / `useSyncExternalStore` path.

Exported from `packages/react/src/index.ts`.

## Data Flow

### SSR path (server)
```
TanStack Start loader
  → preloadQuery(ZEROBACK_URL, api.tasks.list, {})
    → POST /query  { fn: "tasks:list", args: {} }
      → DO: executes query, returns { result: [...] }
    → returns Preloaded<typeof api.tasks.list>
  → loader returns { preloaded }
```

### Hydration path (client)
```
Component receives preloaded prop from loader
  → usePreloadedQuery(preloaded)
    → getServerSnapshot() → preloaded._result   (SSR render, no undefined)
    → useEffect: queryStore.set(key, preloaded._result)
    → useEffect: client.subscribe(fn, args)      (WebSocket live updates)
```

### Usage example (TanStack Start)
```ts
// route (server-side loader)
export const loader = createServerFn().handler(async () => {
  return { preloaded: await preloadQuery(ZEROBACK_URL, api.tasks.list, {}) }
})

// component
const { preloaded } = useLoaderData()
const tasks = usePreloadedQuery(preloaded)  // never undefined, real-time after hydration
```

## Error Handling

| Scenario | Server response | `preloadQuery` behaviour |
|---|---|---|
| Function not found | `404 { error, code: "NOT_FOUND" }` | throws |
| Function is internal | `403 { error, code: "FORBIDDEN" }` | throws |
| Function is not a query | `400 { error, code: "BAD_REQUEST" }` | throws |
| Function throws | `500 { error, code: "EXECUTION_ERROR" }` | throws |
| Network failure | — | throws (native fetch error) |

Errors propagate to the loader; the SSR framework's error boundary handles them. No special Zeroback error type is introduced.

## Files Changed

| File | Change |
|---|---|
| `packages/server/src/runtime/ZerobackDO.ts` | Add `handleQueryHttp` method + route in `fetch()` |
| `packages/client/src/preloadQuery.ts` | New file — `Preloaded<T>` type + `preloadQuery` function |
| `packages/client/src/index.ts` | Export `preloadQuery` and `Preloaded` |
| `packages/react/src/hooks.tsx` | Add `usePreloadedQuery` hook |
| `packages/react/src/index.ts` | Export `usePreloadedQuery` |

**Not changed:** `workerHandler`, `ZerobackClient`, existing hooks, codegen, CLI.

## Out of Scope

- Authentication (will be added for both HTTP and WebSocket together)
- `preloadMutation` / `preloadAction` (mutations must not run during SSR; actions can use HTTP actions directly)
- Streaming / Suspense integration

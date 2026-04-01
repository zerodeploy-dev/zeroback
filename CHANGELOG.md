# Changelog

All notable changes to Zeroback are documented here.

## [0.0.24] — 2026-04-01

### Added

- **Built-in CORS support** via `createWorkerHandler({ cors: { origin: "..." } })` in `@zeroback/server/runtime`. Handles `OPTIONS` preflights immediately (never forwarded to the Durable Object), injects `Access-Control-Allow-Origin` / `Allow-Methods` / `Allow-Headers` on all responses, and skips CORS headers on WebSocket upgrade responses (status 101) to preserve the handshake. The scaffolded `entry.ts` now uses `createWorkerHandler` with `cors: { origin: "*" }` by default.

- **Branded `Id<T>` type** in `@zeroback/values`. `v.id("posts")` now infers `Id<"posts">` — a distinct type from plain `string` — so `ctx.db.get(args.postId)` resolves the correct document type without a cast. Generated `DataModel` uses `_id: Id<"tableName">` instead of `_id: string`.

- **Two-arg `ctx.db.get(table, id)` overload**: pass a table name and a plain string ID when you don't have a branded `Id<T>` value (e.g. from URL params). `getMany` gains the same `(table, ids[])` overload.

### Fixed

- **`useMutation`, `useAction`, `useConnectionState`, `usePaginatedQuery` SSR safety**: hooks no longer throw `"must be used within a ZerobackProvider"` during server-side render. `useQuery` throws a helpful error directing to `preloadQuery` / `usePreloadedQuery` instead.

- **`preloadQuery` URL normalisation**: accepts HTTP/HTTPS URLs directly, bare WebSocket URLs (`ws://host`), and the full `ws://host/ws` form — all resolve to the correct `POST /query` endpoint.

- **`defineTable` validator at runtime**: `table.validator.json` now correctly reflects the field schema (previously the `v.object(fields)` validator was discarded, breaking runtime introspection).

- **Codegen and bundler skip `*.test.ts` / `*.spec.ts` files**: both `extract.ts` (analysis) and `bundle.ts` (bundler) now skip test files at any nesting depth, preventing test helpers from being included in the generated manifest or bundle.

- **`ZerobackClient` defers WebSocket connection**: constructing a `ZerobackClient` no longer opens a WebSocket immediately, making it safe to instantiate in SSR environments. The connection is established lazily on the first `subscribe()`, `mutation()`, or `action()` call.

## [0.0.23] — 2026-04-01

### Added

- **SSR query fetching** (`preloadQuery` / `usePreloadedQuery`): Fetch query data server-side over HTTP (no WebSocket) and hydrate React components instantly — no loading flash. After hydration, the component seamlessly transitions to a live WebSocket subscription.

  ```ts
  // Server loader (TanStack Start / any SSR framework)
  const preloaded = await preloadQuery(ZEROBACK_URL, api.tasks.list, {})

  // Client component
  const tasks = usePreloadedQuery(preloaded) // never undefined, real-time after hydration
  ```

- **`POST /query` HTTP endpoint** on the Durable Object: one-shot query execution over HTTP. Executes the named query at the current snapshot and returns `{ result }`. Internal functions are blocked (`403`), non-query functions return `400`.

- **`preloadQuery` function** in `@zeroback/client`: plain `fetch`-based helper, safe to call from Node.js, edge runtimes, or any server environment. Takes a deployment URL (`wss://…/ws` or `ws://…/ws`), a typed function reference, and optional args; returns a `Preloaded<Ref>` token.

- **`Preloaded<T>` type** in `@zeroback/client`: opaque token carrying the preloaded result, function name, and args. Pass between server loader and client component.

- **`usePreloadedQuery` hook** in `@zeroback/react`: accepts a `Preloaded<Ref>` token. Returns the preloaded result synchronously (no `undefined` flash), seeds the QueryStore on mount, and subscribes to live WebSocket updates.

- **`BAD_REQUEST` error code** added to `ErrorCode` in `@zeroback/server`.

- **`ZerobackClient.setServerResult(key, result)`** public method: seeds the QueryStore with a server-confirmed result directly (used internally by `usePreloadedQuery`).

## [0.0.22] — initial release

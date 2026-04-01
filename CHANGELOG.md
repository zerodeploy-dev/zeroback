# Changelog

All notable changes to Zeroback are documented here.

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

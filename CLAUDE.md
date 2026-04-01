# Zeroback

Zeroback is an open-source Convex-compatible backend that runs on Cloudflare (Workers + Durable Objects + SQLite). It provides real-time queries, transactional mutations, type-safe codegen, and a React client.

## Repository Structure

Monorepo with Bun workspaces:

```
packages/
  values/     - Validators (v.string(), v.number(), etc.) and core types
  server/     - Server APIs: schema, functions, database, queries, http, crons, storage
  client/     - ZerobackClient: WebSocket client with subscriptions, optimistic updates, persistence. Also exports preloadQuery for SSR.
  react/      - React hooks: useQuery, useMutation, useAction, usePaginatedQuery, usePreloadedQuery
  cli/        - CLI (zeroback init/dev/deploy/codegen)
  solid/      - SolidJS bindings (experimental)
examples/
  task-manager/ - Full example app with schema, functions, http routes, crons
e2e/          - E2E tests (vitest, runs against examples/task-manager)
docs/         - API documentation
```

## Key Architecture

- **Runtime engine** lives in `packages/server/src/runtime/` (published as `@zeroback/server/runtime`). The static `.zeroback/entry.ts` (scaffolded by `init`, user-owned) imports from `zeroback/_generated/manifest.ts` (regenerated on every build) to wire user functions to the runtime.
- **ZerobackDO** (`packages/runtime/src/ZerobackDO.ts`) is the main Durable Object, created via `createZerobackDO(config)`. It handles all state, transactions, subscriptions, and WebSocket connections.
- **Codegen** analyzes user's `zeroback/` directory and generates typed API references, function factories, DataModel types, and a manifest into `zeroback/_generated/`.
- All filters compile to SQL WHERE clauses via `json_extract` for efficiency.
- IDs use TypeID format `"prefix_base32uuidv7"` (e.g., `posts_01h455vb4pex5vsknk084sn02q`). `_creationTime` is derived from the UUIDv7 timestamp. Custom prefixes configurable via `.idPrefix()` on `defineTable`.

## Development

```bash
# Install dependencies
bun install

# Run tests (e2e tests use examples/task-manager as the test project)
bun test

# Type check all packages
bun run typecheck
```

### Testing

- Tests use **Vitest** with a global setup that starts a dev server from `examples/task-manager`.
- E2E tests are in `e2e/zeroback.test.ts`, unit tests in `packages/**/*.test.ts`.
- Tests run sequentially (`fileParallelism: false`) with 30s test timeout and 60s hook timeout.
- The test harness (`e2e/harness.ts`) connects via WebSocket to the local dev server.

## Documentation

- [Schema & Validators](docs/schema.md) — `defineSchema`, `defineTable`, `v.*` validators, indexes, search indexes
- [Functions](docs/functions.md) — `query`, `mutation`, `action`, internal functions, HTTP actions, cron jobs, codegen
- [Database](docs/database.md) — `DatabaseReader`, `DatabaseWriter`, `QueryBuilder`, filters, indexes, pagination, full-text search
- [Client SDK](docs/client.md) — `ZerobackClient`, WebSocket subscriptions, optimistic updates, persistence
- [React Hooks](docs/react.md) — `ZerobackProvider`, `useQuery`, `useMutation`, `useAction`, `usePaginatedQuery`
- [CLI](docs/cli.md) — `zeroback init`, `zeroback dev`, `zeroback deploy`, `zeroback codegen`
- [Scheduling](docs/scheduling.md) — `scheduler.runAfter`, `scheduler.runAt`, `scheduler.cancel`
- [File Storage](docs/storage.md) — `StorageReader`, `StorageWriter`, `StorageActions`, R2 setup
- [How It Works](docs/how-it-works.md) — Real-time subscriptions, OCC, codegen internals
- [Feature Status](docs/feature-status.md) — Implementation status of all features

## Conventions

- TypeScript throughout, ESM (`"type": "module"`)
- Bun as package manager
- Wrangler for Cloudflare Workers CLI
- No semicolons in most files (follow existing style per-file)
- Exports from package entry points (`src/index.ts`) define the public API surface

## Publishing

- **Fixed versioning**: all packages share the same version number. When any package changes, bump all packages to the same new version before publishing.
- Always use `bun publish` (not `npm publish`) — it resolves `workspace:^` to real version numbers in the published tarball.

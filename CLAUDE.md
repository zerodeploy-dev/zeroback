# Zeroback

Zeroback is an open-source Convex-compatible backend that runs on Cloudflare (Workers + Durable Objects + SQLite). It provides real-time queries, transactional mutations, type-safe codegen, and a React client.

## Repository Structure

Monorepo with Bun workspaces:

```
packages/
  values/     - Validators (v.string(), v.number(), etc.) and core types
  server/     - Server APIs: schema, functions, database, queries, http, crons, storage
  client/     - ConvexClient: WebSocket client with subscriptions, optimistic updates, persistence
  react/      - React hooks: useQuery, useMutation, useAction, usePaginatedQuery
  cli/        - CLI (zeroback init/dev/deploy/codegen) and runtime source files
  solid/      - SolidJS bindings (experimental)
examples/
  task-manager/ - Full example app with schema, functions, http routes, crons
e2e/          - E2E tests (vitest, runs against examples/task-manager)
docs/         - API documentation
```

## Key Architecture

- **Runtime files** live in `packages/cli/runtime/src/`. At build time, the CLI copies them into `.zeroback/src/` in the user's project.
- **ZerobackDO** (`packages/cli/runtime/src/ZerobackDO.ts`) is the main Durable Object handling all state, transactions, subscriptions, and WebSocket connections.
- **Codegen** analyzes user's `zeroback/` directory and generates typed API references, function factories, and DataModel types into `zeroback/_generated/`.
- All filters compile to SQL WHERE clauses via `json_extract` for efficiency.
- IDs are ULID-based in `"tableName:ULID"` format. `_creationTime` is derived from the ULID.

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
- [Client SDK](docs/client.md) — `ConvexClient`, WebSocket subscriptions, optimistic updates, persistence
- [React Hooks](docs/react.md) — `ConvexProvider`, `useQuery`, `useMutation`, `useAction`, `usePaginatedQuery`
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

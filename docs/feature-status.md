# Feature Status

## Functions

| Feature | Status |
|---------|--------|
| Queries (`query()` with `ctx.db`) | Implemented |
| Mutations (`mutation()` with `ctx.db`, `ctx.scheduler`) | Implemented |
| Actions (`action()` with `ctx.runQuery`, `ctx.runMutation`, `ctx.scheduler`) | Implemented |
| HTTP Actions (`httpRouter()`, `httpAction()`, route/prefix matching) | Implemented |
| Argument validation (runtime `v` validators) | Implemented |
| Internal functions (`internalQuery`, `internalMutation`, `internalAction`) | Implemented |
| Return value validators | Implemented |
| `ctx.runAction()` in action context | Implemented |

## Database

| Feature | Status |
|---------|--------|
| Document model with `_id` and `_creationTime` | Implemented |
| `db.get(id)` | Implemented |
| `db.getMany(...ids)` | Implemented |
| `db.insert()`, `db.patch()`, `db.replace()`, `db.delete()` | Implemented |
| `db.query(table)` with `.collect()`, `.first()`, `.unique()`, `.take(n)` | Implemented |
| Filter expressions (`eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `and`, `or`, `not`) | Implemented |
| SQL filter pushdown (filters compiled to SQL `WHERE` clauses) | Implemented |
| Secondary indexes (`.withIndex()` with range expressions) | Implemented |
| Compound indexes (multi-field) | Implemented |
| Cursor-based pagination (`.paginate()`) | Implemented |
| Full-text search (`.searchIndex()` + `.search()`) | Implemented |
| Vector search (`ctx.vectorSearch()`) | Not yet |
| Default `by_creation_time` / `by_id` indexes | Implemented |

## Real-Time

| Feature | Status |
|---------|--------|
| WebSocket subscriptions with server push | Implemented |
| Smart invalidation (table + document-level overlap checks) | Implemented |
| Subscription deduplication (same query executed once) | Implemented |
| Diff suppression (no update if result unchanged) | Implemented |
| Batched WebSocket sends (multiple updates in one frame) | Implemented |

## Transactions

| Feature | Status |
|---------|--------|
| Optimistic concurrency control (read/write set tracking) | Implemented |
| Automatic retry on conflict (up to 5 retries) | Implemented |
| Transaction log with periodic pruning | Implemented |

## Scheduling

| Feature | Status |
|---------|--------|
| `scheduler.runAfter(delayMs, fn, args)` | Implemented |
| `scheduler.runAt(timestamp, fn, args)` | Implemented |
| Backed by SQLite + Cloudflare DO Alarms | Implemented |
| `scheduler.cancel(id)` | Implemented |
| Cron jobs (`cronJobs()`, interval/cron expressions, hourly/daily/weekly/monthly) | Implemented |

## Authentication

| Feature | Status |
|---------|--------|
| `ctx.auth.getUserIdentity()` | Not yet |
| JWT / OpenID Connect validation | Not yet |
| Auth provider integrations (Clerk, Auth0, etc.) | Not yet |
| Token refresh on WebSocket connection | Not yet |

## File Storage

| Feature | Status |
|---------|--------|
| `ctx.storage.generateUploadUrl()` | Implemented |
| `ctx.storage.getUrl(storageId)` | Implemented |
| `ctx.storage.getMetadata(storageId)` | Implemented |
| `ctx.storage.store(blob)` / `ctx.storage.delete(id)` | Implemented |
| Cloudflare R2 backend (`ZEROBACK_STORAGE` binding) | Implemented |

## Schema & Validation

| Feature | Status |
|---------|--------|
| `defineSchema()` / `defineTable()` with typed fields | Implemented |
| `v.string()`, `v.number()`, `v.boolean()`, `v.null()` | Implemented |
| `v.id()`, `v.object()`, `v.array()`, `v.optional()` | Implemented |
| `v.union()`, `v.literal()`, `v.any()` | Implemented |
| Runtime schema enforcement on writes | Implemented |
| `v.record()` | Implemented |
| `v.bytes()`, `v.int64()`, `v.float64()` | Implemented |

## Client SDK (`@zeroback/client`)

| Feature | Status |
|---------|--------|
| WebSocket with auto-reconnect and exponential backoff | Implemented |
| Subscription management (subscribe/unsubscribe) | Implemented |
| Mutation and action execution | Implemented |
| Connection state tracking (`connecting`, `connected`, `disconnected`) | Implemented |
| Message queuing while disconnected | Implemented |
| Auto re-subscribe on reconnect / server reset | Implemented |
| Optimistic updates | Implemented |
| Sequential mutation queue (ordered execution) | Implemented |
| Auth token management (`setAuth`) | Not yet |

## React (`@zeroback/react`)

| Feature | Status |
|---------|--------|
| `ZerobackProvider` | Implemented |
| `useQuery(ref, args)` | Implemented |
| `useMutation(ref)` | Implemented |
| `useAction(ref)` | Implemented |
| `useConnectionState()` | Implemented |
| `usePaginatedQuery()` with `loadMore` | Implemented |

## Codegen & Tooling

| Feature | Status |
|---------|--------|
| Generated `api` object (type-safe function references) | Implemented |
| Generated `DataModel` types | Implemented |
| Typed `query` / `mutation` / `action` factories | Implemented |
| `zeroback dev` (watch, codegen, bundle, local server) | Implemented |
| Nested directory function discovery | Implemented |
| Generated `internal` API object | Implemented |
| `zeroback deploy` (codegen + wrangler deploy) | Implemented |
| `zeroback run` (invoke functions from CLI) | Implemented |
| Dashboard web UI | Not yet |

## Infrastructure

| Feature | Status |
|---------|--------|
| Cloudflare Workers + Durable Objects | Implemented |
| SQLite (DO embedded storage) | Implemented |
| DO Hibernation support (WebSocket restore + client re-subscribe) | Implemented |
| Multi-tenant routing (`/t/{slug}/...`) | Implemented |
| Per-connection rate limiting | Implemented |
| Connection limit enforcement | Implemented |

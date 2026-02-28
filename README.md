# Vex

An open-source [Convex](https://convex.dev)-style backend you deploy to your own Cloudflare account. Real-time queries, mutations, type-safe codegen — all running on Cloudflare Workers, Durable Objects, and SQLite.

## Why Vex?

Convex introduced a great developer experience: define your backend as plain TypeScript functions, get real-time subscriptions and a type-safe client for free. Vex brings that same model to Cloudflare's edge infrastructure — giving you full control over your data and deployment.

- **Your Cloudflare account** — data lives in your Durable Objects, not a third-party service
- **Real-time subscriptions** — queries re-run and push updates over WebSocket when data changes
- **Type-safe codegen** — generated `api` object gives you end-to-end type safety from database to UI
- **Optimistic concurrency control** — mutations are checked for conflicts before committing
- **Database indexes** — declare indexes in your schema, query them with `.withIndex()` for efficient lookups
- **Full-text search** — declare search indexes in your schema, query with `.search()` for relevance-ranked results powered by SQLite FTS5
- **Pagination** — built-in cursor-based pagination with `.paginate()`
- **Single Durable Object** — all state, transactions, and WebSocket connections in one place for strong consistency
- **Offline support** — opt-in IndexedDB persistence for instant cached renders, offline reads, and mutation replay

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Define your schema

```ts
// vex/schema.ts
import { defineSchema, defineTable } from "@vex/server";
import { v } from "@vex/values";

export const schema = defineSchema({
  messages: defineTable({
    body: v.string(),
    author: v.string(),
    channel: v.string(),
  })
    .index("by_channel", ["channel"])
    .searchIndex("search_body", { searchField: "body" }),
});
```

### 3. Write your functions

```ts
// vex/messages.ts
import { query, mutation } from "./_generated/server";
import { v } from "@vex/values";

export const list = query({
  args: { channel: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .order("desc")
      .take(50);
  },
});

export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .search("body", args.query)
      .take(10);
  },
});

export const send = mutation({
  args: {
    body: v.string(),
    author: v.string(),
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
  },
});
```

### 4. Use in React

```tsx
import { ConvexProvider, useQuery, useMutation } from "@vex/react";
import { ConvexClient } from "@vex/client";
import { api } from "../vex/_generated/api";

const client = new ConvexClient("ws://localhost:8788/ws");

function Chat() {
  const messages = useQuery(api.messages.list, { channel: "general" });
  const send = useMutation(api.messages.send);

  return (
    <div>
      {messages?.map((msg) => (
        <p key={msg._id}>
          <b>{msg.author}</b>: {msg.body}
        </p>
      ))}
      <button onClick={() => send({ body: "Hello!", author: "Alice", channel: "general" })}>
        Send
      </button>
    </div>
  );
}

function App() {
  return (
    <ConvexProvider client={client}>
      <Chat />
    </ConvexProvider>
  );
}
```

### 5. Enable offline support (optional)

Vex can persist query results to IndexedDB so your app renders instantly from cache on page load, works offline, and replays mutations when reconnected.

```ts
const client = new ConvexClient("ws://localhost:8788/ws", {
  persistence: true,
  schemaVersion: "v1",    // bump on breaking schema changes
});
await client.init(); // hydrate from cache, then connect
```

Use `useQueryWithStatus` for staleness awareness:

```tsx
import { useQueryWithStatus } from "@vex/react";

function TaskList() {
  const { data: tasks, isStale, isLoading } = useQueryWithStatus(api.tasks.list, { projectId });

  if (isLoading) return <p>Loading...</p>;
  return (
    <div>
      {isStale && <span>Showing cached data...</span>}
      {tasks.map((t) => <p key={t._id}>{t.title}</p>)}
    </div>
  );
}
```

How it works:
- **First load** — normal loading, data cached to IndexedDB on arrival
- **Subsequent loads** — data renders instantly from cache (`isStale=true`), then updates when the server confirms (`isStale=false`)
- **Offline** — cached data stays visible, mutations queue locally, and replay automatically on reconnect
- **Schema versioning** — change `schemaVersion` to clear stale caches after breaking schema changes
- **Cache eviction** — entries older than 7 days are discarded (configurable via `maxCacheAge`)

Without persistence (the default), everything works exactly as before — no changes needed.

### 6. Start development

```bash
vex dev
```

This will:

1. Analyze your `vex/` directory for schema and function definitions
2. Generate type-safe code in `vex/_generated/`
3. Start a local Cloudflare Worker with Durable Objects
4. Watch for changes and rebuild automatically

## Functions

Vex has four function types. All are defined as named exports in your `vex/` directory.

### Queries

Queries are read-only functions. They receive `ctx.db` (a `DatabaseReader`) for reading data.

```ts
// vex/messages.ts
import { query } from "./_generated/server";
import { v } from "@vex/values";

export const list = query({
  args: { channel: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .order("desc")
      .take(50);
  },
});
```

Queries are **reactive** — when used with `useQuery`, they automatically re-run and push updates when the underlying data changes.

### Mutations

Mutations can read and write data. They receive `ctx.db` (a `DatabaseWriter`) and `ctx.scheduler` for scheduling delayed work.

```ts
import { mutation } from "./_generated/server";
import { v } from "@vex/values";

export const send = mutation({
  args: { body: v.string(), author: v.string(), channel: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
  },
});

export const archive = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { archived: true });
    // Schedule cleanup 24 hours later
    await ctx.scheduler.runAfter(86400000, "messages:delete", { id: args.id });
  },
});
```

### Actions

Actions can call other functions but don't have direct database access. Use them for external API calls or orchestrating multiple queries/mutations.

```ts
import { action } from "./_generated/server";
import { v } from "@vex/values";

export const createAndCount = action({
  args: { title: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    await ctx.runMutation("tasks:create", {
      title: args.title,
      status: "todo",
      priority: "medium",
      projectId: args.projectId,
    });
    const tasks = await ctx.runQuery("tasks:listByProject", {
      projectId: args.projectId,
    });
    return { count: tasks.length };
  },
});
```

`ActionCtx` provides: `ctx.runQuery()`, `ctx.runMutation()`, `ctx.runAction()`, and `ctx.scheduler`.

### HTTP Actions

Expose HTTP endpoints alongside your WebSocket API. Define routes in `vex/http.ts`:

```ts
// vex/http.ts
import { httpRouter, httpAction } from "@vex/server";

const http = httpRouter();

http.route({
  path: "/api/tasks",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    const tasks = await ctx.runQuery("tasks:listByProject", { projectId });
    return new Response(JSON.stringify(tasks), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/tasks",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json() as any;
    await ctx.runMutation("tasks:create", body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
```

HTTP action handlers receive a full `ActionCtx` plus the incoming `Request`, and must return a `Response`.

### Internal Functions

Prefix any function type with `internal` to make it server-only (not callable from the client):

```ts
import { internalMutation, internalQuery } from "./_generated/server";

export const cleanup = internalMutation({
  args: { olderThan: v.number() },
  handler: async (ctx, args) => {
    // Only callable from other server functions or cron jobs
  },
});
```

Available variants: `internalQuery`, `internalMutation`, `internalAction`.

### Cron Jobs

Schedule recurring work in `vex/crons.ts`:

```ts
// vex/crons.ts
import { cronJobs } from "@vex/server";

const crons = cronJobs();

crons.interval("cleanup old tasks", { hours: 1 }, "tasks:cleanupDone", {});
crons.daily("daily report", { hourUTC: 9 }, "reports:generate", {});
crons.cron("custom schedule", "*/15 * * * *", "stats:compute", {});

export default crons;
```

Available schedules: `interval`, `hourly`, `daily`, `weekly`, `monthly`, and `cron` (cron expression).

### Context Summary

| Function Type | `ctx.db` | `ctx.scheduler` | `ctx.runQuery` | `ctx.runMutation` | `ctx.runAction` |
|---------------|----------|-----------------|----------------|-------------------|-----------------|
| Query         | read     |                 |                |                   |                 |
| Mutation      | read/write | yes           |                |                   |                 |
| Action        |          | yes             | yes            | yes               | yes             |
| HTTP Action   |          | yes             | yes            | yes               | yes             |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React App                                      │
│  useQuery(api.messages.list, { channel })       │
│  useMutation(api.messages.send)                 │
└──────────────────┬──────────────────────────────┘
                   │ WebSocket
┌──────────────────▼──────────────────────────────┐
│  Cloudflare Worker                              │
│  Routes requests to Durable Object              │
│ ┌─────────────────────────────────────────────┐ │
│ │  VexDO (Durable Object)                     │ │
│ │                                             │ │
│ │  ┌──────────┐ ┌────────────┐ ┌───────────┐ │ │
│ │  │ User     │ │ Transaction│ │Subscription│ │ │
│ │  │ Functions│ │ Store      │ │ Manager   │ │ │
│ │  │ (bundled)│ │ (OCC)      │ │ (realtime)│ │ │
│ │  └──────────┘ └────────────┘ └───────────┘ │ │
│ │                                             │ │
│ │  ┌─────────────────────────────────────┐    │ │
│ │  │  SQLite (Durable Object Storage)    │    │ │
│ │  │  documents + indexes + tx log       │    │ │
│ │  └─────────────────────────────────────┘    │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Single Durable Object per tenant.** All queries, mutations, subscriptions, and WebSocket connections go through one DO instance. This gives you strong consistency without distributed coordination.

**User functions run in-process.** Your `vex/` functions are bundled into the worker and executed directly inside the Durable Object — no inter-service RPCs.

## Packages

| Package | Description |
|---------|-------------|
| `@vex/server` | Define schemas, queries, mutations. Database reader/writer, query builder, filter DSL |
| `@vex/client` | WebSocket client with auto-reconnect, subscription management, mutation queue, IndexedDB persistence |
| `@vex/react` | `ConvexProvider`, `useQuery`, `useMutation`, `useAction`, `usePaginatedQuery`, `useQueryWithStatus`, `useConnectionState` |
| `@vex/solid` | Solid.js bindings: `VexProvider`, `createQuery`, `createMutation`, `createAction`, `createPaginatedQuery` |
| `@vex/values` | Validator library (`v.string()`, `v.number()`, `v.object()`, etc.) for schema and args |
| `@vex/cli` | `vex init`, `vex dev`, `vex deploy`, `vex codegen` — scaffold, develop, deploy. Ships the Cloudflare Worker + Durable Object runtime in `packages/cli/runtime/src/` |

## Documentation

- **[Schema & Validators](docs/schema.md)** — `defineSchema`, `defineTable`, `v.*` validators, indexes, search indexes
- **[Functions](docs/functions.md)** — queries, mutations, actions, internal functions, HTTP actions, cron jobs, codegen
- **[Database](docs/database.md)** — reading, writing, QueryBuilder, filters, indexes, pagination, full-text search
- **[Client SDK](docs/client.md)** — `ConvexClient`, subscriptions, optimistic updates, persistence
- **[React Hooks](docs/react.md)** — `useQuery`, `useMutation`, `useAction`, `usePaginatedQuery`
- **[CLI](docs/cli.md)** — `vex init`, `vex dev`, `vex deploy`, `vex codegen`
- **[Scheduling](docs/scheduling.md)** — `scheduler.runAfter`, `scheduler.runAt`, cron jobs
- **[File Storage](docs/storage.md)** — upload, serve, and manage files via Cloudflare R2
- **[How It Works](docs/how-it-works.md)** — real-time subscriptions, OCC, type-safe codegen
- **[Feature Status](docs/feature-status.md)** — implementation status for all features

## Project Structure

```
your-project/
├── vex/                      # Your backend code
│   ├── schema.ts             # Table definitions
│   ├── messages.ts           # Query & mutation functions
│   ├── users.ts              # More functions...
│   └── _generated/           # Auto-generated (don't edit)
│       ├── api.ts            # Typed API references
│       ├── server.ts         # Typed query/mutation factories
│       └── dataModel.ts      # TypeScript types for tables
├── src/                      # Your frontend code
│   └── App.tsx
├── wrangler.toml             # Scaffolded by vex init, user can customize
├── package.json
└── .vex/                     # Gitignored, CLI-managed
    └── src/                  # Runtime source + generated bundle
```

The `.vex/src/` directory is created automatically by `vex dev`, `vex deploy`, and `vex codegen`. It contains:
- The **Cloudflare Worker + Durable Object runtime** — copied from the CLI package (`packages/cli/runtime/src/`). This includes `VexDO.ts` (the main Durable Object that handles all state, transactions, subscriptions, and WebSocket connections), the SQLite database layer, subscription manager, and connection manager.
- `_functions.generated.ts` — a generated bundle that imports your `vex/` functions and wires them into the runtime.

The `wrangler.toml` at project root points to `.vex/src/index.ts` as the Worker entry point. Wrangler's bundler (esbuild) handles all import resolution from there.

## How Vex Compares to Convex

| | Convex | Vex |
|-|--------|-----|
| **Hosting** | Convex Cloud | Your Cloudflare account |
| **Real-time queries** | Yes | Yes |
| **Type-safe codegen** | Yes | Yes |
| **ACID transactions** | Yes | Yes (OCC) |
| **Database indexes** | Yes | Yes |
| **Full-text search** | Yes | Yes (SQLite FTS5) |
| **Pagination** | Yes | Yes (cursor-based) |
| **Database** | Custom | SQLite (Durable Objects) |
| **Subscriptions** | Server-push | Server-push (WebSocket) |
| **Offline/cache** | No | Yes (IndexedDB persistence) |
| **Edge runtime** | Convex runtime | Cloudflare Workers |
| **Pricing** | Per-function call | Cloudflare Workers pricing |
| **Open source** | No | Yes |

## Development

### Prerequisites

- [Bun](https://bun.sh) (package manager and runtime)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (Cloudflare Workers CLI)

### Running Locally

```bash
# Install dependencies
bun install

# Start the backend (from your app directory)
vex dev

# In another terminal, start the frontend
cd examples/task-manager
bun run dev
```

Open http://localhost:5173 to see the example task manager app.

### Testing

Vex includes an end-to-end test suite that starts a local dev server and exercises the full stack over WebSocket:

```bash
# Run the E2E test suite
bun run test

# Watch mode
bun run test:watch
```

Tests cover mutations, index queries, pagination, real-time subscriptions, multi-client scenarios, argument validation, and document structure.

### Deployment

Deploy your Vex backend to Cloudflare with a single command:

```bash
vex deploy
```

This runs codegen and then `wrangler deploy`. You can pass flags through to wrangler:

```bash
vex deploy --dry-run                    # codegen only, skip deploy
vex deploy -- --env production          # pass flags to wrangler
```

Then point your client to the production URL:

```ts
const client = new ConvexClient("wss://your-worker.your-subdomain.workers.dev/ws");
```

### Building Packages

```bash
npx tsc --build
```

## Tech Stack

- **Runtime**: Cloudflare Workers + Durable Objects
- **Database**: SQLite (via Durable Object storage)
- **Transport**: WebSocket (real-time push)
- **Language**: TypeScript
- **Build**: Wrangler, TypeScript compiler
- **Package manager**: Bun

## License

MIT

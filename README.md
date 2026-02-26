# Vex

An open-source [Convex](https://convex.dev)-style backend you deploy to your own Cloudflare account. Real-time queries, mutations, type-safe codegen — all running on Cloudflare Workers, Durable Objects, and SQLite.

## Why Vex?

Convex introduced a great developer experience: define your backend as plain TypeScript functions, get real-time subscriptions and a type-safe client for free. Vex brings that same model to Cloudflare's edge infrastructure — giving you full control over your data and deployment.

- **Your Cloudflare account** — data lives in your Durable Objects, not a third-party service
- **Real-time subscriptions** — queries re-run and push updates over WebSocket when data changes
- **Type-safe codegen** — generated `api` object gives you end-to-end type safety from database to UI
- **Optimistic concurrency control** — mutations are checked for conflicts before committing
- **Database indexes** — declare indexes in your schema, query them with `.withIndex()` for efficient lookups
- **Pagination** — built-in cursor-based pagination with `.paginate()`
- **Single Durable Object** — all state, transactions, and WebSocket connections in one place for strong consistency

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
  }).index("by_channel", ["channel"]),
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

### 5. Start development

```bash
vex dev
```

This will:

1. Analyze your `vex/` directory for schema and function definitions
2. Generate type-safe code in `vex/_generated/`
3. Start a local Cloudflare Worker with Durable Objects
4. Watch for changes and rebuild automatically

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
│ │  TenantBackend (Durable Object)             │ │
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

## How It Works

### Real-Time Subscriptions

When a client subscribes to a query, the server:

1. Executes the query function against SQLite
2. Tracks which tables and documents were read
3. Records the filter expression used (if any)
4. Sends the result to the client
5. On every mutation, checks if the write overlaps with any subscription's read set or query filters
6. If overlapping, re-executes the query and pushes the new result if it changed

This is **query-level invalidation** — posting a message to `#random` won't trigger re-execution of a subscription watching `#general`.

### Optimistic Concurrency Control

Mutations use MVCC with timestamp ordering:

1. Begin transaction at current timestamp
2. Execute mutation, tracking all reads and writes
3. Before committing, check if any read documents were modified since the transaction began
4. If conflict detected, return error (client retries automatically)
5. If clean, commit writes and increment global timestamp

### Type-Safe Codegen

Running `vex dev` generates three files in `vex/_generated/`:

| File | Purpose |
|------|---------|
| `api.ts` | Typed function references (`api.messages.list`, `api.messages.send`) |
| `server.ts` | Typed `query()` and `mutation()` factories with your DataModel |
| `dataModel.ts` | TypeScript types for all your tables |

Your editor gets full autocomplete for query args, mutation args, and return types.

## Packages

| Package | Description |
|---------|-------------|
| `@vex/server` | Define schemas, queries, mutations. Database reader/writer, query builder, filter DSL |
| `@vex/client` | WebSocket client with auto-reconnect, subscription management, mutation queue |
| `@vex/react` | `useQuery`, `useMutation`, `ConvexProvider` hooks for React |
| `@vex/values` | Validator library (`v.string()`, `v.number()`, `v.object()`, etc.) for schema and args |
| `@vex/cli` | `vex dev` command — analyze, codegen, bundle, watch, start wrangler |

## Database API

### Reading Data

```ts
// Full table scan
await ctx.db.query("messages").collect();

// Index query — efficient lookup using a declared index
await ctx.db.query("messages")
  .withIndex("by_channel", (q) => q.eq("channel", "general"))
  .order("desc")
  .take(50);

// Filter (full scan with in-memory filtering)
await ctx.db.query("messages")
  .filter((q) => q.eq(q.field("channel"), "general"))
  .collect();

// Compound filter
await ctx.db.query("users")
  .filter((q) => q.and(
    q.eq(q.field("status"), "active"),
    q.gte(q.field("score"), 100)
  ))
  .order("desc")
  .take(10);

// Point read by ID
const doc = await ctx.db.get(id);

// First match
const user = await ctx.db.query("users")
  .filter((q) => q.eq(q.field("email"), "alice@example.com"))
  .first();

// Pagination
const { page, isDone, continueCursor } = await ctx.db.query("messages")
  .withIndex("by_channel", (q) => q.eq("channel", "general"))
  .order("desc")
  .paginate({ cursor: null, numItems: 20 });
// Pass continueCursor as cursor to get the next page
```

### Writing Data

```ts
// Insert (returns generated ID)
const id = await ctx.db.insert("messages", {
  body: "Hello",
  author: "Alice",
  channel: "general",
});

// Partial update
await ctx.db.patch(id, { body: "Updated" });

// Full replacement
await ctx.db.replace(id, { body: "New", author: "Bob", channel: "general" });

// Delete
await ctx.db.delete(id);
```

### Filter Operators

```ts
q.eq(a, b)       // equal
q.neq(a, b)      // not equal
q.lt(a, b)       // less than
q.lte(a, b)      // less than or equal
q.gt(a, b)       // greater than
q.gte(a, b)      // greater than or equal
q.and(f1, f2)    // logical AND
q.or(f1, f2)     // logical OR
q.not(f)         // logical NOT
q.field("name")  // reference a document field
```

Values like strings and numbers are auto-wrapped as literals — no need for `q.literal("general")`.

### Indexes

Declare indexes in your schema to enable efficient queries without full table scans:

```ts
// vex/schema.ts
export const schema = defineSchema({
  messages: defineTable({
    body: v.string(),
    author: v.string(),
    channel: v.string(),
  })
    .index("by_channel", ["channel"])
    .index("by_author", ["author"]),
});
```

Query using an index with `.withIndex()`:

```ts
// Equality match
await ctx.db.query("messages")
  .withIndex("by_channel", (q) => q.eq("channel", "general"))
  .collect();

// Range queries
await ctx.db.query("events")
  .withIndex("by_date", (q) =>
    q.gte("date", startDate).lt("date", endDate)
  )
  .order("desc")
  .take(100);
```

The `IndexRangeBuilder` supports these operators:

```ts
q.eq(field, value)    // equal
q.gt(field, value)    // greater than
q.gte(field, value)   // greater than or equal
q.lt(field, value)    // less than
q.lte(field, value)   // less than or equal
```

Indexes are automatically maintained — inserts, updates, and deletes keep index tables in sync. Subscription invalidation is also index-aware: a query watching `channel: "general"` won't re-execute when a message is sent to `"random"`.

### Pagination

Use `.paginate()` for cursor-based pagination:

```ts
export const listPaginated = query({
  args: {
    channel: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: args.numItems ?? 20 });
  },
});
```

Returns `{ page, isDone, continueCursor }`:
- `page` — array of documents for the current page
- `isDone` — `true` if there are no more results
- `continueCursor` — pass as `cursor` to fetch the next page (`null` when done)

## Validators

Use `v` from `@vex/values` to define schemas and function args:

```ts
v.string()                                // string
v.number()                                // number
v.boolean()                               // boolean
v.id("tableName")                         // document ID reference
v.literal("active")                       // literal value
v.object({ name: v.string() })            // nested object
v.array(v.string())                       // array
v.union(v.literal("a"), v.literal("b"))   // union type
v.optional(v.string())                    // optional field
v.record(v.string(), v.string())          // record / map type
v.float64()                               // IEEE 754 double (number)
v.int64()                                 // 64-bit integer (bigint)
v.bytes()                                 // binary data (ArrayBuffer)
v.any()                                   // any type
```

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
└── package.json
```

## Testing

Vex includes an end-to-end test suite that starts a local dev server and exercises the full stack over WebSocket:

```bash
bun run test
```

Tests cover mutations, index queries, pagination, real-time subscriptions, multi-client scenarios, argument validation, and document structure.

## Deployment

The backend is a standard Cloudflare Workers project with Durable Objects. Deploy it to your own account:

```bash
cd cloudflare/tenant-backend
wrangler deploy
```

Then point your client to the production URL:

```ts
const client = new ConvexClient("wss://your-worker.your-subdomain.workers.dev/ws");
```

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
cd examples/chat-app
bun run dev
```

Open http://localhost:5173 to see the example chat app.

### Running Tests

```bash
# Run the E2E test suite
bun run test

# Watch mode
bun run test:watch
```

### Building Packages

```bash
npx tsc --build packages/values packages/server packages/cli
```

## How Vex Compares to Convex

| | Convex | Vex |
|-|--------|-----|
| **Hosting** | Convex Cloud | Your Cloudflare account |
| **Real-time queries** | Yes | Yes |
| **Type-safe codegen** | Yes | Yes |
| **ACID transactions** | Yes | Yes (OCC) |
| **Database indexes** | Yes | Yes |
| **Pagination** | Yes | Yes (cursor-based) |
| **Database** | Custom | SQLite (Durable Objects) |
| **Subscriptions** | Server-push | Server-push (WebSocket) |
| **Edge runtime** | Convex runtime | Cloudflare Workers |
| **Pricing** | Per-function call | Cloudflare Workers pricing |
| **Open source** | No | Yes |

## Feature Status

### Functions

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

### Database

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
| Full-text search (`.withSearchIndex()`) | Not yet |
| Vector search (`ctx.vectorSearch()`) | Not yet |
| Default `by_creation_time` / `by_id` indexes | Implemented |

### Real-Time

| Feature | Status |
|---------|--------|
| WebSocket subscriptions with server push | Implemented |
| Smart invalidation (table + document-level overlap checks) | Implemented |
| Subscription deduplication (same query executed once) | Implemented |
| Diff suppression (no update if result unchanged) | Implemented |
| Batched WebSocket sends (multiple updates in one frame) | Implemented |

### Transactions

| Feature | Status |
|---------|--------|
| Optimistic concurrency control (read/write set tracking) | Implemented |
| Automatic retry on conflict (up to 5 retries) | Implemented |
| Transaction log with periodic pruning | Implemented |

### Scheduling

| Feature | Status |
|---------|--------|
| `scheduler.runAfter(delayMs, fn, args)` | Implemented |
| `scheduler.runAt(timestamp, fn, args)` | Implemented |
| Backed by SQLite + Cloudflare DO Alarms | Implemented |
| `scheduler.cancel(id)` | Implemented |
| Cron jobs (`cronJobs()`, interval/cron expressions, hourly/daily/weekly/monthly) | Implemented |

### Authentication

| Feature | Status |
|---------|--------|
| `ctx.auth.getUserIdentity()` | Not yet |
| JWT / OpenID Connect validation | Not yet |
| Auth provider integrations (Clerk, Auth0, etc.) | Not yet |
| Token refresh on WebSocket connection | Not yet |

### File Storage

| Feature | Status |
|---------|--------|
| `ctx.storage.generateUploadUrl()` | Not yet |
| `ctx.storage.getUrl(storageId)` | Not yet |
| `ctx.storage.store(blob)` / `ctx.storage.delete(id)` | Not yet |

### Schema & Validation

| Feature | Status |
|---------|--------|
| `defineSchema()` / `defineTable()` with typed fields | Implemented |
| `v.string()`, `v.number()`, `v.boolean()`, `v.null()` | Implemented |
| `v.id()`, `v.object()`, `v.array()`, `v.optional()` | Implemented |
| `v.union()`, `v.literal()`, `v.any()` | Implemented |
| Runtime schema enforcement on writes | Implemented |
| `v.record()` | Implemented |
| `v.bytes()`, `v.int64()`, `v.float64()` | Implemented |

### Client SDK (`@vex/client`)

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

### React (`@vex/react`)

| Feature | Status |
|---------|--------|
| `ConvexProvider` | Implemented |
| `useQuery(ref, args)` | Implemented |
| `useMutation(ref)` | Implemented |
| `useAction(ref)` | Implemented |
| `useConnectionState()` | Implemented |
| `usePaginatedQuery()` with `loadMore` | Implemented |

### Codegen & Tooling

| Feature | Status |
|---------|--------|
| Generated `api` object (type-safe function references) | Implemented |
| Generated `DataModel` types | Implemented |
| Typed `query` / `mutation` / `action` factories | Implemented |
| `vex dev` (watch, codegen, bundle, local server) | Implemented |
| Nested directory function discovery | Not yet |
| Generated `internal` API object | Implemented |
| `vex deploy` (production deployment) | Not yet |
| `vex run` (invoke functions from CLI) | Not yet |
| Dashboard web UI | Not yet |

### Infrastructure

| Feature | Status |
|---------|--------|
| Cloudflare Workers + Durable Objects | Implemented |
| SQLite (DO embedded storage) | Implemented |
| DO Hibernation support (WebSocket restore + client re-subscribe) | Implemented |
| Multi-tenant routing (`/t/{slug}/...`) | Implemented |
| Per-connection rate limiting | Implemented |
| Connection limit enforcement | Implemented |

## Tech Stack

- **Runtime**: Cloudflare Workers + Durable Objects
- **Database**: SQLite (via Durable Object storage)
- **Transport**: WebSocket (real-time push)
- **Language**: TypeScript
- **Build**: Wrangler, TypeScript compiler
- **Package manager**: Bun

## License

MIT

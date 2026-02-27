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

## Packages

| Package | Description |
|---------|-------------|
| `@vex/server` | Define schemas, queries, mutations. Database reader/writer, query builder, filter DSL |
| `@vex/client` | WebSocket client with auto-reconnect, subscription management, mutation queue |
| `@vex/react` | `useQuery`, `useMutation`, `ConvexProvider` hooks for React |
| `@vex/values` | Validator library (`v.string()`, `v.number()`, `v.object()`, etc.) for schema and args |
| `@vex/cli` | `vex dev` command — analyze, codegen, bundle, watch, start wrangler |

## Documentation

- **[Database API](docs/database.md)** — reading, writing, filters, indexes, pagination, validators
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
└── package.json
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

The backend is a standard Cloudflare Workers project with Durable Objects. Deploy it to your own account:

```bash
cd cloudflare/tenant-backend
wrangler deploy
```

Then point your client to the production URL:

```ts
const client = new ConvexClient("wss://your-worker.your-subdomain.workers.dev/ws");
```

### Building Packages

```bash
npx tsc --build packages/values packages/server packages/cli
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

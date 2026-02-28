# How It Works

## Real-Time Subscriptions

When a client subscribes to a query, the server:

1. Executes the query function against SQLite
2. Tracks which tables and documents were read
3. Records the filter expression used (if any)
4. Sends the result to the client
5. On every mutation, checks if the write overlaps with any subscription's read set or query filters
6. If overlapping, re-executes the query and pushes the new result if it changed

This is **query-level invalidation** — posting a message to `#random` won't trigger re-execution of a subscription watching `#general`.

**Full-text search queries** use conservative invalidation: any write to the table triggers re-execution, since FTS relevance ranking makes fine-grained overlap detection impractical.

## Optimistic Concurrency Control

Mutations use OCC with timestamp-based conflict detection:

1. Begin transaction at current timestamp
2. Execute mutation, tracking all reads and writes
3. Before committing, check if any read documents were modified since the transaction began
4. If conflict detected, return error (client retries automatically)
5. If clean, commit writes and increment global timestamp

## Type-Safe Codegen

Running `zeroback dev` (or `zeroback deploy` / `zeroback codegen`) generates three files in `zeroback/_generated/`:

| File | Purpose |
|------|---------|
| `api.ts` | Typed function references (`api.messages.list`, `api.messages.send`) |
| `server.ts` | Typed `query()` and `mutation()` factories with your DataModel |
| `dataModel.ts` | TypeScript types for all your tables |

It also bundles all user functions and schema into `_functions.generated.ts` in the worker directory, which the Durable Object loads at runtime.

Your editor gets full autocomplete for query args, mutation args, and return types.

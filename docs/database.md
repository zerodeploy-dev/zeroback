# Database API

## Reading Data

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

## Writing Data

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

## Filter Operators

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

## Indexes

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

## Full-Text Search

Declare search indexes in your schema to enable full-text search on text fields:

```ts
// vex/schema.ts
export const schema = defineSchema({
  tasks: defineTable({
    title: v.string(),
    body: v.string(),
    projectId: v.string(),
  })
    .index("by_project", ["projectId"])
    .searchIndex("search_title", { searchField: "title" }),
});
```

Query using `.search()` on the QueryBuilder:

```ts
// Basic search — returns results ranked by relevance
await ctx.db.query("tasks")
  .search("title", "fix bug")
  .take(10);

// Search with additional filter
await ctx.db.query("tasks")
  .search("title", "fix bug")
  .filter((q) => q.eq(q.field("projectId"), "proj_123"))
  .take(10);
```

### How it works

- Powered by **SQLite FTS5** external content tables — zero extra storage overhead
- FTS tables are kept in sync via database triggers (inserts and deletes)
- Results are ordered by **relevance** (`fts.rank`); custom `.order()` is ignored when `.search()` is active
- `.search()` and `.withIndex()` are mutually exclusive — use `.filter()` for additional conditions on search results
- Search queries use the FTS5 `MATCH` syntax — supports terms, phrases (`"fix bug"`), prefix queries (`fix*`), boolean operators (`fix AND bug`, `fix OR patch`), and column filters
- Schema migration automatically creates, rebuilds, or removes FTS tables and triggers as search indexes change

### Subscription behavior

Search queries use **conservative invalidation**: any write to a table with active search subscriptions triggers re-execution. This ensures correctness since FTS relevance ranking makes fine-grained overlap detection impractical.

## Pagination

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
v.null()                                  // null
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

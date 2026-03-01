---
title: Database
description: Query and mutate data with indexed lookups, full-text search, and cursor-based pagination.
---

The database API is available through `ctx.db` in queries and mutations. Queries receive a `DatabaseReader` (read-only), while mutations receive a `DatabaseWriter` (read + write).

## DatabaseReader

Available as `ctx.db` in `query` and `internalQuery` handlers.

### `db.query(table)`

Start a query on a table. Returns a [`QueryBuilder`](#querybuilder) for chaining.

```ts
db.query<T extends keyof DataModel>(table: T): QueryBuilder<DataModel[T]>
```

```ts
const tasks = await ctx.db.query("tasks").collect();
```

### `db.get(id)`

Get a single document by its `_id`.

```ts
db.get<T extends keyof DataModel>(id: Id<T>): Promise<DataModel[T] | null>
```

Returns `null` if the document does not exist.

```ts
const task = await ctx.db.get("tasks:01HXZ...");
```

### `db.getMany(...ids)`

Get multiple documents by their `_id`s in a single call.

```ts
db.getMany<T extends keyof DataModel>(...ids: Id<T>[]): Promise<Map<Id<T>, DataModel[T] | null>>
```

Returns a `Map` where missing documents are `null`.

```ts
const results = await ctx.db.getMany("tasks:01A...", "tasks:01B...");
// results.get("tasks:01A...") => document or null
```

## DatabaseWriter

Available as `ctx.db` in `mutation` and `internalMutation` handlers. Extends `DatabaseReader` with write methods.

### `db.insert(table, doc)`

Insert a new document. Returns the auto-generated `_id`.

```ts
db.insert<T extends keyof DataModel>(
  table: T,
  doc: Omit<DataModel[T], "_id" | "_creationTime">
): Promise<Id<T>>
```

The `_id` (ULID-based, format `"tableName:ULID"`) and `_creationTime` (Unix ms timestamp) are generated automatically.

```ts
const id = await ctx.db.insert("tasks", {
  title: "Fix bug",
  status: "todo",
  priority: "high",
  projectId: "projects:01HXZ...",
});
// id => "tasks:01HXZ..."
```

### `db.patch(id, fields)`

Partially update a document. Only the specified fields are changed; all other fields are preserved.

```ts
db.patch<T extends keyof DataModel>(
  id: Id<T>,
  fields: Partial<Omit<DataModel[T], "_id" | "_creationTime">>
): Promise<void>
```

```ts
await ctx.db.patch(taskId, { status: "done", priority: "low" });
```

### `db.replace(id, doc)`

Replace a document's entire contents. The `_id` and `_creationTime` are preserved; all other fields are replaced.

```ts
db.replace<T extends keyof DataModel>(
  id: Id<T>,
  doc: Omit<DataModel[T], "_id" | "_creationTime">
): Promise<void>
```

```ts
await ctx.db.replace(taskId, {
  title: "New title",
  status: "todo",
  priority: "medium",
  projectId: "projects:01HXZ...",
});
```

### `db.delete(id)`

Delete a document by its ID.

```ts
db.delete(id: Id<string>): Promise<void>
```

```ts
await ctx.db.delete(taskId);
```

## QueryBuilder

Created by `ctx.db.query("tableName")`. Methods are chainable (except terminal methods which execute the query).

### Chainable Methods

#### `.withIndex(indexName, fn?)`

Use a named index for efficient queries. Cannot be combined with `.search()`.

```ts
.withIndex(indexName: string, fn?: (q: IndexRangeBuilder) => IndexRangeBuilder): this
```

The optional callback configures range constraints on index fields.

```ts
// Use index without constraints (scan in index order)
ctx.db.query("tasks").withIndex("by_id").order("desc").take(50);

// Equality match
ctx.db.query("tasks")
  .withIndex("by_project", (q) => q.eq("projectId", "proj123"))
  .collect();

// Compound index
ctx.db.query("tasks")
  .withIndex("by_project_status", (q) =>
    q.eq("projectId", "proj123").eq("status", "active")
  )
  .collect();

// Range query
ctx.db.query("events")
  .withIndex("by_date", (q) =>
    q.gte("date", startDate).lt("date", endDate)
  )
  .collect();
```

#### `.search(field, query)`

Full-text search on a search-indexed field. Cannot be combined with `.withIndex()`.

```ts
.search(field: string, query: string): this
```

Results are ordered by relevance (FTS5 rank). Custom `.order()` is ignored when `.search()` is active.

Supports FTS5 match syntax: terms, phrases (`"fix bug"`), prefix queries (`fix*`), and boolean operators (`fix AND bug`, `fix OR patch`).

```ts
// Basic search
ctx.db.query("tasks").search("title", "fix bug").take(10);

// Search with filter
ctx.db.query("tasks")
  .search("title", "fix bug")
  .filter((q) => q.eq(q.field("projectId"), "proj123"))
  .take(10);
```

#### `.filter(fn)`

Apply a filter expression to results. All filters are compiled to SQL `WHERE` clauses for efficiency.

```ts
.filter(fn: (q: FilterBuilder<Doc>) => FilterExpression): this
```

See [FilterBuilder](#filterbuilder) for available operators.

```ts
ctx.db.query("tasks")
  .filter((q) => q.and(
    q.eq(q.field("status"), "active"),
    q.gte(q.field("score"), 100)
  ))
  .collect();
```

#### `.order(direction)`

Set the sort direction.

```ts
.order(direction: "asc" | "desc"): this
```

Default: `"asc"`.

#### `.orderBy(field, direction?)`

Order by a specific field.

```ts
.orderBy(field: string, direction?: "asc" | "desc"): this
```

Default direction: `"asc"`.

### Terminal Methods

These execute the query and return results.

#### `.collect()`

Fetch all matching documents.

```ts
.collect(): Promise<Doc[]>
```

```ts
const allTasks = await ctx.db.query("tasks").collect();
```

#### `.first()`

Fetch the first matching document, or `null` if no results.

```ts
.first(): Promise<Doc | null>
```

```ts
const user = await ctx.db.query("users")
  .filter((q) => q.eq(q.field("email"), "alice@example.com"))
  .first();
```

#### `.unique()`

Fetch exactly one document. Throws if zero or more than one result.

```ts
.unique(): Promise<Doc>
```

Throws `"Expected exactly one result, got none"` or `"Expected exactly one result, got multiple"`.

#### `.take(n)`

Fetch at most `n` documents.

```ts
.take(n: number): Promise<Doc[]>
```

```ts
const recent = await ctx.db.query("tasks").order("desc").take(10);
```

#### `.paginate(opts)`

Cursor-based pagination. Returns a page of results with a cursor for the next page.

```ts
.paginate(opts: { cursor: string | null; numItems: number }): Promise<PaginationResult<Doc>>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts.cursor` | `string \| null` | Cursor from a previous page, or `null` for the first page |
| `opts.numItems` | `number` | Maximum number of documents to return |

**Returns:**

```ts
interface PaginationResult<Doc> {
  page: Doc[];                    // Documents for this page
  continueCursor: string | null;  // Cursor for the next page, null when done
  isDone: boolean;                // true if there are no more results
}
```

```ts
// First page
const { page, continueCursor, isDone } = await ctx.db
  .query("messages")
  .withIndex("by_channel", (q) => q.eq("channel", "general"))
  .order("desc")
  .paginate({ cursor: null, numItems: 20 });

// Next page
const page2 = await ctx.db
  .query("messages")
  .withIndex("by_channel", (q) => q.eq("channel", "general"))
  .order("desc")
  .paginate({ cursor: continueCursor, numItems: 20 });
```

## IndexRangeBuilder

Used inside the `.withIndex()` callback. All methods are chainable.

| Method | Signature | Description |
|--------|-----------|-------------|
| `q.eq(field, value)` | `(field: string, value: unknown) => this` | Equality match |
| `q.gt(field, value)` | `(field: string, value: unknown) => this` | Greater than |
| `q.gte(field, value)` | `(field: string, value: unknown) => this` | Greater than or equal |
| `q.lt(field, value)` | `(field: string, value: unknown) => this` | Less than |
| `q.lte(field, value)` | `(field: string, value: unknown) => this` | Less than or equal |

For compound indexes, chain equality constraints on leading fields, then optionally a range on the last field:

```ts
// Compound index: ["projectId", "status"]
.withIndex("by_project_status", (q) =>
  q.eq("projectId", "proj123").eq("status", "active")
)

// Compound index with range on last field: ["projectId", "date"]
.withIndex("by_project_date", (q) =>
  q.eq("projectId", "proj123").gte("date", startDate).lt("date", endDate)
)
```

## FilterBuilder

Used inside the `.filter()` callback. Provides comparison and logical operators.

### Field References

```ts
q.field(key: keyof Doc): Expression
```

Reference a document field. Required on at least one side of a comparison.

### Comparison Operators

All comparisons accept `Expression | string | number | boolean | null`. Literal values are auto-wrapped.

| Method | Signature | Description |
|--------|-----------|-------------|
| `q.eq(a, b)` | `(a: ExpressionOrValue, b: ExpressionOrValue) => FilterExpression` | Equal |
| `q.neq(a, b)` | `(a: ExpressionOrValue, b: ExpressionOrValue) => FilterExpression` | Not equal |
| `q.lt(a, b)` | `(a: ExpressionOrValue, b: ExpressionOrValue) => FilterExpression` | Less than |
| `q.lte(a, b)` | `(a: ExpressionOrValue, b: ExpressionOrValue) => FilterExpression` | Less than or equal |
| `q.gt(a, b)` | `(a: ExpressionOrValue, b: ExpressionOrValue) => FilterExpression` | Greater than |
| `q.gte(a, b)` | `(a: ExpressionOrValue, b: ExpressionOrValue) => FilterExpression` | Greater than or equal |

### Logical Operators

| Method | Signature | Description |
|--------|-----------|-------------|
| `q.and(...exprs)` | `(...exprs: FilterExpression[]) => FilterExpression` | Logical AND |
| `q.or(...exprs)` | `(...exprs: FilterExpression[]) => FilterExpression` | Logical OR |
| `q.not(expr)` | `(expr: FilterExpression) => FilterExpression` | Logical NOT |

### Filter Examples

```ts
// Simple equality
.filter((q) => q.eq(q.field("status"), "active"))

// Multiple conditions
.filter((q) => q.and(
  q.eq(q.field("status"), "active"),
  q.gte(q.field("score"), 100),
  q.neq(q.field("assignee"), null)
))

// OR condition
.filter((q) => q.or(
  q.eq(q.field("priority"), "high"),
  q.eq(q.field("priority"), "critical")
))

// NOT
.filter((q) => q.not(q.eq(q.field("status"), "archived")))
```

## Indexes vs Filters

Both `.withIndex()` and `.filter()` narrow query results, but they work differently:

| | `.withIndex()` | `.filter()` |
|---|---|---|
| **Mechanism** | Uses a B-tree index for O(log n) lookups | Compiles to SQL `WHERE` clause |
| **Declaration** | Must be declared in schema with `.index()` | No schema declaration needed |
| **Performance** | Most efficient for equality + range queries | Efficient for arbitrary conditions |
| **Operators** | `eq`, `gt`, `gte`, `lt`, `lte` | All comparison + `and`/`or`/`not` |
| **Combinable** | No (one index per query) | Yes (can combine with `.withIndex()`) |

Best practice: use `.withIndex()` for primary access patterns, and `.filter()` for additional conditions.

## Full-Text Search

Declare search indexes in your schema:

```ts
defineTable({
  title: v.string(),
  body: v.string(),
}).searchIndex("search_title", { searchField: "title" })
```

Query with `.search()`:

```ts
// Basic search
await ctx.db.query("tasks").search("title", "fix bug").take(10);

// With additional filter
await ctx.db.query("tasks")
  .search("title", "fix bug")
  .filter((q) => q.eq(q.field("projectId"), "proj123"))
  .take(10);
```

### Search Behavior

- Powered by SQLite FTS5 with external content tables (zero extra storage overhead)
- Results are ordered by relevance — custom `.order()` is ignored when `.search()` is active
- `.search()` and `.withIndex()` are mutually exclusive
- Supports FTS5 syntax: terms, phrases, prefix queries, boolean operators
- Search indexes are automatically maintained via database triggers

### Subscription Behavior

Search queries use **conservative invalidation**: any write to the table triggers re-execution, since FTS relevance ranking makes fine-grained overlap detection impractical.

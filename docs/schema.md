# Schema & Validators

## Defining a Schema

Define your data model in `vex/schema.ts`. The schema declares tables, their fields, indexes, and search indexes.

```ts
// vex/schema.ts
import { defineSchema, defineTable } from "@vex/server";
import { v } from "@vex/values";

export const schema = defineSchema({
  projects: defineTable({
    name: v.string(),
    description: v.string(),
    color: v.string(),
  }),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(),
    priority: v.string(),
    projectId: v.string(),
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    labels: v.optional(v.array(v.string())),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"])
    .searchIndex("search_title", { searchField: "title" }),
});
```

## `defineSchema(tables)`

Creates a schema definition from a map of table names to table definitions.

```ts
function defineSchema<T extends Record<string, TableDefinition<any>>>(
  tables: T
): SchemaDefinition<T>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `tables` | `Record<string, TableDefinition>` | An object mapping table names to `defineTable()` results |

**Returns:** `SchemaDefinition<T>` — used by codegen to generate typed `DataModel`, function factories, and API references.

## `defineTable(fields)`

Declares a single table with typed fields.

```ts
function defineTable<F extends PropertyValidators>(
  fields: F
): TableDefinition<ObjectType<F>>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fields` | `Record<string, Validator>` | An object mapping field names to `v.*` validators |

**Returns:** `TableDefinition` with chainable `.index()` and `.searchIndex()` methods.

### System Fields

Every document automatically includes two system fields that you do **not** declare in the schema:

| Field | Type | Description |
|-------|------|-------------|
| `_id` | `string` | Auto-generated ULID-based ID in `"tableName/ULID"` format |
| `_creationTime` | `number` | Unix timestamp in milliseconds, derived from the ULID |

These fields cannot be set or modified by user code and are excluded from `insert()`, `patch()`, and `replace()` arguments.

### `.index(name, fields)`

Declares a secondary index on the table.

```ts
.index(name: string, fields: string[]): TableDefinition
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Index name, used in `.withIndex()` queries |
| `fields` | `string[]` | Ordered list of field names to index on |

Indexes enable efficient queries via `.withIndex()` instead of full table scans. Compound indexes support multi-field queries where you specify equality on leading fields and an optional range on the last field.

Every table automatically gets two built-in indexes:
- `by_id` — index on `_id`
- `by_creation_time` — index on `_creationTime`

**Example:**

```ts
defineTable({
  title: v.string(),
  projectId: v.string(),
  status: v.string(),
})
  .index("by_project", ["projectId"])
  .index("by_project_status", ["projectId", "status"])
```

### `.searchIndex(name, opts)`

Declares a full-text search index on a text field.

```ts
.searchIndex(name: string, opts: { searchField: string }): TableDefinition
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Search index name (used internally) |
| `opts.searchField` | `string` | The text field to index for full-text search |

Powered by SQLite FTS5. Search indexes are kept in sync automatically via database triggers.

**Example:**

```ts
defineTable({
  title: v.string(),
  body: v.string(),
}).searchIndex("search_title", { searchField: "title" })
```

## Validators (`v`)

Import validators from `@vex/values`:

```ts
import { v } from "@vex/values";
```

Validators are used in three places:
1. **Schema fields** — `defineTable({ name: v.string() })`
2. **Function arguments** — `query({ args: { id: v.string() }, ... })`
3. **Return types** — `query({ returns: v.number(), ... })`

### Primitive Validators

| Validator | TypeScript Type | Description |
|-----------|----------------|-------------|
| `v.string()` | `string` | String value |
| `v.number()` | `number` | Number value (IEEE 754 double) |
| `v.boolean()` | `boolean` | Boolean value |
| `v.null()` | `null` | Null value |
| `v.any()` | `any` | Any type (no validation) |

### Reference Validators

| Validator | TypeScript Type | Description |
|-----------|----------------|-------------|
| `v.id(tableName)` | `Id<TableName>` | Document ID referencing a specific table |

```ts
v.id("tasks")  // Id<"tasks"> — e.g. "tasks/01HXZ..."
```

### Compound Validators

| Validator | TypeScript Type | Description |
|-----------|----------------|-------------|
| `v.object(fields)` | `{ ... }` | Nested object with typed fields |
| `v.array(element)` | `T[]` | Array of a single element type |
| `v.optional(validator)` | `T \| undefined` | Optional field (can be omitted) |
| `v.union(...members)` | `T1 \| T2 \| ...` | Union of multiple types |
| `v.literal(value)` | `"value"` | Exact literal value |
| `v.record(keys, values)` | `Record<K, V>` | String-keyed map/record |

```ts
// Nested object
v.object({ street: v.string(), city: v.string() })

// Array
v.array(v.string())  // string[]

// Optional
v.optional(v.string())  // string | undefined

// Union
v.union(v.literal("active"), v.literal("archived"))  // "active" | "archived"

// Record / map
v.record(v.string(), v.number())  // Record<string, number>
```

### Numeric Validators

| Validator | TypeScript Type | Description |
|-----------|----------------|-------------|
| `v.float64()` | `number` | Explicit IEEE 754 double-precision float |
| `v.int64()` | `bigint` | 64-bit integer |

### Binary Validator

| Validator | TypeScript Type | Description |
|-----------|----------------|-------------|
| `v.bytes()` | `ArrayBuffer` | Binary data |

## Type Inference

The `Infer` type helper extracts the TypeScript type from a validator:

```ts
import type { Infer } from "@vex/values";

const taskValidator = v.object({
  title: v.string(),
  status: v.union(v.literal("todo"), v.literal("done")),
});

type Task = Infer<typeof taskValidator>;
// { title: string; status: "todo" | "done" }
```

## Schema Enforcement

Schema validation runs at runtime on every write operation (`insert`, `patch`, `replace`). If a document fails validation, the write is rejected with an error. This ensures your database always matches the schema definition.

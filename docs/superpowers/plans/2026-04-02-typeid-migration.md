# TypeID Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `table:ULID` ID format with TypeID (`prefix_base32_uuidv7`) for URL-safe, spec-compliant identifiers.

**Architecture:** Add `typeid-js` dependency. Update ID generation in `DatabaseWriter`, parsing in `values/id.ts`, validation in `serialize.ts`, timestamp extraction in `SchemaMapper`, and schema builder with `.idPrefix()`. Provide an exported migration function for existing databases.

**Tech Stack:** `typeid-js`, UUIDv7, Vitest, SQLite

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/values/src/id.ts` | Modify | ID parsing utilities (`_` separator) |
| `packages/values/src/id.test.ts` | Create | Tests for ID parsing |
| `packages/values/src/serialize.ts` | Modify | TypeID prefix validation for `v.id()` |
| `packages/values/src/values.test.ts` | Modify | Add TypeID validation tests |
| `packages/values/package.json` | Modify | Add `typeid-js` dependency |
| `packages/server/src/schema.ts` | Modify | Add `.idPrefix()` to `defineTable` |
| `packages/server/src/types.ts` | Modify | Add `idPrefix` to `TableDefinition`, `SchemaJSON` |
| `packages/server/src/db/writer.ts` | Modify | Generate TypeIDs instead of ULIDs |
| `packages/server/src/db/writer.test.ts` | Modify | Update format assertions |
| `packages/server/src/db/reader.test.ts` | Modify | Update hardcoded IDs |
| `packages/server/src/runtime/db/SchemaMapper.ts` | Modify | UUIDv7 timestamp extraction |
| `packages/server/src/runtime/db/SchemaMapper.test.ts` | Modify | Update hardcoded IDs |
| `packages/server/src/runtime/CronManager.ts` | Modify | Replace `ulid()` with UUIDv7 |
| `packages/server/src/runtime/MutationExecutor.test.ts` | Modify | Update hardcoded IDs |
| `packages/server/src/migration/migrateIds.ts` | Create | Migration function |
| `packages/server/src/migration/migrateIds.test.ts` | Create | Migration tests |
| `packages/server/package.json` | Modify | Add `typeid-js`, remove `ulidx` |
| `packages/cli/src/codegen/dataModel.ts` | Modify | Generate `idPrefixes` map |
| `packages/cli/src/codegen/server.ts` | Modify | Generate `idPrefixes` map |

---

### Task 1: Add `typeid-js` Dependency

**Files:**
- Modify: `packages/values/package.json`
- Modify: `packages/server/package.json`

- [ ] **Step 1: Install typeid-js in values and server packages**

```bash
cd /Users/ranyefet/Code/zeroback
bun add typeid-js --cwd packages/values
bun add typeid-js --cwd packages/server
```

- [ ] **Step 2: Remove ulidx from server package**

```bash
bun remove ulidx --cwd packages/server
```

- [ ] **Step 3: Verify installation**

```bash
bun install
```

Expected: Clean install, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/values/package.json packages/server/package.json bun.lockb
git commit -m "chore: add typeid-js, remove ulidx"
```

---

### Task 2: Update ID Parsing Utilities

**Files:**
- Modify: `packages/values/src/id.ts`
- Create: `packages/values/src/id.test.ts`

- [ ] **Step 1: Write failing tests for new parsing**

Create `packages/values/src/id.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { tableFromId, suffixFromId } from "./id"

describe("tableFromId", () => {
  it("extracts table name from TypeID", () => {
    expect(tableFromId("posts_01h455vb4pex5vsknk084sn02q")).toBe("posts")
  })

  it("extracts multi-word table name", () => {
    expect(tableFromId("blogposts_01h455vb4pex5vsknk084sn02q")).toBe("blogposts")
  })

  it("returns empty string if no underscore", () => {
    expect(tableFromId("nounderscore")).toBe("")
  })
})

describe("suffixFromId", () => {
  it("extracts base32 suffix from TypeID", () => {
    expect(suffixFromId("posts_01h455vb4pex5vsknk084sn02q")).toBe("01h455vb4pex5vsknk084sn02q")
  })

  it("returns full string if no underscore", () => {
    expect(suffixFromId("nounderscore")).toBe("nounderscore")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/values/src/id.test.ts
```

Expected: FAIL — `suffixFromId` does not exist, `tableFromId` splits on `:` not `_`.

- [ ] **Step 3: Update id.ts implementation**

Replace `packages/values/src/id.ts` with:

```typescript
/** Extract the table name (prefix) from a TypeID ("prefix_base32suffix"). */
export function tableFromId(id: string): string {
  const idx = id.lastIndexOf("_")
  return idx >= 0 ? id.slice(0, idx) : ""
}

/** Extract the base32 suffix from a TypeID ("prefix_base32suffix"). */
export function suffixFromId(id: string): string {
  const idx = id.lastIndexOf("_")
  return idx >= 0 ? id.slice(idx + 1) : id
}
```

Note: Use `lastIndexOf("_")` because the TypeID spec says prefixes are alpha-only (no underscores), but using `lastIndexOf` is safer.

- [ ] **Step 4: Update exports in values index**

In `packages/values/src/index.ts`, the `export * from "./id.js"` already covers the new exports. Verify `ulidFromId` is no longer exported (it was renamed to `suffixFromId`).

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test packages/values/src/id.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/values/src/id.ts packages/values/src/id.test.ts
git commit -m "feat: update ID parsing from table:ULID to TypeID prefix_suffix format"
```

---

### Task 3: Add `.idPrefix()` to Schema Builder

**Files:**
- Modify: `packages/server/src/types.ts:79-86` — add `idPrefix` to `TableDefinition`
- Modify: `packages/server/src/types.ts:145-154` — add `idPrefix` to `SchemaJSON`
- Modify: `packages/server/src/schema.ts` — add `.idPrefix()` method

- [ ] **Step 1: Update `TableDefinition` type**

In `packages/server/src/types.ts`, update the `TableDefinition` type (line 79):

```typescript
export type TableDefinition<F> = {
  validator: Validator<F>;
  _doc: F;
  indexes: TableIndex[];
  searchIndexes: SearchIndex[];
  _idPrefix?: string;
  index(name: string, fields: string[]): TableDefinition<F>;
  searchIndex(name: string, opts: { searchField: string }): TableDefinition<F>;
  idPrefix(prefix: string): TableDefinition<F>;
};
```

- [ ] **Step 2: Update `SchemaJSON` type**

In `packages/server/src/types.ts`, update `SchemaJSON` (line 145):

```typescript
export type SchemaJSON = {
  tables: Record<
    string,
    {
      fields: Record<string, ValidatorJSON>;
      indexes: { name: string; fields: string[] }[];
      searchIndexes?: { name: string; searchField: string }[];
      idPrefix?: string;
    }
  >;
};
```

- [ ] **Step 3: Implement `.idPrefix()` in `defineTable`**

In `packages/server/src/schema.ts`, update the `defineTable` function:

```typescript
import type { PropertyValidators, ObjectType, Validator } from "@zeroback/values";
import { v } from "@zeroback/values";
import type { TableDefinition, SchemaDefinition, TableIndex, SearchIndex } from "./types.js";

const TYPEID_PREFIX_RE = /^[a-z]{1,63}$/

export function defineTable<F extends PropertyValidators>(fields: F): TableDefinition<ObjectType<F>> {
  const def: TableDefinition<ObjectType<F>> = {
    validator: v.object(fields) as unknown as Validator<ObjectType<F>>,
    _doc: {} as ObjectType<F>,
    indexes: [],
    searchIndexes: [],
    index(name: string, fields: string[]): TableDefinition<ObjectType<F>> {
      def.indexes.push({ name, fields });
      return def;
    },
    searchIndex(name: string, opts: { searchField: string }): TableDefinition<ObjectType<F>> {
      def.searchIndexes.push({ name, searchField: opts.searchField });
      return def;
    },
    idPrefix(prefix: string): TableDefinition<ObjectType<F>> {
      if (!TYPEID_PREFIX_RE.test(prefix)) {
        throw new Error(
          `Invalid idPrefix "${prefix}": must be 1-63 lowercase alpha characters`
        )
      }
      def._idPrefix = prefix
      return def
    },
  };
  return def;
}

export function defineSchema<T extends Record<string, TableDefinition<unknown>>>(
  tables: T
): SchemaDefinition<T> {
  // Validate table names are valid TypeID prefixes (when no custom prefix is set)
  for (const [tableName, tableDef] of Object.entries(tables)) {
    if (!tableDef._idPrefix && !TYPEID_PREFIX_RE.test(tableName)) {
      throw new Error(
        `Table name "${tableName}" is not a valid TypeID prefix (must be 1-63 lowercase alpha characters). Use .idPrefix() to set a custom prefix.`
      )
    }
  }
  return { tables };
}
```

- [ ] **Step 4: Run existing tests to make sure nothing breaks**

```bash
bun test packages/server/
```

Expected: All existing tests pass (no test touches `.idPrefix()` yet).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/schema.ts
git commit -m "feat: add .idPrefix() to defineTable for custom TypeID prefixes"
```

---

### Task 4: Update ID Generation in DatabaseWriter

**Files:**
- Modify: `packages/server/src/db/writer.ts`
- Modify: `packages/server/src/db/writer.test.ts`

- [ ] **Step 1: Update writer.test.ts with new format assertions**

Replace the contents of `packages/server/src/db/writer.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"
import { DatabaseWriter } from "./writer"
import type { DbOps } from "../types"

type TestDataModel = {
  tasks: { _id: string; _creationTime: number; title: string }
  users: { _id: string; _creationTime: number; name: string; age: number }
}

function makeMockOps(): DbOps {
  return {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    getMany: vi.fn().mockResolvedValue(new Map()),
    insert: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as DbOps
}

describe("DatabaseWriter", () => {
  describe("insert()", () => {
    it("generates a TypeID-based id and calls ops.insert", async () => {
      const ops = makeMockOps()
      const writer = new DatabaseWriter<TestDataModel>(ops)

      const id = await writer.insert("tasks", { title: "Test" } as any)

      // TypeID format: prefix_base32suffix (26-char suffix)
      expect(id).toMatch(/^tasks_[0-9a-hjkmnp-tv-z]{26}$/)
      expect(ops.insert).toHaveBeenCalledTimes(1)

      const [table, insertedId, doc] = (ops.insert as any).mock.calls[0]
      expect(table).toBe("tasks")
      expect(insertedId).toBe(id)
      expect(doc._id).toBe(id)
      expect(doc.title).toBe("Test")
    })

    it("generates unique ids", async () => {
      const ops = makeMockOps()
      const writer = new DatabaseWriter<TestDataModel>(ops)

      const id1 = await writer.insert("tasks", { title: "A" } as any)
      const id2 = await writer.insert("tasks", { title: "B" } as any)
      expect(id1).not.toBe(id2)
    })

    it("uses custom prefix from prefixMap", async () => {
      const ops = makeMockOps()
      const prefixMap = { tasks: "tsk", users: "usr" }
      const writer = new DatabaseWriter<TestDataModel>(ops, prefixMap)

      const id = await writer.insert("tasks", { title: "Test" } as any)
      expect(id).toMatch(/^tsk_[0-9a-hjkmnp-tv-z]{26}$/)
    })
  })

  describe("patch()", () => {
    it("extracts table from id and calls ops.patch", async () => {
      const ops = makeMockOps()
      const writer = new DatabaseWriter<TestDataModel>(ops)

      await writer.patch("tasks_01h455vb4pex5vsknk084sn02q" as any, { title: "Updated" } as any)

      expect(ops.patch).toHaveBeenCalledWith("tasks", "tasks_01h455vb4pex5vsknk084sn02q", { title: "Updated" })
    })
  })

  describe("replace()", () => {
    it("extracts table from id and calls ops.replace", async () => {
      const ops = makeMockOps()
      const writer = new DatabaseWriter<TestDataModel>(ops)

      await writer.replace("users_01h455vb4pex5vsknk084sn02q" as any, { name: "Alice", age: 30 } as any)

      expect(ops.replace).toHaveBeenCalledWith("users", "users_01h455vb4pex5vsknk084sn02q", { name: "Alice", age: 30 })
    })
  })

  describe("delete()", () => {
    it("extracts table from id and calls ops.delete", async () => {
      const ops = makeMockOps()
      const writer = new DatabaseWriter<TestDataModel>(ops)

      await writer.delete("tasks_01h455vb4pex5vsknk084sn02q" as any)

      expect(ops.delete).toHaveBeenCalledWith("tasks", "tasks_01h455vb4pex5vsknk084sn02q")
    })
  })

  describe("inherits DatabaseReader", () => {
    it("can call get()", async () => {
      const ops = makeMockOps()
      ;(ops.get as any).mockResolvedValue({ _id: "tasks_01h455vb4pex5vsknk084sn02q", title: "A" })

      const writer = new DatabaseWriter<TestDataModel>(ops)
      const result = await writer.get("tasks_01h455vb4pex5vsknk084sn02q" as any)
      expect(result).toEqual({ _id: "tasks_01h455vb4pex5vsknk084sn02q", title: "A" })
    })

    it("can call query()", () => {
      const writer = new DatabaseWriter<TestDataModel>(makeMockOps())
      const qb = writer.query("tasks")
      expect(qb).toBeDefined()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/server/src/db/writer.test.ts
```

Expected: FAIL — writer still generates `tasks:ULID` format.

- [ ] **Step 3: Update writer.ts implementation**

Replace `packages/server/src/db/writer.ts`:

```typescript
import { typeid } from "typeid-js"
import { DatabaseReader } from "./reader.js"
import type { DbOps } from "../types.js"
import { tableFromId, type Id } from "@zeroback/values"

export class DatabaseWriter<DataModel> extends DatabaseReader<DataModel> {
  private prefixMap?: Record<string, string>

  constructor(ops: DbOps, prefixMap?: Record<string, string>) {
    super(ops)
    this.prefixMap = prefixMap
  }

  async insert<T extends keyof DataModel & string>(
    table: T,
    doc: Omit<DataModel[T], "_id" | "_creationTime">
  ): Promise<Id<T>> {
    const prefix = this.prefixMap?.[table] ?? table
    const id = typeid(prefix).toString() as Id<T>
    const fullDoc = { ...(doc as Record<string, unknown>), _id: id }
    await this.ops.insert(table, id, fullDoc)
    return id
  }

  async patch<T extends keyof DataModel & string>(
    id: Id<T>,
    fields: Partial<Omit<DataModel[T], "_id" | "_creationTime">>
  ): Promise<void> {
    await this.ops.patch(tableFromId(id as string), id as string, fields)
  }

  async replace<T extends keyof DataModel & string>(
    id: Id<T>,
    doc: Omit<DataModel[T], "_id" | "_creationTime">
  ): Promise<void> {
    await this.ops.replace(tableFromId(id as string), id as string, doc)
  }

  async delete(id: Id<string>): Promise<void> {
    await this.ops.delete(tableFromId(id as string), id as string)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/server/src/db/writer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/writer.ts packages/server/src/db/writer.test.ts
git commit -m "feat: generate TypeID-based IDs in DatabaseWriter"
```

---

### Task 5: Update _creationTime Extraction in SchemaMapper

**Files:**
- Modify: `packages/server/src/runtime/db/SchemaMapper.ts:1-5, 250-259`
- Modify: `packages/server/src/runtime/db/SchemaMapper.test.ts:254-286`

- [ ] **Step 1: Update SchemaMapper.test.ts with TypeID-based IDs**

In `packages/server/src/runtime/db/SchemaMapper.test.ts`, update the `sqlRowToDoc` tests. Replace all occurrences of ULID-based IDs with TypeID format. The key test is the `sqlRowToDoc` describe block (line 255 onwards).

First, add a helper at the top of the test file (after imports, line 11):

```typescript
import { typeid } from "typeid-js"
```

Then update the `sqlRowToDoc` describe block. Replace the `id` variable in the first test (line 274):

```typescript
    // Use a valid TypeID so timestamp extraction works
    const tid = typeid("tasks")
    const id = tid.toString()
```

Update the assertion (line 281):
```typescript
    expect(doc._id).toBe(id)
```

Replace all other ULID-based IDs in the `sqlRowToDoc` tests:
- Line 300: `{ _id: "t:01ARZ3NDEKTSV4RRFFQ69G5FAV", ...` → `{ _id: typeid("t").toString(), ...`
- Line 317: same pattern
- Line 335: same pattern
- Line 350: same pattern

Also update `docToSQLParams` tests:
- Line 225: `{ _id: "tasks:abc", ...` → `{ _id: typeid("tasks").toString(), ...` (and update the assertion at line 230 accordingly)
- Line 250: `{ _id: "t:1" }` → `{ _id: typeid("t").toString() }` (and update assertion at line 251)

Store the TypeID in a variable so assertions can reference it:

```typescript
  it("serializes document to SQL param array", () => {
    // ... schema setup same as before ...
    const info = buildTableColumns(schema).get("tasks")!
    const id = typeid("tasks").toString()

    const params = docToSQLParams(
      { _id: id, title: "Test", done: true, tags: ["a", "b"] },
      info,
      42
    )

    expect(params).toEqual([
      id,            // _id
      42,            // commitTs
      "Test",        // title (string)
      1,             // done (boolean → 1)
      '["a","b"]',   // tags (JSON)
    ])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/server/src/runtime/db/SchemaMapper.test.ts
```

Expected: FAIL — `sqlRowToDoc` still imports `ulidFromId`/`decodeTime` from `ulidx`.

- [ ] **Step 3: Update SchemaMapper.ts implementation**

In `packages/server/src/runtime/db/SchemaMapper.ts`, update the imports at the top. Replace:

```typescript
import { ulidFromId } from "@zeroback/values"
import { decodeTime } from "ulidx"
```

With:

```typescript
import { suffixFromId } from "@zeroback/values"
import { fromString } from "typeid-js"
```

Then update the `sqlRowToDoc` function (lines 254-258). Replace:

```typescript
  const id = row._id as string;
  const ulidPart = ulidFromId(id);
  const doc: Record<string, unknown> = {
    _id: id,
    _creationTime: decodeTime(ulidPart),
  };
```

With:

```typescript
  const id = row._id as string
  const tid = fromString(id)
  const uuid = tid.toUUID()
  // UUIDv7: first 48 bits (chars 0-12 of UUID hex, minus hyphens) are unix ms timestamp
  const hex = uuid.replace(/-/g, "")
  const timestamp = parseInt(hex.slice(0, 12), 16)
  const doc: Record<string, unknown> = {
    _id: id,
    _creationTime: timestamp,
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/server/src/runtime/db/SchemaMapper.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/runtime/db/SchemaMapper.ts packages/server/src/runtime/db/SchemaMapper.test.ts
git commit -m "feat: extract _creationTime from TypeID UUIDv7 instead of ULID"
```

---

### Task 6: Update CronManager

**Files:**
- Modify: `packages/server/src/runtime/CronManager.ts:1-2, 92`

- [ ] **Step 1: Update CronManager import and ID generation**

In `packages/server/src/runtime/CronManager.ts`, replace the `ulid` import:

```typescript
// Replace:
import { ulid } from "ulidx"
// With:
import { typeid } from "typeid-js"
```

Update the `scheduleJob` method (line 92):

```typescript
// Replace:
const id = ulid();
// With:
const id = typeid("job").toString()
```

- [ ] **Step 2: Run existing cron tests (if any) or full test suite**

```bash
bun test packages/server/
```

Expected: PASS (no cron-specific unit tests exist, but ensure no import errors).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/runtime/CronManager.ts
git commit -m "feat: use TypeID for scheduled job IDs"
```

---

### Task 7: Update ID Validation in serialize.ts

**Files:**
- Modify: `packages/values/src/serialize.ts:127-132`
- Modify: `packages/values/src/values.test.ts:92-105`

- [ ] **Step 1: Update validation tests**

In `packages/values/src/values.test.ts`, replace the `v.id()` test block (lines 92-105):

```typescript
// ---------- v.id() ----------
describe("v.id()", () => {
  const json = v.id("users").json;

  it("accepts a valid TypeID with matching prefix", () => {
    expect(validate("users_01h455vb4pex5vsknk084sn02q", json)).toBe("users_01h455vb4pex5vsknk084sn02q");
  });
  it("rejects a number", () => {
    expect(() => validate(123, json)).toThrow("Expected id");
  });
  it("rejects a plain string without TypeID format", () => {
    expect(() => validate("abc123", json)).toThrow("Expected id");
  });
  it("rejects a TypeID with wrong prefix", () => {
    expect(() => validate("posts_01h455vb4pex5vsknk084sn02q", json)).toThrow('Expected id for table "users" (prefix "users"), got prefix "posts"');
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe('Id<"users">');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/values/src/values.test.ts
```

Expected: FAIL — current validation only checks `typeof === "string"`.

- [ ] **Step 3: Update validate function in serialize.ts**

In `packages/values/src/serialize.ts`, add import at top:

```typescript
import { tableFromId } from "./id.js"
```

Replace the `id` validation block (lines 127-132):

```typescript
  if (json.type === "id") {
    if (typeof value !== "string") {
      throw new Error(`Expected id (string), got ${typeof value}`)
    }
    // Validate TypeID format: prefix_base32suffix
    const underscoreIdx = (value as string).lastIndexOf("_")
    if (underscoreIdx < 1) {
      throw new Error(
        `Expected id for table "${json.tableName}" in TypeID format (prefix_suffix), got "${value}"`
      )
    }
    const prefix = (value as string).slice(0, underscoreIdx)
    const expectedPrefix = json.tableName
    if (prefix !== expectedPrefix) {
      throw new Error(
        `Expected id for table "${json.tableName}" (prefix "${expectedPrefix}"), got prefix "${prefix}"`
      )
    }
    return value as T
  }
```

Note: This validates against `json.tableName` which is the table name. When custom prefixes are used, the `tableName` in `ValidatorJSON` will need to store the prefix instead. This is handled in Task 9 (codegen) where `v.id("tableName")` in user code maps to the correct prefix at validation time.

**Important:** The prefix validation here checks against `json.tableName`. For custom prefixes, the codegen will emit `v.id("cus")` (the prefix) rather than `v.id("customers")` (the table name) when generating argument validators. The `Id<"customers">` TypeScript type is separate from the runtime prefix check. We'll revisit this in Task 9 if needed.

Actually, let's keep it simpler: `v.id("tableName")` always validates that the prefix matches the table name. When a custom `idPrefix` is set, the generated IDs will use that prefix, so the validation needs to check against the prefix, not the table name. Let's add an optional `idPrefix` field to the `ValidatorJSON` for the `id` type.

- [ ] **Step 4: Update ValidatorJSON to support idPrefix**

In `packages/values/src/types.ts`, update the `id` variant (line 23):

```typescript
  | { type: "id"; tableName: string; idPrefix?: string }
```

- [ ] **Step 5: Update validation to use idPrefix when available**

Update the `id` validation block in `packages/values/src/serialize.ts`:

```typescript
  if (json.type === "id") {
    if (typeof value !== "string") {
      throw new Error(`Expected id (string), got ${typeof value}`)
    }
    const underscoreIdx = (value as string).lastIndexOf("_")
    if (underscoreIdx < 1) {
      throw new Error(
        `Expected id for table "${json.tableName}" in TypeID format (prefix_suffix), got "${value}"`
      )
    }
    const prefix = (value as string).slice(0, underscoreIdx)
    const expectedPrefix = json.idPrefix ?? json.tableName
    if (prefix !== expectedPrefix) {
      throw new Error(
        `Expected id for table "${json.tableName}" (prefix "${expectedPrefix}"), got prefix "${prefix}"`
      )
    }
    return value as T
  }
```

- [ ] **Step 6: Update v.id() to accept optional idPrefix**

In `packages/values/src/validators.ts`, update the `id` method (line 32):

```typescript
  id<T extends string>(tableName: T, idPrefix?: string): Validator<Id<T>> {
    return createValidator<Id<T>, "id">("id", { type: "id", tableName, idPrefix });
  },
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
bun test packages/values/src/values.test.ts
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/values/src/serialize.ts packages/values/src/types.ts packages/values/src/validators.ts packages/values/src/values.test.ts
git commit -m "feat: validate TypeID format and prefix in v.id()"
```

---

### Task 8: Update Reader and MutationExecutor Tests

**Files:**
- Modify: `packages/server/src/db/reader.test.ts`
- Modify: `packages/server/src/runtime/MutationExecutor.test.ts`

- [ ] **Step 1: Update reader.test.ts hardcoded IDs**

In `packages/server/src/db/reader.test.ts`, replace all `"table:id"` format IDs with `"table_id"` format. These are mock IDs (not real TypeIDs) used in unit tests — they just need to have the `_` separator so `tableFromId()` works correctly.

Replace throughout the file:
- `"tasks:abc"` → `"tasks_abc"`
- `"tasks:missing"` → `"tasks_missing"`
- `"tasks:1"` → `"tasks_0000000000000000000000001"`
- `"tasks:2"` → `"tasks_0000000000000000000000002"`
- `"t:1"` → `"t_0000000000000000000000001"`

Use find-and-replace. The mock IDs don't need to be valid TypeIDs since reader tests only test table extraction and ops delegation.

- [ ] **Step 2: Update MutationExecutor.test.ts hardcoded IDs**

In `packages/server/src/runtime/MutationExecutor.test.ts`, replace:
- `"tasks:1"` → `"tasks_0000000000000000000000001"` (lines 49, 76, 127, 128, 129, 148, 167)

- [ ] **Step 3: Run updated tests**

```bash
bun test packages/server/src/db/reader.test.ts packages/server/src/runtime/MutationExecutor.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/reader.test.ts packages/server/src/runtime/MutationExecutor.test.ts
git commit -m "test: update hardcoded IDs to TypeID format"
```

---

### Task 9: Update Codegen to Emit idPrefixes Map

**Files:**
- Modify: `packages/cli/src/codegen/dataModel.ts`
- Modify: `packages/cli/src/codegen/server.ts`

- [ ] **Step 1: Update dataModel.ts codegen**

In `packages/cli/src/codegen/dataModel.ts`, add the `idPrefixes` constant generation after the `DataModel` type. Add this before the final `fs.writeFileSync`:

```typescript
  // Generate idPrefixes map
  lines.push("")
  lines.push(`export const idPrefixes = {`)
  for (const [tableName, table] of Object.entries(schema.tables)) {
    const prefix = table.idPrefix ?? tableName
    lines.push(`  ${quotePropertyName(tableName)}: "${prefix}",`)
  }
  lines.push(`} as const;`)
```

- [ ] **Step 2: Update server.ts codegen**

In `packages/cli/src/codegen/server.ts`, add the same `idPrefixes` constant. Add before the factory function lines:

```typescript
  // Generate idPrefixes map
  lines.push(`export const idPrefixes = {`)
  for (const [tableName, table] of Object.entries(schema.tables)) {
    const prefix = table.idPrefix ?? tableName
    lines.push(`  ${quotePropertyName(tableName)}: "${prefix}",`)
  }
  lines.push(`} as const;`)
  lines.push("")
```

- [ ] **Step 3: Run codegen tests if they exist, otherwise run full CLI tests**

```bash
bun test packages/cli/
```

Expected: PASS (or no tests — codegen output is tested via e2e).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/codegen/dataModel.ts packages/cli/src/codegen/server.ts
git commit -m "feat: generate idPrefixes map in codegen output"
```

---

### Task 10: Migration Function

**Files:**
- Create: `packages/server/src/migration/migrateIds.ts`
- Create: `packages/server/src/migration/migrateIds.test.ts`

- [ ] **Step 1: Write migration tests**

Create `packages/server/src/migration/migrateIds.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { convertOldIdToTypeId, buildIdMappings } from "./migrateIds"

describe("convertOldIdToTypeId", () => {
  it("converts table:ULID to TypeID format", () => {
    const oldId = "posts:01ARZ3NDEKTSV4RRFFQ69G5FAV"
    const newId = convertOldIdToTypeId(oldId, "posts")
    expect(newId).toMatch(/^posts_[0-9a-hjkmnp-tv-z]{26}$/)
  })

  it("uses custom prefix", () => {
    const oldId = "customers:01ARZ3NDEKTSV4RRFFQ69G5FAV"
    const newId = convertOldIdToTypeId(oldId, "cus")
    expect(newId).toMatch(/^cus_[0-9a-hjkmnp-tv-z]{26}$/)
  })

  it("preserves timestamp from ULID", () => {
    // ULID "01ARZ3NDEKTSV4RRFFQ69G5FAV" has a known timestamp
    const oldId = "posts:01ARZ3NDEKTSV4RRFFQ69G5FAV"
    const newId = convertOldIdToTypeId(oldId, "posts")

    // Extract timestamp from old ULID (first 10 chars = 48-bit ms timestamp in Crockford base32)
    // and from new TypeID's UUIDv7 — they should match
    // We just verify both produce the same _creationTime
    const { fromString } = require("typeid-js")
    const tid = fromString(newId)
    const uuid = tid.toUUID()
    const hex = uuid.replace(/-/g, "")
    const newTimestamp = parseInt(hex.slice(0, 12), 16)

    // decodeTime from the original ULID
    const { decodeTime } = require("ulidx")
    const oldTimestamp = decodeTime("01ARZ3NDEKTSV4RRFFQ69G5FAV")

    expect(newTimestamp).toBe(oldTimestamp)
  })
})

describe("buildIdMappings", () => {
  it("builds old->new ID mapping for a table", () => {
    const oldIds = [
      "posts:01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "posts:01BX5ZZKBKACTAV9WEVGEMMVRZ",
    ]
    const mapping = buildIdMappings(oldIds, "posts")
    expect(mapping.size).toBe(2)
    for (const [oldId, newId] of mapping) {
      expect(oldId).toMatch(/^posts:/)
      expect(newId).toMatch(/^posts_/)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/server/src/migration/migrateIds.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement migration function**

Create `packages/server/src/migration/migrateIds.ts`:

```typescript
import { typeid, fromUUID } from "typeid-js"
import type { SchemaJSON } from "../types.js"

/**
 * Decode a ULID's 48-bit timestamp (Crockford base32, first 10 chars).
 */
function ulidTimestamp(ulid: string): number {
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let timestamp = 0
  for (let i = 0; i < 10; i++) {
    timestamp = timestamp * 32 + CROCKFORD.indexOf(ulid[i].toUpperCase())
  }
  return timestamp
}

/**
 * Convert a ULID timestamp into a UUIDv7 with the same 48-bit ms timestamp.
 * Random bits are freshly generated.
 */
function ulidTimestampToUuidV7(ulid: string): string {
  const ms = ulidTimestamp(ulid)
  // 48-bit timestamp as 12 hex chars
  const tsHex = ms.toString(16).padStart(12, "0")
  // Random parts
  const randA = Math.random().toString(16).slice(2, 5) // 12 bits
  const randB = Math.random().toString(16).slice(2, 16).padEnd(16, "0") // 62 bits (with variant prefix)

  // UUIDv7: tttttttt-tttt-7rrr-Nrrr-rrrrrrrrrrrr
  // t = timestamp, 7 = version, N = variant (8,9,a,b), r = random
  const variantNibble = (0x8 + (parseInt(randB[0], 16) & 0x3)).toString(16)
  const uuid = [
    tsHex.slice(0, 8),
    tsHex.slice(8, 12),
    "7" + randA,
    variantNibble + randB.slice(1, 4),
    randB.slice(4, 16),
  ].join("-")

  return uuid
}

/**
 * Convert an old-format ID ("table:ULID") to TypeID format ("prefix_base32suffix").
 * Preserves the 48-bit timestamp so _creationTime is unchanged.
 */
export function convertOldIdToTypeId(oldId: string, prefix: string): string {
  const colonIdx = oldId.indexOf(":")
  const ulid = colonIdx >= 0 ? oldId.slice(colonIdx + 1) : oldId
  const uuid = ulidTimestampToUuidV7(ulid)
  return fromUUID(uuid, prefix).toString()
}

/**
 * Build a mapping of old IDs to new TypeIDs for a set of old IDs.
 */
export function buildIdMappings(
  oldIds: string[],
  prefix: string
): Map<string, string> {
  const mapping = new Map<string, string>()
  for (const oldId of oldIds) {
    mapping.set(oldId, convertOldIdToTypeId(oldId, prefix))
  }
  return mapping
}

export type MigrateOptions = {
  /** Path to the SQLite database file */
  dbPath: string
  /** The schema definition (contains table names, field types, and idPrefix config) */
  schema: SchemaJSON
  /** If true, log what would change without modifying data */
  dryRun?: boolean
}

/**
 * Migrate all IDs in a SQLite database from old "table:ULID" format to TypeID format.
 *
 * - Converts all _id primary keys
 * - Updates all v.id() foreign key references
 * - Runs in a single transaction (all-or-nothing)
 * - Preserves _creationTime by copying the 48-bit ULID timestamp into UUIDv7
 */
export async function migrateIds(options: MigrateOptions): Promise<void> {
  const { Database } = await import("bun:sqlite")
  const db = new Database(options.dbPath)

  const { schema, dryRun } = options

  // Build prefix map
  const prefixMap = new Map<string, string>()
  for (const [tableName, table] of Object.entries(schema.tables)) {
    prefixMap.set(tableName, table.idPrefix ?? tableName)
  }

  // Collect all old→new ID mappings across all tables
  const globalIdMap = new Map<string, string>()

  try {
    db.exec("BEGIN TRANSACTION")

    // Phase 1: Build ID mappings for all tables
    for (const [tableName, table] of Object.entries(schema.tables)) {
      const prefix = prefixMap.get(tableName)!
      const rows = db.query(`SELECT _id FROM "${tableName}"`).all() as { _id: string }[]

      for (const row of rows) {
        if (row._id.includes(":")) {
          // Old format — needs migration
          const newId = convertOldIdToTypeId(row._id, prefix)
          globalIdMap.set(row._id, newId)
          if (dryRun) {
            console.log(`[dry-run] ${tableName}: ${row._id} → ${newId}`)
          }
        }
      }
    }

    if (dryRun) {
      console.log(`\n[dry-run] ${globalIdMap.size} IDs would be migrated.`)
      db.exec("ROLLBACK")
      return
    }

    // Phase 2: Update _id primary keys
    for (const [tableName] of Object.entries(schema.tables)) {
      const rows = db.query(`SELECT _id FROM "${tableName}"`).all() as { _id: string }[]
      for (const row of rows) {
        const newId = globalIdMap.get(row._id)
        if (newId) {
          db.exec(`UPDATE "${tableName}" SET _id = ? WHERE _id = ?`, newId, row._id)
        }
      }
    }

    // Phase 3: Update foreign key references (v.id() fields)
    for (const [tableName, table] of Object.entries(schema.tables)) {
      for (const [fieldName, fieldValidator] of Object.entries(table.fields)) {
        const isIdField =
          fieldValidator.type === "id" ||
          (fieldValidator.type === "optional" && (fieldValidator as any).value?.type === "id")

        if (isIdField) {
          const rows = db.query(`SELECT _id, "${fieldName}" FROM "${tableName}" WHERE "${fieldName}" IS NOT NULL`).all() as Record<string, string>[]
          for (const row of rows) {
            const oldRef = row[fieldName]
            const newRef = globalIdMap.get(oldRef)
            if (newRef) {
              db.exec(
                `UPDATE "${tableName}" SET "${fieldName}" = ? WHERE _id = ?`,
                newRef,
                row._id
              )
            }
          }
        }
      }
    }

    db.exec("COMMIT")
    console.log(`Migrated ${globalIdMap.size} IDs successfully.`)
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  } finally {
    db.close()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/server/src/migration/migrateIds.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/migration/
git commit -m "feat: add migrateIds function for old table:ULID to TypeID migration"
```

---

### Task 11: Wire Everything Together and Run Full Test Suite

**Files:**
- Verify all packages build and tests pass

- [ ] **Step 1: Check for any remaining ulidx references**

```bash
grep -r "ulidx" packages/ --include="*.ts" -l
```

Expected: No results. If any remain, update them (likely import statements).

- [ ] **Step 2: Check for any remaining ":" separator usage in ID logic**

```bash
grep -rn 'indexOf(":")' packages/ --include="*.ts"
```

Expected: No results in ID-related code. May appear in other contexts (URL parsing, etc.) which is fine.

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 4: Run type checking**

```bash
bun run typecheck
```

Expected: No type errors.

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: clean up remaining ULID references and verify full test suite"
```

---

### Task 12: E2E Verification

**Files:**
- Verify: `e2e/zeroback.test.ts`
- Verify: `examples/task-manager/`

- [ ] **Step 1: Check if example schema needs table name adjustments**

Table names in `examples/task-manager/` must be valid TypeID prefixes (lowercase alpha, 1-63 chars). Check:

```bash
grep -n "defineTable\|defineSchema" examples/task-manager/zeroback/ -r
```

If any table names use underscores or non-alpha characters, add `.idPrefix()` or rename them.

- [ ] **Step 2: Run e2e tests**

```bash
bun test e2e/
```

Expected: PASS — e2e tests don't assert on ID format.

- [ ] **Step 3: Commit any example adjustments**

```bash
git add examples/
git commit -m "chore: update example app for TypeID compatibility"
```

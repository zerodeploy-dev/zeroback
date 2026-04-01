import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SqlApi } from "../types"
import type { CleanedWhere } from "better-auth/adapters"
import { buildWhere } from "./DOSQLiteAdapter"

// ---------------------------------------------------------------------------
// Mock SqlApi factory
// ---------------------------------------------------------------------------

type SqlCall = { query: string; params: unknown[] }

function makeSql(
  rows: Record<string, unknown>[] = []
): SqlApi & { calls: SqlCall[] } {
  const calls: SqlCall[] = []
  return {
    calls,
    exec(query: string, ...bindings: unknown[]) {
      calls.push({ query, params: bindings })
      return { toArray: () => rows }
    },
  }
}

// ---------------------------------------------------------------------------
// Inline adapter logic (same as DOSQLiteAdapter.ts) for direct unit testing.
// NOTE: The adapter methods below are tested via the inline createAdapter helper
// which mirrors DOSQLiteAdapter.ts. The buildWhere function is imported directly
// from the real implementation above.
// ---------------------------------------------------------------------------

function createAdapter(sql: SqlApi) {
  return {
    async create<T extends Record<string, any>>({
      model,
      data,
      select,
    }: {
      model: string
      data: T
      select?: string[]
    }): Promise<T> {
      const table = `_auth_${model}`
      const keys = Object.keys(data)
      const cols = keys.map((k) => `"${k}"`).join(", ")
      const placeholders = keys.map(() => "?").join(", ")
      const values = keys.map((k) => data[k])

      sql.exec(
        `INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`,
        ...values
      )

      const selectCols =
        select && select.length > 0
          ? select.map((c) => `"${c}"`).join(", ")
          : "*"
      const rows = sql
        .exec(`SELECT ${selectCols} FROM "${table}" WHERE "id" = ?`, data.id)
        .toArray()

      return (rows[0] ?? data) as T
    },

    async findOne<T>({
      model,
      where,
      select,
      join,
    }: {
      model: string
      where: CleanedWhere[]
      select?: string[]
      join?: unknown
    }): Promise<T | null> {
      if (join) throw new Error("DOSQLiteAdapter: join queries are not supported. Use separate queries instead.")

      const table = `_auth_${model}`
      const selectCols =
        select && select.length > 0
          ? select.map((c) => `"${c}"`).join(", ")
          : "*"

      let query = `SELECT ${selectCols} FROM "${table}"`
      const params: unknown[] = []

      if (where.length > 0) {
        const built = buildWhere(where)
        query += ` WHERE ${built.sql}`
        params.push(...built.params)
      }

      query += " LIMIT 1"

      const rows = sql.exec(query, ...params).toArray()
      return (rows[0] ?? null) as T | null
    },

    async findMany<T>({
      model,
      where,
      limit,
      select,
      sortBy,
      offset,
      join,
    }: {
      model: string
      where?: CleanedWhere[]
      limit: number
      select?: string[]
      sortBy?: { field: string; direction: "asc" | "desc" }
      offset?: number
      join?: unknown
    }): Promise<T[]> {
      if (join) throw new Error("DOSQLiteAdapter: join queries are not supported. Use separate queries instead.")

      const table = `_auth_${model}`
      const selectCols =
        select && select.length > 0
          ? select.map((c) => `"${c}"`).join(", ")
          : "*"

      let query = `SELECT ${selectCols} FROM "${table}"`
      const params: unknown[] = []

      if (where && where.length > 0) {
        const built = buildWhere(where)
        query += ` WHERE ${built.sql}`
        params.push(...built.params)
      }

      if (sortBy) {
        query += ` ORDER BY "${sortBy.field}" ${sortBy.direction.toUpperCase()}`
      }

      query += ` LIMIT ${limit}`

      if (offset !== undefined) {
        query += ` OFFSET ${offset}`
      }

      const rows = sql.exec(query, ...params).toArray()
      return rows as T[]
    },

    async update<T>({
      model,
      where,
      update,
    }: {
      model: string
      where: CleanedWhere[]
      update: T
    }): Promise<T | null> {
      if (where.length === 0) throw new Error("DOSQLiteAdapter: empty where clause not allowed in update/delete")

      const table = `_auth_${model}`
      const updateData = update as Record<string, unknown>
      const keys = Object.keys(updateData)
      const setClauses = keys.map((k) => `"${k}" = ?`).join(", ")
      const setValues = keys.map((k) => updateData[k])

      const built = buildWhere(where)
      const query = `UPDATE "${table}" SET ${setClauses} WHERE ${built.sql}`

      sql.exec(query, ...setValues, ...built.params)

      const selectQuery = `SELECT * FROM "${table}" WHERE ${built.sql} LIMIT 1`
      const rows = sql.exec(selectQuery, ...built.params).toArray()
      return (rows[0] ?? null) as T | null
    },

    async updateMany({
      model,
      where,
      update,
    }: {
      model: string
      where: CleanedWhere[]
      update: Record<string, any>
    }): Promise<number> {
      if (where.length === 0) throw new Error("DOSQLiteAdapter: empty where clause not allowed in update/delete")

      const table = `_auth_${model}`
      const keys = Object.keys(update)
      const setClauses = keys.map((k) => `"${k}" = ?`).join(", ")
      const setValues = keys.map((k) => update[k])

      const built = buildWhere(where)
      sql.exec(
        `UPDATE "${table}" SET ${setClauses} WHERE ${built.sql}`,
        ...setValues,
        ...built.params
      )

      const cnt = sql.exec("SELECT changes() as cnt").toArray()[0]?.cnt ?? 0
      return cnt as number
    },

    async delete({
      model,
      where,
    }: {
      model: string
      where: CleanedWhere[]
    }): Promise<void> {
      if (where.length === 0) throw new Error("DOSQLiteAdapter: empty where clause not allowed in update/delete")

      const table = `_auth_${model}`
      const built = buildWhere(where)
      sql.exec(`DELETE FROM "${table}" WHERE ${built.sql}`, ...built.params)
    },

    async deleteMany({
      model,
      where,
    }: {
      model: string
      where: CleanedWhere[]
    }): Promise<number> {
      if (where.length === 0) throw new Error("DOSQLiteAdapter: empty where clause not allowed in update/delete")

      const table = `_auth_${model}`
      const built = buildWhere(where)
      sql.exec(`DELETE FROM "${table}" WHERE ${built.sql}`, ...built.params)

      const cnt = sql.exec("SELECT changes() as cnt").toArray()[0]?.cnt ?? 0
      return cnt as number
    },

    async count({
      model,
      where,
    }: {
      model: string
      where?: CleanedWhere[]
    }): Promise<number> {
      const table = `_auth_${model}`
      let query = `SELECT COUNT(*) as cnt FROM "${table}"`
      const params: unknown[] = []

      if (where && where.length > 0) {
        const built = buildWhere(where)
        query += ` WHERE ${built.sql}`
        params.push(...built.params)
      }

      const rows = sql.exec(query, ...params).toArray()
      return (rows[0]?.cnt ?? 0) as number
    },
  }
}

// ---------------------------------------------------------------------------
// runAuthMigrations inline logic for testing (same as impl)
// ---------------------------------------------------------------------------

import type { DBFieldAttribute } from "better-auth"

function fieldTypeToSQLite(type: DBFieldAttribute["type"]): string {
  if (Array.isArray(type)) return "TEXT"
  if ((type as string).endsWith("[]")) return "TEXT"
  switch (type) {
    case "string": return "TEXT"
    case "number": return "INTEGER"
    case "boolean": return "INTEGER"
    case "date": return "TEXT"
    case "json": return "TEXT"
    default: return "TEXT"
  }
}

type DBFieldAttributeConfig = DBFieldAttribute & { unique?: boolean }

function runMigrations(
  sql: SqlApi,
  schema: Record<string, { fields: Record<string, DBFieldAttribute>; order: number }>
): void {
  const entries = Object.entries(schema).sort(
    ([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0)
  )

  for (const [modelName, { fields }] of entries) {
    const table = `_auth_${modelName}`

    const existing = sql
      .exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        table
      )
      .toArray()

    if (existing.length === 0) {
      const colDefs = [`"id" TEXT PRIMARY KEY`]
      for (const [fieldName, attr] of Object.entries(fields)) {
        const sqlType = fieldTypeToSQLite(attr.type)
        colDefs.push(`"${fieldName}" ${sqlType}`)
      }
      sql.exec(`CREATE TABLE "${table}" (${colDefs.join(", ")})`)
    } else {
      const existingCols = sql
        .exec(`PRAGMA table_info("${table}")`)
        .toArray()
        .map((row) => row["name"] as string)

      for (const [fieldName, attr] of Object.entries(fields)) {
        if (!existingCols.includes(fieldName)) {
          const sqlType = fieldTypeToSQLite(attr.type)
          sql.exec(`ALTER TABLE "${table}" ADD COLUMN "${fieldName}" ${sqlType}`)
        }
      }
    }

    // Create UNIQUE indexes for fields marked unique
    for (const [fieldName, attr] of Object.entries(fields)) {
      const fieldDef = attr as DBFieldAttributeConfig
      if (fieldDef.unique === true) {
        sql.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_${fieldName}" ON "${table}" ("${fieldName}")`
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildWhere", () => {
  it("builds eq clause by default", () => {
    const result = buildWhere([
      { field: "email", operator: "eq", value: "test@example.com", connector: "AND" },
    ])
    expect(result.sql).toBe('"email" = ?')
    expect(result.params).toEqual(["test@example.com"])
  })

  it("builds ne clause", () => {
    const result = buildWhere([
      { field: "status", operator: "ne", value: "deleted", connector: "AND" },
    ])
    expect(result.sql).toBe('"status" != ?')
    expect(result.params).toEqual(["deleted"])
  })

  it("builds in clause", () => {
    const result = buildWhere([
      { field: "role", operator: "in", value: ["admin", "user"], connector: "AND" },
    ])
    expect(result.sql).toBe('"role" IN (?, ?)')
    expect(result.params).toEqual(["admin", "user"])
  })

  it("builds not_in clause", () => {
    const result = buildWhere([
      { field: "role", operator: "not_in", value: ["banned"], connector: "AND" },
    ])
    expect(result.sql).toBe('"role" NOT IN (?)')
    expect(result.params).toEqual(["banned"])
  })

  it("builds contains clause with ESCAPE", () => {
    const result = buildWhere([
      { field: "name", operator: "contains", value: "doe", connector: "AND" },
    ])
    expect(result.sql).toBe(`"name" LIKE ? ESCAPE '\\'`)
    expect(result.params).toEqual(["%doe%"])
  })

  it("builds starts_with clause with ESCAPE", () => {
    const result = buildWhere([
      { field: "name", operator: "starts_with", value: "John", connector: "AND" },
    ])
    expect(result.sql).toBe(`"name" LIKE ? ESCAPE '\\'`)
    expect(result.params).toEqual(["John%"])
  })

  it("builds ends_with clause with ESCAPE", () => {
    const result = buildWhere([
      { field: "email", operator: "ends_with", value: "@example.com", connector: "AND" },
    ])
    expect(result.sql).toBe(`"email" LIKE ? ESCAPE '\\'`)
    expect(result.params).toEqual(["%@example.com"])
  })

  it("escapes LIKE wildcards in contains", () => {
    const result = buildWhere([
      { field: "name", operator: "contains", value: "50% off_deal", connector: "AND" },
    ])
    expect(result.params).toEqual(["%50\\% off\\_deal%"])
  })

  it("escapes LIKE wildcards in starts_with", () => {
    const result = buildWhere([
      { field: "name", operator: "starts_with", value: "100%_", connector: "AND" },
    ])
    expect(result.params).toEqual(["100\\%\\_%"])
  })

  it("escapes LIKE wildcards in ends_with", () => {
    const result = buildWhere([
      { field: "name", operator: "ends_with", value: "%done", connector: "AND" },
    ])
    expect(result.params).toEqual(["%\\%done"])
  })

  it("combines multiple clauses with AND", () => {
    const result = buildWhere([
      { field: "active", operator: "eq", value: 1, connector: "AND" },
      { field: "role", operator: "eq", value: "admin", connector: "AND" },
    ])
    expect(result.sql).toBe('"active" = ? AND "role" = ?')
    expect(result.params).toEqual([1, "admin"])
  })

  it("combines multiple clauses with OR", () => {
    const result = buildWhere([
      { field: "role", operator: "eq", value: "admin", connector: "AND" },
      { field: "role", operator: "eq", value: "superuser", connector: "OR" },
    ])
    expect(result.sql).toBe('"role" = ? OR "role" = ?')
    expect(result.params).toEqual(["admin", "superuser"])
  })
})

describe("Adapter: create", () => {
  it("inserts row and returns the data", async () => {
    const data = { id: "user_1", email: "a@b.com", name: "Alice" }
    const sql = makeSql([data])
    const adapter = createAdapter(sql)

    const result = await adapter.create({ model: "user", data })

    // First call: INSERT
    expect(sql.calls[0].query).toContain('INSERT INTO "_auth_user"')
    expect(sql.calls[0].query).toContain('"id"')
    expect(sql.calls[0].query).toContain('"email"')
    expect(sql.calls[0].params).toEqual(["user_1", "a@b.com", "Alice"])

    // Second call: SELECT back
    expect(sql.calls[1].query).toContain('SELECT * FROM "_auth_user"')
    expect(sql.calls[1].query).toContain('"id" = ?')
    expect(sql.calls[1].params).toEqual(["user_1"])

    expect(result).toEqual(data)
  })

  it("falls back to data if SELECT returns empty (new row)", async () => {
    const data = { id: "user_2", email: "b@b.com", name: "Bob" }
    // INSERT returns nothing, SELECT also returns nothing
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    const result = await adapter.create({ model: "user", data })
    expect(result).toEqual(data)
  })
})

describe("Adapter: findOne", () => {
  it("builds SELECT with WHERE clause for eq", async () => {
    const row = { id: "user_1", email: "a@b.com" }
    const sql = makeSql([row])
    const adapter = createAdapter(sql)

    const result = await adapter.findOne({
      model: "user",
      where: [{ field: "email", operator: "eq", value: "a@b.com", connector: "AND" }],
    })

    expect(sql.calls[0].query).toBe(
      'SELECT * FROM "_auth_user" WHERE "email" = ? LIMIT 1'
    )
    expect(sql.calls[0].params).toEqual(["a@b.com"])
    expect(result).toEqual(row)
  })

  it("returns null when not found", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    const result = await adapter.findOne({
      model: "user",
      where: [{ field: "id", operator: "eq", value: "missing", connector: "AND" }],
    })

    expect(result).toBeNull()
  })

  it("uses select columns when specified", async () => {
    const sql = makeSql([{ email: "a@b.com" }])
    const adapter = createAdapter(sql)

    await adapter.findOne({
      model: "user",
      where: [{ field: "id", operator: "eq", value: "user_1", connector: "AND" }],
      select: ["email"],
    })

    expect(sql.calls[0].query).toContain('SELECT "email" FROM "_auth_user"')
  })

  it("throws when join is provided", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    await expect(
      adapter.findOne({
        model: "user",
        where: [{ field: "id", operator: "eq", value: "u1", connector: "AND" }],
        join: { table: "session", on: "userId" },
      })
    ).rejects.toThrow("DOSQLiteAdapter: join queries are not supported")
  })
})

describe("Adapter: findMany", () => {
  it("builds correct SQL with where, limit, offset, sortBy", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    await adapter.findMany({
      model: "session",
      where: [{ field: "userId", operator: "eq", value: "u1", connector: "AND" }],
      limit: 10,
      offset: 5,
      sortBy: { field: "createdAt", direction: "desc" },
    })

    const query = sql.calls[0].query
    expect(query).toContain('SELECT * FROM "_auth_session"')
    expect(query).toContain('"userId" = ?')
    expect(query).toContain('ORDER BY "createdAt" DESC')
    expect(query).toContain("LIMIT 10")
    expect(query).toContain("OFFSET 5")
    expect(sql.calls[0].params).toEqual(["u1"])
  })

  it("omits WHERE clause when no where provided", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    await adapter.findMany({ model: "user", limit: 100 })

    const query = sql.calls[0].query
    expect(query).not.toContain("WHERE")
    expect(query).toContain("LIMIT 100")
  })

  it("returns empty array when nothing found", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)
    const result = await adapter.findMany({ model: "user", limit: 10 })
    expect(result).toEqual([])
  })

  it("throws when join is provided", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    await expect(
      adapter.findMany({
        model: "user",
        limit: 10,
        join: { table: "session", on: "userId" },
      })
    ).rejects.toThrow("DOSQLiteAdapter: join queries are not supported")
  })
})

describe("Adapter: update", () => {
  it("runs UPDATE and then SELECT to return updated row", async () => {
    const updated = { id: "u1", name: "Updated" }
    const sql = makeSql([updated])
    const adapter = createAdapter(sql)

    const result = await adapter.update({
      model: "user",
      where: [{ field: "id", operator: "eq", value: "u1", connector: "AND" }],
      update: { name: "Updated" },
    })

    // First call is UPDATE
    expect(sql.calls[0].query).toContain('UPDATE "_auth_user" SET "name" = ?')
    expect(sql.calls[0].query).toContain('"id" = ?')
    expect(sql.calls[0].params).toEqual(["Updated", "u1"])

    // Second call is SELECT
    expect(sql.calls[1].query).toContain('SELECT * FROM "_auth_user" WHERE "id" = ? LIMIT 1')
    expect(result).toEqual(updated)
  })

  it("returns null when record not found after update", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    const result = await adapter.update({
      model: "user",
      where: [{ field: "id", operator: "eq", value: "missing", connector: "AND" }],
      update: { name: "X" },
    })

    expect(result).toBeNull()
  })

  it("throws when where is empty", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    await expect(
      adapter.update({ model: "user", where: [], update: { name: "X" } })
    ).rejects.toThrow("DOSQLiteAdapter: empty where clause not allowed in update/delete")
  })
})

describe("Adapter: updateMany", () => {
  it("updates and returns affected count via changes()", async () => {
    let callCount = 0
    const calls: SqlCall[] = []
    const sql: SqlApi & { calls: SqlCall[] } = {
      calls,
      exec(query: string, ...bindings: unknown[]) {
        calls.push({ query, params: bindings })
        callCount++
        // Second call is SELECT changes()
        if (query.includes("changes()")) {
          return { toArray: () => [{ cnt: 3 }] }
        }
        return { toArray: () => [] }
      },
    }

    const adapter = createAdapter(sql)

    const count = await adapter.updateMany({
      model: "user",
      where: [{ field: "active", operator: "eq", value: 1, connector: "AND" }],
      update: { role: "member" },
    })

    expect(count).toBe(3)
    // First call is UPDATE (not COUNT)
    expect(sql.calls[0].query).toContain('UPDATE "_auth_user" SET "role" = ?')
    expect(sql.calls[0].query).not.toContain("COUNT")
    // Second call is SELECT changes()
    expect(sql.calls[1].query).toBe("SELECT changes() as cnt")
  })

  it("throws when where is empty", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    await expect(
      adapter.updateMany({ model: "user", where: [], update: { role: "x" } })
    ).rejects.toThrow("DOSQLiteAdapter: empty where clause not allowed in update/delete")
  })
})

describe("Adapter: delete", () => {
  it("executes DELETE with correct WHERE", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    await adapter.delete({
      model: "session",
      where: [{ field: "id", operator: "eq", value: "sess_1", connector: "AND" }],
    })

    expect(sql.calls[0].query).toBe('DELETE FROM "_auth_session" WHERE "id" = ?')
    expect(sql.calls[0].params).toEqual(["sess_1"])
  })

  it("throws when where is empty", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    await expect(
      adapter.delete({ model: "session", where: [] })
    ).rejects.toThrow("DOSQLiteAdapter: empty where clause not allowed in update/delete")
  })
})

describe("Adapter: deleteMany", () => {
  it("deletes and returns affected count via changes()", async () => {
    let callCount = 0
    const calls: SqlCall[] = []
    const sql: SqlApi & { calls: SqlCall[] } = {
      calls,
      exec(query: string, ...bindings: unknown[]) {
        calls.push({ query, params: bindings })
        callCount++
        if (query.includes("changes()")) {
          return { toArray: () => [{ cnt: 5 }] }
        }
        return { toArray: () => [] }
      },
    }

    const adapter = createAdapter(sql)

    const count = await adapter.deleteMany({
      model: "session",
      where: [{ field: "userId", operator: "eq", value: "u1", connector: "AND" }],
    })

    expect(count).toBe(5)
    // First call is DELETE (not COUNT)
    expect(sql.calls[0].query).toContain('DELETE FROM "_auth_session"')
    expect(sql.calls[0].query).not.toContain("COUNT")
    // Second call is SELECT changes()
    expect(sql.calls[1].query).toBe("SELECT changes() as cnt")
  })

  it("throws when where is empty", async () => {
    const sql = makeSql([])
    const adapter = createAdapter(sql)

    await expect(
      adapter.deleteMany({ model: "session", where: [] })
    ).rejects.toThrow("DOSQLiteAdapter: empty where clause not allowed in update/delete")
  })
})

describe("Adapter: count", () => {
  it("returns count without where", async () => {
    const sql = makeSql([{ cnt: 42 }])
    const adapter = createAdapter(sql)

    const count = await adapter.count({ model: "user" })

    expect(sql.calls[0].query).toBe('SELECT COUNT(*) as cnt FROM "_auth_user"')
    expect(count).toBe(42)
  })

  it("returns count with where", async () => {
    const sql = makeSql([{ cnt: 7 }])
    const adapter = createAdapter(sql)

    const count = await adapter.count({
      model: "user",
      where: [{ field: "active", operator: "eq", value: 1, connector: "AND" }],
    })

    expect(sql.calls[0].query).toContain("WHERE")
    expect(count).toBe(7)
  })
})

describe("runAuthMigrations", () => {
  it("creates tables that do not exist", () => {
    let callCount = 0
    const calls: SqlCall[] = []
    const sql: SqlApi & { calls: SqlCall[] } = {
      calls,
      exec(query: string, ...bindings: unknown[]) {
        calls.push({ query, params: bindings })
        callCount++
        // First call per table is sqlite_master check → return empty (table doesn't exist)
        if (query.includes("sqlite_master")) {
          return { toArray: () => [] }
        }
        return { toArray: () => [] }
      },
    }

    const schema: Record<string, { fields: Record<string, DBFieldAttribute>; order: number }> = {
      user: {
        order: 1,
        fields: {
          email: { type: "string" },
          name: { type: "string" },
          emailVerified: { type: "boolean" },
          createdAt: { type: "date" },
        },
      },
    }

    runMigrations(sql, schema)

    // Should have: 1 sqlite_master check + 1 CREATE TABLE (no unique fields)
    expect(calls).toHaveLength(2)
    expect(calls[0].query).toContain("sqlite_master")
    expect(calls[0].params).toEqual(["_auth_user"])

    const createQuery = calls[1].query
    expect(createQuery).toContain('CREATE TABLE "_auth_user"')
    expect(createQuery).toContain('"id" TEXT PRIMARY KEY')
    expect(createQuery).toContain('"email" TEXT')
    expect(createQuery).toContain('"emailVerified" INTEGER')
    expect(createQuery).toContain('"createdAt" TEXT')
  })

  it("adds missing columns to existing tables", () => {
    let callCount = 0
    const calls: SqlCall[] = []
    const sql: SqlApi & { calls: SqlCall[] } = {
      calls,
      exec(query: string, ...bindings: unknown[]) {
        calls.push({ query, params: bindings })
        callCount++

        if (query.includes("sqlite_master")) {
          // Table exists
          return { toArray: () => [{ name: "_auth_user" }] }
        }
        if (query.includes("PRAGMA")) {
          // Existing columns: only id and email exist
          return {
            toArray: () => [
              { name: "id" },
              { name: "email" },
            ],
          }
        }
        return { toArray: () => [] }
      },
    }

    const schema: Record<string, { fields: Record<string, DBFieldAttribute>; order: number }> = {
      user: {
        order: 1,
        fields: {
          email: { type: "string" },
          name: { type: "string" },     // missing
          image: { type: "string" },    // missing
        },
      },
    }

    runMigrations(sql, schema)

    const alterCalls = calls.filter((c) => c.query.includes("ALTER TABLE"))
    expect(alterCalls).toHaveLength(2)
    expect(alterCalls[0].query).toContain('"name" TEXT')
    expect(alterCalls[1].query).toContain('"image" TEXT')
  })

  it("does not add columns that already exist", () => {
    const calls: SqlCall[] = []
    const sql: SqlApi & { calls: SqlCall[] } = {
      calls,
      exec(query: string, ...bindings: unknown[]) {
        calls.push({ query, params: bindings })

        if (query.includes("sqlite_master")) {
          return { toArray: () => [{ name: "_auth_session" }] }
        }
        if (query.includes("PRAGMA")) {
          return {
            toArray: () => [
              { name: "id" },
              { name: "userId" },
              { name: "token" },
            ],
          }
        }
        return { toArray: () => [] }
      },
    }

    const schema: Record<string, { fields: Record<string, DBFieldAttribute>; order: number }> = {
      session: {
        order: 2,
        fields: {
          userId: { type: "string" },
          token: { type: "string" },
        },
      },
    }

    runMigrations(sql, schema)

    const alterCalls = calls.filter((c) => c.query.includes("ALTER TABLE"))
    expect(alterCalls).toHaveLength(0)
  })

  it("handles multiple tables in order", () => {
    const calls: SqlCall[] = []
    const sql: SqlApi & { calls: SqlCall[] } = {
      calls,
      exec(query: string, ...bindings: unknown[]) {
        calls.push({ query, params: bindings })
        if (query.includes("sqlite_master")) return { toArray: () => [] }
        return { toArray: () => [] }
      },
    }

    const schema: Record<string, { fields: Record<string, DBFieldAttribute>; order: number }> = {
      account: { order: 2, fields: { userId: { type: "string" } } },
      user: { order: 1, fields: { email: { type: "string" } } },
    }

    runMigrations(sql, schema)

    // user (order 1) should be created first
    const createCalls = calls.filter((c) => c.query.includes("CREATE TABLE"))
    expect(createCalls[0].query).toContain("_auth_user")
    expect(createCalls[1].query).toContain("_auth_account")
  })

  it("maps number fields to INTEGER", () => {
    const calls: SqlCall[] = []
    const sql: SqlApi & { calls: SqlCall[] } = {
      calls,
      exec(query: string, ...bindings: unknown[]) {
        calls.push({ query, params: bindings })
        if (query.includes("sqlite_master")) return { toArray: () => [] }
        return { toArray: () => [] }
      },
    }

    const schema: Record<string, { fields: Record<string, DBFieldAttribute>; order: number }> = {
      user: {
        order: 1,
        fields: {
          score: { type: "number" },
        },
      },
    }

    runMigrations(sql, schema)

    const createQuery = calls.find((c) => c.query.includes("CREATE TABLE"))?.query ?? ""
    expect(createQuery).toContain('"score" INTEGER')
  })

  it("creates UNIQUE INDEX for fields with unique: true", () => {
    const calls: SqlCall[] = []
    const sql: SqlApi & { calls: SqlCall[] } = {
      calls,
      exec(query: string, ...bindings: unknown[]) {
        calls.push({ query, params: bindings })
        if (query.includes("sqlite_master")) return { toArray: () => [] }
        return { toArray: () => [] }
      },
    }

    const schema: Record<string, { fields: Record<string, DBFieldAttributeConfig>; order: number }> = {
      user: {
        order: 1,
        fields: {
          email: { type: "string", unique: true },
          name: { type: "string" },
        },
      },
    }

    runMigrations(sql, schema as any)

    const indexCalls = calls.filter((c) => c.query.includes("CREATE UNIQUE INDEX"))
    expect(indexCalls).toHaveLength(1)
    expect(indexCalls[0].query).toContain('"idx__auth_user_email"')
    expect(indexCalls[0].query).toContain('ON "_auth_user" ("email")')
  })
})

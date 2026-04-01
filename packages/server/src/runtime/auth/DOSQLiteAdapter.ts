import { createAdapterFactory } from "better-auth/adapters"
import { getSchema } from "better-auth/db"
import type { BetterAuthOptions, DBFieldAttribute } from "better-auth"
import type { CleanedWhere } from "better-auth/adapters"
import type { SqlApi } from "../types"

// ---------------------------------------------------------------------------
// WHERE clause builder
// ---------------------------------------------------------------------------

function buildWhere(where: CleanedWhere[]): { sql: string; params: unknown[] } {
  const parts: string[] = []
  const params: unknown[] = []

  for (let i = 0; i < where.length; i++) {
    const clause = where[i]
    const { field, operator, value, connector } = clause

    const prefix = i === 0 ? "" : (connector === "OR" ? " OR " : " AND ")

    switch (operator) {
      case "in": {
        const arr = value as (string | number)[]
        const placeholders = arr.map(() => "?").join(", ")
        parts.push(`${prefix}"${field}" IN (${placeholders})`)
        params.push(...arr)
        break
      }
      case "not_in": {
        const arr = value as (string | number)[]
        const placeholders = arr.map(() => "?").join(", ")
        parts.push(`${prefix}"${field}" NOT IN (${placeholders})`)
        params.push(...arr)
        break
      }
      case "contains":
        parts.push(`${prefix}"${field}" LIKE ?`)
        params.push(`%${value}%`)
        break
      case "starts_with":
        parts.push(`${prefix}"${field}" LIKE ?`)
        params.push(`${value}%`)
        break
      case "ends_with":
        parts.push(`${prefix}"${field}" LIKE ?`)
        params.push(`%${value}`)
        break
      case "ne":
        parts.push(`${prefix}"${field}" != ?`)
        params.push(value)
        break
      case "lt":
        parts.push(`${prefix}"${field}" < ?`)
        params.push(value)
        break
      case "lte":
        parts.push(`${prefix}"${field}" <= ?`)
        params.push(value)
        break
      case "gt":
        parts.push(`${prefix}"${field}" > ?`)
        params.push(value)
        break
      case "gte":
        parts.push(`${prefix}"${field}" >= ?`)
        params.push(value)
        break
      default:
        // eq
        parts.push(`${prefix}"${field}" = ?`)
        params.push(value)
        break
    }
  }

  return { sql: parts.join(""), params }
}

// ---------------------------------------------------------------------------
// createDOSQLiteAdapter
// ---------------------------------------------------------------------------

export function createDOSQLiteAdapter(sql: SqlApi) {
  return createAdapterFactory({
    config: {
      adapterId: "do-sqlite",
      adapterName: "DO SQLite Adapter",
      supportsJSON: false,
      supportsDates: false,
      supportsBooleans: false,
      usePlural: false,
      debugLogs: false,
    },
    adapter: () => ({
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

        // Fetch the inserted row back
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
      }: {
        model: string
        where: CleanedWhere[]
        select?: string[]
        join?: unknown
      }): Promise<T | null> {
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
      }: {
        model: string
        where?: CleanedWhere[]
        limit: number
        select?: string[]
        sortBy?: { field: string; direction: "asc" | "desc" }
        offset?: number
        join?: unknown
      }): Promise<T[]> {
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
        const table = `_auth_${model}`
        const updateData = update as Record<string, unknown>
        const keys = Object.keys(updateData)
        const setClauses = keys.map((k) => `"${k}" = ?`).join(", ")
        const setValues = keys.map((k) => updateData[k])

        const built = buildWhere(where)
        const query = `UPDATE "${table}" SET ${setClauses} WHERE ${built.sql}`

        sql.exec(query, ...setValues, ...built.params)

        // Fetch the updated row
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
        const table = `_auth_${model}`
        const keys = Object.keys(update)
        const setClauses = keys.map((k) => `"${k}" = ?`).join(", ")
        const setValues = keys.map((k) => update[k])

        const built = buildWhere(where)

        // Count affected rows before update
        const countQuery = `SELECT COUNT(*) as cnt FROM "${table}" WHERE ${built.sql}`
        const countRows = sql.exec(countQuery, ...built.params).toArray()
        const count = (countRows[0]?.cnt ?? 0) as number

        const query = `UPDATE "${table}" SET ${setClauses} WHERE ${built.sql}`
        sql.exec(query, ...setValues, ...built.params)

        return count
      },

      async delete({
        model,
        where,
      }: {
        model: string
        where: CleanedWhere[]
      }): Promise<void> {
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
        const table = `_auth_${model}`
        const built = buildWhere(where)

        // Count before deletion
        const countRows = sql
          .exec(`SELECT COUNT(*) as cnt FROM "${table}" WHERE ${built.sql}`, ...built.params)
          .toArray()
        const count = (countRows[0]?.cnt ?? 0) as number

        sql.exec(`DELETE FROM "${table}" WHERE ${built.sql}`, ...built.params)
        return count
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
    }),
  })
}

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

function fieldTypeToSQLite(type: DBFieldAttribute["type"]): string {
  if (Array.isArray(type)) return "TEXT"
  if (type.endsWith("[]")) return "TEXT"
  switch (type) {
    case "string": return "TEXT"
    case "number": return "REAL"
    case "boolean": return "INTEGER"
    case "date": return "TEXT"
    case "json": return "TEXT"
    default: return "TEXT"
  }
}

export function runAuthMigrations(sql: SqlApi, options: BetterAuthOptions): void {
  const schema = getSchema(options)

  const entries = Object.entries(schema).sort(
    ([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0)
  )

  for (const [modelName, { fields }] of entries) {
    const table = `_auth_${modelName}`

    // Check if table exists
    const existing = sql
      .exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        table
      )
      .toArray()

    if (existing.length === 0) {
      // Create the table
      const colDefs = [`"id" TEXT PRIMARY KEY`]
      for (const [fieldName, attr] of Object.entries(fields)) {
        const sqlType = fieldTypeToSQLite(attr.type)
        colDefs.push(`"${fieldName}" ${sqlType}`)
      }
      sql.exec(`CREATE TABLE "${table}" (${colDefs.join(", ")})`)
    } else {
      // Add missing columns
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
  }
}

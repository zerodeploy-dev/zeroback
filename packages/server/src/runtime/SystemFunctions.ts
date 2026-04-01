import type { SchemaJSON, FilterExpressionJSON, ExprJSON, Id } from "@zeroback/server"
import { DatabaseReader, DatabaseWriter } from "@zeroback/server"
import type { TableColumnInfo } from "./db/SchemaMapper"
import type { SqlApi } from "./types"
import type { FunctionDef } from "./ZerobackDO"

type QueryCtx = { db: DatabaseReader<Record<string, unknown>> }
type MutationCtx = { db: DatabaseWriter<Record<string, unknown>> }

function systemQuery<A>(handler: (ctx: QueryCtx, args: A) => Promise<unknown>): FunctionDef {
  return { type: "query", isInternal: false, handler: handler as FunctionDef["handler"] }
}

function systemMutation<A>(handler: (ctx: MutationCtx, args: A) => Promise<unknown>): FunctionDef {
  return { type: "mutation", isInternal: false, handler: handler as FunctionDef["handler"] }
}

function systemAction<A>(handler: (ctx: unknown, args: A) => Promise<unknown>): FunctionDef {
  return { type: "action", isInternal: false, handler: handler as FunctionDef["handler"] }
}

export interface SystemFunctionDeps {
  sql: SqlApi
  schemaInfo: SchemaJSON
  tableColumns: Map<string, TableColumnInfo>
}

type CursorPayload = { k: 2; v: unknown; id: string; f: string; d: "asc" | "desc" }

function encodeCursor(info: { sortValue: unknown; lastId: string; sortField: string; direction: "asc" | "desc" }): string {
  const payload: CursorPayload = { k: 2, v: info.sortValue, id: info.lastId, f: info.sortField, d: info.direction }
  return btoa(JSON.stringify(payload))
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null) return false
  if (!("k" in value) || !("v" in value) || !("id" in value) || !("f" in value) || !("d" in value)) return false
  // After `in` checks, TS narrows to `Record<string, unknown>` so property access is safe
  const obj: Record<string, unknown> = value
  return obj.k === 2
}

function decodeCursor(cursor: string): { sortValue: unknown; lastId: string; sortField: string; direction: "asc" | "desc" } | null {
  try {
    const parsed: unknown = JSON.parse(atob(cursor))
    if (!isCursorPayload(parsed)) return null
    return { sortValue: parsed.v, lastId: parsed.id, sortField: parsed.f, direction: parsed.d }
  } catch {
    return null
  }
}

type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte"

const VALID_FILTER_OPS = new Set<string>(["eq", "neq", "gt", "gte", "lt", "lte"])

function isFilterOp(op: string): op is FilterOp {
  return VALID_FILTER_OPS.has(op)
}

/**
 * Build a FilterExpressionJSON from an array of simple filter descriptors.
 * Each filter: { field, op, value }
 */
function buildFilterExpression(
  filters: { field: string; op: string; value: unknown }[]
): FilterExpressionJSON | null {
  if (!filters || filters.length === 0) return null

  const exprs: FilterExpressionJSON[] = filters.map((f) => {
    if (!isFilterOp(f.op)) throw new Error(`Invalid filter operator: ${f.op}`)
    const a: ExprJSON = { op: "field", path: f.field }
    const b: ExprJSON = { op: "literal", value: f.value }
    return { op: f.op, a, b }
  })

  if (exprs.length === 1) return exprs[0]
  return { op: "and", exprs }
}

export function createSystemFunctions(deps: SystemFunctionDeps): Record<string, FunctionDef> {
  const { sql, schemaInfo } = deps

  return {
    "_system:getSchema": systemQuery(async (_ctx, _args: unknown) => {
      return schemaInfo
    }),

    "_system:getTableCount": systemQuery(async (ctx, args: { table: string }) => {
      const { table } = args
      if (!schemaInfo.tables[table]) throw new Error(`Table not found: ${table}`)

      // Dummy read to register query descriptor for subscription invalidation
      await ctx.db.queryRaw(table, null, null, "asc", 1)

      const result = sql.exec(`SELECT COUNT(*) as count FROM "${table}"`).toArray()
      const row = result[0]
      return row ? row["count"] ?? 0 : 0
    }),

    "_system:listDocuments": systemQuery(async (ctx, args: {
      table: string
      cursor?: string | null
      numItems?: number
      sort?: { field: string; direction: string }
      filters?: { field: string; op: string; value: unknown }[]
    }) => {
      const {
        table,
        cursor = null,
        numItems = 50,
        sort,
        filters,
      } = args

      if (!schemaInfo.tables[table]) throw new Error(`Table not found: ${table}`)

      const orderField: string | null = sort?.field ?? null
      const orderDirection: "asc" | "desc" = sort?.direction === "asc" ? "asc" : "desc"
      const filterExpr = buildFilterExpression(filters ?? [])
      const keysetCursor = cursor ? decodeCursor(cursor) : null

      const results: Record<string, unknown>[] = await ctx.db.queryRaw(
        table,
        filterExpr,
        orderField,
        orderDirection,
        numItems + 1,
        null,
        keysetCursor,
        null
      )

      const hasMore = results.length > numItems
      const page = hasMore ? results.slice(0, numItems) : results

      let continueCursor: string | null = null
      if (hasMore && page.length > 0) {
        const last = page[page.length - 1]
        const sf = orderField ?? "_id"
        continueCursor = encodeCursor({
          sortValue: last[sf],
          lastId: String(last["_id"]),
          sortField: sf,
          direction: orderDirection,
        })
      }

      return { page, continueCursor, isDone: !hasMore }
    }),

    "_system:getDocument": systemQuery(async (ctx, args: { id: string }) => {
      return ctx.db.get(args.id)
    }),

    "_system:insertDocument": systemMutation(async (ctx, args: { table: string; data: Record<string, unknown> }) => {
      const { table, data } = args
      if (!schemaInfo.tables[table]) throw new Error(`Table not found: ${table}`)
      return ctx.db.insert(table, data)
    }),

    "_system:updateDocument": systemMutation(async (ctx, args: { id: string; fields: Record<string, unknown> }) => {
      await ctx.db.patch(args.id as Id, args.fields)
    }),

    "_system:deleteDocument": systemMutation(async (ctx, args: { id: string }) => {
      await ctx.db.delete(args.id as Id)
    }),

    "_system:runSQL": systemAction(async (_ctx, args: { query: string }) => {
      const trimmed = String(args.query).trim()

      // Only allow SELECT queries
      if (!/^SELECT\s/i.test(trimmed)) {
        throw new Error("Only SELECT queries are allowed")
      }
      // Block multiple statements
      if (/;\s*\S/i.test(trimmed)) {
        throw new Error("Multiple statements are not allowed")
      }

      const rows = sql.exec(trimmed).toArray()
      return {
        rows,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      }
    }),
  }
}

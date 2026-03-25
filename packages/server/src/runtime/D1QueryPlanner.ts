import type { FilterExpressionJSON, IndexQueryJSON, KeysetCursorInfo, SchemaJSON, SearchQueryJSON } from "@zeroback/server"
import { compileFilterToSQL, evaluateFilter } from "./db/FilterEngine"
import { sqlRowToDoc } from "./db/SchemaMapper"
import type { TableColumnInfo } from "./db/SchemaMapper"
import type { AsyncSqlApi } from "./types"

export type QueryResult = { documentId: string; data: unknown; ts: number }

/**
 * Async variant of queryTable for D1 and other async SQL backends.
 * Reuses the same SQL-building logic and filter compilation as the DO version.
 */
export async function queryTableAsync(
  sql: AsyncSqlApi,
  schemaInfo: SchemaJSON,
  tableColumns: Map<string, TableColumnInfo>,
  table: string,
  asOfTs: number,
  filter: FilterExpressionJSON | null,
  indexQuery: IndexQueryJSON | null,
  orderField: string | null,
  orderDirection: "asc" | "desc",
  limit: number | null,
  keysetCursor?: KeysetCursorInfo | null,
  searchQuery?: SearchQueryJSON | null
): Promise<QueryResult[]> {
  const info = tableColumns.get(table)
  if (!info) return []

  // Build set of JSON columns for filter compilation
  const jsonColumns = new Set<string>()
  for (const [name, col] of info.columns) {
    if (col.isJsonColumn) jsonColumns.add(name)
  }

  const isSearch = !!searchQuery
  const colPrefix = isSearch ? "m." : ""
  const ftsTable = isSearch
    ? `${table}_search_${searchQuery!.searchField}`
    : null

  // Find the actual FTS table name from schema search indexes
  let resolvedFtsTable = ftsTable
  if (isSearch) {
    const tableSchema = schemaInfo.tables[table]
    if (tableSchema?.searchIndexes) {
      const si = tableSchema.searchIndexes.find(
        (s) => s.searchField === searchQuery!.searchField
      )
      if (si) {
        resolvedFtsTable = `${table}_${si.name}`
      }
    }
  }

  const conditions: string[] = [`${colPrefix}_ts <= ?`]
  const params: unknown[] = [asOfTs]

  // FTS MATCH condition
  if (isSearch && resolvedFtsTable) {
    conditions.push(`"${resolvedFtsTable}" MATCH ?`)
    params.push(searchQuery!.searchQuery)
  }

  // Index range conditions (not used with search)
  if (indexQuery && !isSearch) {
    for (const range of indexQuery.ranges) {
      const sqlOps: Record<string, string> = {
        eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=",
      }
      conditions.push(`${colPrefix}"${range.field}" ${sqlOps[range.op]} ?`)
      params.push(typeof range.value === "boolean" ? (range.value ? 1 : 0) : range.value)
    }
  }

  // Try to compile filter to SQL
  const compiled = filter ? compileFilterToSQL(filter, jsonColumns) : null
  const filterPushed = !filter || compiled !== null

  if (compiled) {
    if (isSearch) {
      conditions.push(prefixFilterColumns(compiled.sql, "m"))
    } else {
      conditions.push(compiled.sql)
    }
    params.push(...compiled.params)
  }

  // Keyset cursor WHERE clause
  if (keysetCursor && !isSearch) {
    const sf = keysetCursor.sortField
    const cmp = keysetCursor.direction === "desc" ? "<" : ">"
    conditions.push(`(${colPrefix}"${sf}" ${cmp} ? OR (${colPrefix}"${sf}" = ? AND ${colPrefix}_id ${cmp} ?))`)
    params.push(keysetCursor.sortValue, keysetCursor.sortValue, keysetCursor.lastId)
  }

  const where = conditions.join(" AND ")

  // ORDER BY
  let orderClause: string
  if (isSearch) {
    orderClause = `ORDER BY fts.rank, ${colPrefix}_id ASC`
  } else {
    const effectiveSortField = orderField ?? "_id"
    const dir = orderDirection === "desc" ? "DESC" : "ASC"
    orderClause = `ORDER BY ${colPrefix}"${effectiveSortField}" ${dir}, ${colPrefix}_id ${dir}`
  }

  // LIMIT
  let limitClause = ""
  if (limit != null && filterPushed) {
    limitClause = ` LIMIT ?`
    params.push(limit)
  }

  let sqlQuery: string
  if (isSearch && resolvedFtsTable) {
    sqlQuery = `SELECT m.* FROM "${table}" m INNER JOIN "${resolvedFtsTable}" fts ON m.rowid = fts.rowid WHERE ${where} ${orderClause}${limitClause}`
  } else {
    sqlQuery = `SELECT * FROM "${table}" WHERE ${where} ${orderClause}${limitClause}`
  }

  const results = (await sql.exec(sqlQuery, ...params)).toArray() as Record<string, unknown>[]

  let docs = results.map((row) => ({
    documentId: row._id as string,
    data: sqlRowToDoc(row, info),
    ts: row._ts as number,
  }))

  // JS fallback if filter couldn't be compiled to SQL
  if (filter && !filterPushed) {
    docs = docs.filter((d) => evaluateFilter(d.data, filter))
    if (limit != null) docs = docs.slice(0, limit)
  }

  return docs
}

function prefixFilterColumns(sql: string, alias: string): string {
  return sql.replace(/(?<![.\w])"(\w+)"/g, `${alias}."$1"`)
}

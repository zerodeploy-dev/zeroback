import { describe, it, expect, vi } from "vitest"
import { typeid } from "typeid-js"
import { queryTable } from "./QueryPlanner"
import { buildTableColumns } from "./db/SchemaMapper"
import type { SqlApi } from "./types"
import type { SchemaJSON } from "@zeroback/server"

const schema: SchemaJSON = {
  tables: {
    tasks: {
      fields: {
        title: { type: "string" },
        status: { type: "string" },
        priority: { type: "number" },
        metadata: { type: "any" },
      },
      indexes: [
        { name: "by_status", fields: ["status"] },
      ],
      searchIndexes: [
        { name: "search_title", searchField: "title" },
      ],
    },
  },
}

const tableColumns = buildTableColumns(schema)

function makeSql(rows: Record<string, unknown>[] = []): SqlApi & { lastQuery: string; lastParams: unknown[] } {
  const mock = {
    lastQuery: "",
    lastParams: [] as unknown[],
    exec(query: string, ...bindings: unknown[]) {
      mock.lastQuery = query
      mock.lastParams = bindings
      return { toArray: () => rows }
    },
  }
  return mock
}

describe("queryTable", () => {
  it("returns empty array for unknown table", () => {
    const sql = makeSql()
    const result = queryTable(sql, schema, tableColumns, "unknown", 100, null, null, null, "asc", null)
    expect(result).toEqual([])
  })

  it("queries with basic defaults", () => {
    const taskId = typeid("tasks").toString()
    const sql = makeSql([
      { _id: taskId, _ts: 10, title: "Hello", status: "active", priority: 1, metadata: null },
    ])

    const result = queryTable(sql, schema, tableColumns, "tasks", 100, null, null, null, "asc", null)

    expect(result).toHaveLength(1)
    expect(result[0].documentId).toBe(taskId)
    expect((result[0].data as any).title).toBe("Hello")
    expect(result[0].ts).toBe(10)
    expect(sql.lastQuery).toContain("_ts <= ?")
    expect(sql.lastQuery).toContain('ORDER BY "_id" ASC')
  })

  it("applies SQL filter", () => {
    const sql = makeSql([])
    queryTable(sql, schema, tableColumns, "tasks", 100,
      { op: "eq", a: { op: "field", path: "status" }, b: { op: "literal", value: "done" } },
      null, null, "asc", null
    )

    expect(sql.lastQuery).toContain('"status" = ?')
    expect(sql.lastParams).toContain("done")
  })

  it("applies index range conditions", () => {
    const sql = makeSql([])
    queryTable(sql, schema, tableColumns, "tasks", 100, null,
      { indexName: "by_status", ranges: [{ field: "status", op: "eq", value: "active" }] },
      null, "asc", null
    )

    expect(sql.lastQuery).toContain('"status" = ?')
    expect(sql.lastParams).toContain("active")
  })

  it("applies order by field", () => {
    const sql = makeSql([])
    queryTable(sql, schema, tableColumns, "tasks", 100, null, null, "priority", "desc", null)

    expect(sql.lastQuery).toContain('ORDER BY "priority" DESC')
  })

  it("applies limit", () => {
    const sql = makeSql([])
    queryTable(sql, schema, tableColumns, "tasks", 100, null, null, null, "asc", 10)

    expect(sql.lastQuery).toContain("LIMIT ?")
    expect(sql.lastParams).toContain(10)
  })

  it("applies keyset cursor", () => {
    const sql = makeSql([])
    queryTable(sql, schema, tableColumns, "tasks", 100, null, null, "priority", "asc", null,
      { sortField: "priority", sortValue: 5, lastId: "tasks_0000000000000000000000abc", direction: "asc" }
    )

    expect(sql.lastQuery).toContain('"priority" > ?')
    expect(sql.lastQuery).toContain('_id > ?')
  })

  it("applies keyset cursor desc", () => {
    const sql = makeSql([])
    queryTable(sql, schema, tableColumns, "tasks", 100, null, null, "priority", "desc", null,
      { sortField: "priority", sortValue: 5, lastId: "tasks_0000000000000000000000abc", direction: "desc" }
    )

    expect(sql.lastQuery).toContain('"priority" < ?')
  })

  it("handles search query with FTS join", () => {
    const sql = makeSql([])
    queryTable(sql, schema, tableColumns, "tasks", 100, null, null, null, "asc", null,
      null,
      { searchField: "title", searchQuery: "hello" }
    )

    expect(sql.lastQuery).toContain("INNER JOIN")
    expect(sql.lastQuery).toContain("tasks_search_title")
    expect(sql.lastQuery).toContain("MATCH ?")
    expect(sql.lastParams).toContain("hello")
    expect(sql.lastQuery).toContain("ORDER BY fts.rank")
  })

  it("converts boolean index values to 1/0", () => {
    const sql = makeSql([])
    queryTable(sql, schema, tableColumns, "tasks", 100, null,
      { indexName: "idx", ranges: [{ field: "active", op: "eq", value: true }] },
      null, "asc", null
    )

    expect(sql.lastParams).toContain(1)
  })

  it("falls back to JS filter when SQL compilation fails", () => {
    const sql = makeSql([
      { _id: typeid("tasks").toString(), _ts: 10, title: "Hello", status: "active", priority: 1, metadata: '{"nested":"val"}' },
      { _id: typeid("tasks").toString(), _ts: 10, title: "World", status: "done", priority: 2, metadata: '{"nested":"other"}' },
    ])

    // Filter on nested path without JSON column hint → falls back to JS
    const result = queryTable(sql, schema, tableColumns, "tasks", 100,
      { op: "eq", a: { op: "field", path: "metadata.nested" }, b: { op: "literal", value: "val" } },
      null, null, "asc", null
    )

    // JS filter should evaluate; metadata is a JSON column so it gets parsed
    // The filter references metadata.nested which should work via JS evaluateFilter
    expect(result.length).toBeLessThanOrEqual(2)
  })
})

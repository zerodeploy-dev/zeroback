import { describe, it, expect, vi } from "vitest"
import { DOSQLiteWriter } from "./DOSQLiteWriter"
import { buildTableColumns } from "./SchemaMapper"
import type { SqlApi } from "../types"

const schema = {
  tables: {
    tasks: {
      fields: {
        title: { type: "string" as const },
        done: { type: "boolean" as const },
      },
      indexes: [],
      searchIndexes: [],
    },
  },
}

const tableColumns = buildTableColumns(schema)

function makeSql(): SqlApi & { calls: { query: string; params: unknown[] }[] } {
  const calls: { query: string; params: unknown[] }[] = []
  return {
    calls,
    exec(query: string, ...bindings: unknown[]) {
      calls.push({ query, params: bindings })
      return { toArray: () => [] }
    },
  }
}

describe("DOSQLiteWriter", () => {
  describe("commitWrites()", () => {
    it("does nothing for empty write set", async () => {
      const sql = makeSql()
      const writer = new DOSQLiteWriter(sql, tableColumns)
      await writer.commitWrites([], 100)
      expect(sql.calls).toHaveLength(0)
    })

    it("handles inserts (upserts)", async () => {
      const sql = makeSql()
      const writer = new DOSQLiteWriter(sql, tableColumns)

      await writer.commitWrites([
        { table: "tasks", documentId: "tasks_0000000000000000000000001", data: { _id: "tasks_0000000000000000000000001", title: "Hello", done: true } },
      ], 42)

      expect(sql.calls).toHaveLength(1)
      expect(sql.calls[0].query).toContain("INSERT OR REPLACE")
      expect(sql.calls[0].query).toContain('"tasks"')
      // Params: _id, _ts, title, done (as 1)
      expect(sql.calls[0].params).toContain("tasks_0000000000000000000000001")
      expect(sql.calls[0].params).toContain(42)
      expect(sql.calls[0].params).toContain("Hello")
      expect(sql.calls[0].params).toContain(1) // boolean true → 1
    })

    it("handles deletes", async () => {
      const sql = makeSql()
      const writer = new DOSQLiteWriter(sql, tableColumns)

      await writer.commitWrites([
        { table: "tasks", documentId: "tasks_0000000000000000000000001", data: null },
      ], 42)

      expect(sql.calls).toHaveLength(1)
      expect(sql.calls[0].query).toContain("DELETE FROM")
      expect(sql.calls[0].params).toContain("tasks_0000000000000000000000001")
    })

    it("handles mixed inserts and deletes", async () => {
      const sql = makeSql()
      const writer = new DOSQLiteWriter(sql, tableColumns)

      await writer.commitWrites([
        { table: "tasks", documentId: "tasks_0000000000000000000000001", data: null },
        { table: "tasks", documentId: "tasks_0000000000000000000000002", data: { _id: "tasks_0000000000000000000000002", title: "New", done: false } },
      ], 50)

      const deleteCall = sql.calls.find((c) => c.query.includes("DELETE"))
      const insertCall = sql.calls.find((c) => c.query.includes("INSERT OR REPLACE"))
      expect(deleteCall).toBeDefined()
      expect(insertCall).toBeDefined()
    })

    it("batches multiple inserts into single statement", async () => {
      const sql = makeSql()
      const writer = new DOSQLiteWriter(sql, tableColumns)

      await writer.commitWrites([
        { table: "tasks", documentId: "tasks_0000000000000000000000001", data: { _id: "tasks_0000000000000000000000001", title: "A", done: false } },
        { table: "tasks", documentId: "tasks_0000000000000000000000002", data: { _id: "tasks_0000000000000000000000002", title: "B", done: true } },
      ], 10)

      const insertCalls = sql.calls.filter((c) => c.query.includes("INSERT OR REPLACE"))
      expect(insertCalls).toHaveLength(1) // single batched statement
      expect(insertCalls[0].query).toContain("(?, ?, ?, ?), (?, ?, ?, ?)")
    })

    it("skips unknown tables", async () => {
      const sql = makeSql()
      const writer = new DOSQLiteWriter(sql, tableColumns)

      await writer.commitWrites([
        { table: "unknown", documentId: "unknown_0000000000000000000000001", data: { title: "X" } },
      ], 10)

      const insertCalls = sql.calls.filter((c) => c.query.includes("INSERT"))
      expect(insertCalls).toHaveLength(0)
    })
  })
})

import { describe, it, expect, vi } from "vitest"
import { typeid } from "typeid-js"
import { DOSQLiteReader } from "./DOSQLiteReader"
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

function makeSql(rows: Record<string, unknown>[] = []): SqlApi {
  return {
    exec: vi.fn().mockReturnValue({ toArray: () => rows }),
  }
}

describe("DOSQLiteReader", () => {
  describe("getDocument()", () => {
    it("returns document with deserialized data", async () => {
      const id = typeid("tasks").toString()
      const sql = makeSql([{ _id: id, _ts: 10, title: "Test", done: 1 }])
      const reader = new DOSQLiteReader(sql, tableColumns)

      const result = await reader.getDocument("tasks", id, 100)

      expect(result).not.toBeNull()
      expect(result!.ts).toBe(10)
      expect((result!.data as any).title).toBe("Test")
      expect((result!.data as any).done).toBe(true)
      expect(sql.exec).toHaveBeenCalledWith(
        expect.stringContaining("WHERE _id = ? AND _ts <= ?"),
        id, 100
      )
    })

    it("returns null when document not found", async () => {
      const sql = makeSql([])
      const reader = new DOSQLiteReader(sql, tableColumns)
      const result = await reader.getDocument("tasks", "tasks_0000000000000000000missing", 100)
      expect(result).toBeNull()
    })

    it("returns null for unknown table", async () => {
      const sql = makeSql()
      const reader = new DOSQLiteReader(sql, tableColumns)
      const result = await reader.getDocument("unknown", "unknown_0000000000000000000000001", 100)
      expect(result).toBeNull()
    })
  })

  describe("getDocuments()", () => {
    it("returns map of documents", () => {
      const id1 = typeid("tasks").toString()
      const id2 = typeid("tasks").toString()
      const sql = makeSql([
        { _id: id1, _ts: 10, title: "A", done: 0 },
        { _id: id2, _ts: 11, title: "B", done: 1 },
      ])
      const reader = new DOSQLiteReader(sql, tableColumns)

      const result = reader.getDocuments("tasks", [id1, id2], 100)

      expect(result.size).toBe(2)
      expect(result.get(id1)!.ts).toBe(10)
      expect((result.get(id1)!.data as any).title).toBe("A")
    })

    it("returns empty map for empty ids", () => {
      const sql = makeSql()
      const reader = new DOSQLiteReader(sql, tableColumns)
      const result = reader.getDocuments("tasks", [], 100)
      expect(result.size).toBe(0)
      expect(sql.exec).not.toHaveBeenCalled()
    })

    it("returns empty map for unknown table", () => {
      const sql = makeSql()
      const reader = new DOSQLiteReader(sql, tableColumns)
      const result = reader.getDocuments("unknown", ["id_0000000000000000000000001"], 100)
      expect(result.size).toBe(0)
    })
  })
})

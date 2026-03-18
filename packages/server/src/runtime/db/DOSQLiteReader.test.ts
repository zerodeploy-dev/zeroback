import { describe, it, expect, vi } from "vitest"
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

// Valid ULID for decodeTime
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"

function makeSql(rows: Record<string, unknown>[] = []): SqlApi {
  return {
    exec: vi.fn().mockReturnValue({ toArray: () => rows }),
  }
}

describe("DOSQLiteReader", () => {
  describe("getDocument()", () => {
    it("returns document with deserialized data", async () => {
      const sql = makeSql([{ _id: `tasks:${ULID}`, _ts: 10, title: "Test", done: 1 }])
      const reader = new DOSQLiteReader(sql, tableColumns)

      const result = await reader.getDocument("tasks", `tasks:${ULID}`, 100)

      expect(result).not.toBeNull()
      expect(result!.ts).toBe(10)
      expect((result!.data as any).title).toBe("Test")
      expect((result!.data as any).done).toBe(true)
      expect(sql.exec).toHaveBeenCalledWith(
        expect.stringContaining("WHERE _id = ? AND _ts <= ?"),
        `tasks:${ULID}`, 100
      )
    })

    it("returns null when document not found", async () => {
      const sql = makeSql([])
      const reader = new DOSQLiteReader(sql, tableColumns)
      const result = await reader.getDocument("tasks", "tasks:missing", 100)
      expect(result).toBeNull()
    })

    it("returns null for unknown table", async () => {
      const sql = makeSql()
      const reader = new DOSQLiteReader(sql, tableColumns)
      const result = await reader.getDocument("unknown", "unknown:1", 100)
      expect(result).toBeNull()
    })
  })

  describe("getDocuments()", () => {
    it("returns map of documents", () => {
      const id1 = `tasks:${ULID}`
      const id2 = `tasks:01B3EAF48EPPJCR0YJGPWZJM7X`
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
      const result = reader.getDocuments("unknown", ["id:1"], 100)
      expect(result.size).toBe(0)
    })
  })
})

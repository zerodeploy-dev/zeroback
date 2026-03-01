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
    it("generates a ULID-based id and calls ops.insert", async () => {
      const ops = makeMockOps()
      const writer = new DatabaseWriter<TestDataModel>(ops)

      const id = await writer.insert("tasks", { title: "Test" } as any)

      expect(id).toMatch(/^tasks:/)
      expect(id.length).toBeGreaterThan(6) // "tasks:" + ULID
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
  })

  describe("patch()", () => {
    it("extracts table from id and calls ops.patch", async () => {
      const ops = makeMockOps()
      const writer = new DatabaseWriter<TestDataModel>(ops)

      await writer.patch("tasks:abc123" as any, { title: "Updated" } as any)

      expect(ops.patch).toHaveBeenCalledWith("tasks", "tasks:abc123", { title: "Updated" })
    })
  })

  describe("replace()", () => {
    it("extracts table from id and calls ops.replace", async () => {
      const ops = makeMockOps()
      const writer = new DatabaseWriter<TestDataModel>(ops)

      await writer.replace("users:xyz" as any, { name: "Alice", age: 30 } as any)

      expect(ops.replace).toHaveBeenCalledWith("users", "users:xyz", { name: "Alice", age: 30 })
    })
  })

  describe("delete()", () => {
    it("extracts table from id and calls ops.delete", async () => {
      const ops = makeMockOps()
      const writer = new DatabaseWriter<TestDataModel>(ops)

      await writer.delete("tasks:abc123" as any)

      expect(ops.delete).toHaveBeenCalledWith("tasks", "tasks:abc123")
    })
  })

  describe("inherits DatabaseReader", () => {
    it("can call get()", async () => {
      const ops = makeMockOps()
      ;(ops.get as any).mockResolvedValue({ _id: "tasks:1", title: "A" })

      const writer = new DatabaseWriter<TestDataModel>(ops)
      const result = await writer.get("tasks:1" as any)
      expect(result).toEqual({ _id: "tasks:1", title: "A" })
    })

    it("can call query()", () => {
      const writer = new DatabaseWriter<TestDataModel>(makeMockOps())
      const qb = writer.query("tasks")
      expect(qb).toBeDefined()
    })
  })
})

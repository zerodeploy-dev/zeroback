import { describe, it, expect, vi } from "vitest"
import { DatabaseReader } from "./reader"
import { QueryBuilder } from "./query-builder"
import type { DbOps } from "../types"

type TestDataModel = {
  tasks: { _id: string; title: string }
  users: { _id: string; name: string }
}

function makeMockOps(): DbOps {
  return {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    getMany: vi.fn().mockResolvedValue(new Map()),
    insert: vi.fn(),
    patch: vi.fn(),
    replace: vi.fn(),
    delete: vi.fn(),
  } as unknown as DbOps
}

describe("DatabaseReader", () => {
  describe("query()", () => {
    it("returns a QueryBuilder for the table", () => {
      const reader = new DatabaseReader<TestDataModel>(makeMockOps())
      const qb = reader.query("tasks")
      expect(qb).toBeInstanceOf(QueryBuilder)
    })
  })

  describe("get()", () => {
    it("extracts table from id and calls ops.get", async () => {
      const ops = makeMockOps()
      ;(ops.get as any).mockResolvedValue({ _id: "tasks:abc", title: "test" })

      const reader = new DatabaseReader<TestDataModel>(ops)
      const result = await reader.get("tasks:abc" as any)

      expect(ops.get).toHaveBeenCalledWith("tasks", "tasks:abc")
      expect(result).toEqual({ _id: "tasks:abc", title: "test" })
    })

    it("returns null when not found", async () => {
      const ops = makeMockOps()
      ;(ops.get as any).mockResolvedValue(null)

      const reader = new DatabaseReader<TestDataModel>(ops)
      const result = await reader.get("tasks:missing" as any)
      expect(result).toBeNull()
    })
  })

  describe("getMany()", () => {
    it("returns empty map for no ids", async () => {
      const ops = makeMockOps()
      const reader = new DatabaseReader<TestDataModel>(ops)
      const result = await reader.getMany()
      expect(result.size).toBe(0)
      expect(ops.getMany).not.toHaveBeenCalled()
    })

    it("fetches multiple docs and returns a Map", async () => {
      const ops = makeMockOps()
      const mockMap = new Map([
        ["tasks:1", { _id: "tasks:1", title: "A" }],
        ["tasks:2", { _id: "tasks:2", title: "B" }],
      ])
      ;(ops.getMany as any).mockResolvedValue(mockMap)

      const reader = new DatabaseReader<TestDataModel>(ops)
      const result = await reader.getMany("tasks:1" as any, "tasks:2" as any)

      expect(ops.getMany).toHaveBeenCalledWith("tasks", ["tasks:1", "tasks:2"])
      expect(result.get("tasks:1" as any)).toEqual({ _id: "tasks:1", title: "A" })
      expect(result.get("tasks:2" as any)).toEqual({ _id: "tasks:2", title: "B" })
    })

    it("returns null for missing docs in map", async () => {
      const ops = makeMockOps()
      ;(ops.getMany as any).mockResolvedValue(new Map())

      const reader = new DatabaseReader<TestDataModel>(ops)
      const result = await reader.getMany("tasks:1" as any)
      expect(result.get("tasks:1" as any)).toBeNull()
    })
  })

  describe("queryRaw()", () => {
    it("delegates to ops.query", async () => {
      const ops = makeMockOps()
      ;(ops.query as any).mockResolvedValue([{ _id: "t:1" }])

      const reader = new DatabaseReader<TestDataModel>(ops)
      const result = await reader.queryRaw("tasks", null, null, "asc", 10)

      expect(ops.query).toHaveBeenCalledWith(
        "tasks", null, null, "asc", 10, undefined, undefined, undefined,
      )
      expect(result).toEqual([{ _id: "t:1" }])
    })
  })
})

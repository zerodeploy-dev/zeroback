import { describe, it, expect, vi } from "vitest"
import { QueryBuilder, IndexRangeBuilder } from "./query-builder"
import { DatabaseReader } from "./reader"
import type { DbOps } from "../types"

type TestDataModel = {
  tasks: { _id: string; name: string; status: string; priority: number; score: number }
  users: { _id: string; name: string }
}

function makeMockOps(results: any[] = []): DbOps {
  return {
    query: vi.fn().mockResolvedValue(results),
    get: vi.fn().mockResolvedValue(null),
    getMany: vi.fn().mockResolvedValue(new Map()),
    insert: vi.fn(),
    patch: vi.fn(),
    replace: vi.fn(),
    delete: vi.fn(),
  } as unknown as DbOps
}

function makeReader(ops?: DbOps): DatabaseReader<TestDataModel> {
  return new DatabaseReader(ops ?? makeMockOps())
}

describe("IndexRangeBuilder", () => {
  it("builds empty ranges", () => {
    const b = new IndexRangeBuilder()
    expect(b.toJSON()).toEqual([])
  })

  it("chains eq/gt/gte/lt/lte", () => {
    const b = new IndexRangeBuilder()
      .eq("status", "active")
      .gt("age", 18)
      .lte("score", 100)

    expect(b.toJSON()).toEqual([
      { field: "status", op: "eq", value: "active" },
      { field: "age", op: "gt", value: 18 },
      { field: "score", op: "lte", value: 100 },
    ])
  })

  it("supports all comparison operators", () => {
    const b = new IndexRangeBuilder()
    b.eq("a", 1).gt("b", 2).gte("c", 3).lt("d", 4).lte("e", 5)
    const json = b.toJSON()
    expect(json.map((r: any) => r.op)).toEqual(["eq", "gt", "gte", "lt", "lte"])
  })
})

describe("QueryBuilder", () => {
  describe("collect()", () => {
    it("calls reader.queryRaw with table and defaults", async () => {
      const ops = makeMockOps([{ _id: "t:1" }])
      const reader = makeReader(ops)
      const qb = new QueryBuilder("tasks", reader)

      const result = await qb.collect()

      expect(ops.query).toHaveBeenCalledWith(
        "tasks", null, null, "asc", null, null, undefined, null,
      )
      expect(result).toEqual([{ _id: "t:1" }])
    })
  })

  describe("take()", () => {
    it("sets limit and collects", async () => {
      const ops = makeMockOps([{ _id: "1" }, { _id: "2" }])
      const reader = makeReader(ops)
      const qb = new QueryBuilder("tasks", reader)

      await qb.take(5)

      expect(ops.query).toHaveBeenCalledWith(
        "tasks", null, null, "asc", 5, null, undefined, null,
      )
    })
  })

  describe("first()", () => {
    it("returns first result", async () => {
      const ops = makeMockOps([{ _id: "1", name: "Alice" }])
      const reader = makeReader(ops)
      const result = await new QueryBuilder("users", reader).first()
      expect(result).toEqual({ _id: "1", name: "Alice" })
    })

    it("returns null when no results", async () => {
      const reader = makeReader(makeMockOps([]))
      const result = await new QueryBuilder("users", reader).first()
      expect(result).toBeNull()
    })
  })

  describe("unique()", () => {
    it("returns the single result", async () => {
      const ops = makeMockOps([{ _id: "1" }])
      const reader = makeReader(ops)
      const result = await new QueryBuilder("users", reader).unique()
      expect(result).toEqual({ _id: "1" })
    })

    it("throws when no results", async () => {
      const reader = makeReader(makeMockOps([]))
      await expect(
        new QueryBuilder("users", reader).unique(),
      ).rejects.toThrow("Expected exactly one result, got none")
    })

    it("throws when multiple results", async () => {
      const reader = makeReader(makeMockOps([{ _id: "1" }, { _id: "2" }]))
      await expect(
        new QueryBuilder("users", reader).unique(),
      ).rejects.toThrow("Expected exactly one result, got multiple")
    })
  })

  describe("filter()", () => {
    it("passes filter expression to queryRaw", async () => {
      const ops = makeMockOps([])
      const reader = makeReader(ops)

      await new QueryBuilder("tasks", reader)
        .filter((q: any) => q.eq(q.field("status"), "done"))
        .collect()

      expect(ops.query).toHaveBeenCalledWith(
        "tasks",
        { op: "eq", a: { op: "field", path: "status" }, b: { op: "literal", value: "done" } },
        null, "asc", null, null, undefined, null,
      )
    })
  })

  describe("order() and orderBy()", () => {
    it("order() sets direction", async () => {
      const ops = makeMockOps([])
      const reader = makeReader(ops)

      await new QueryBuilder("tasks", reader).order("desc").collect()

      expect(ops.query).toHaveBeenCalledWith(
        "tasks", null, null, "desc", null, null, undefined, null,
      )
    })

    it("orderBy() sets field and direction", async () => {
      const ops = makeMockOps([])
      const reader = makeReader(ops)

      await new QueryBuilder("tasks", reader).orderBy("createdAt", "desc").collect()

      expect(ops.query).toHaveBeenCalledWith(
        "tasks", null, "createdAt", "desc", null, null, undefined, null,
      )
    })

    it("orderBy() defaults to asc", async () => {
      const ops = makeMockOps([])
      const reader = makeReader(ops)

      await new QueryBuilder("tasks", reader).orderBy("name").collect()

      expect(ops.query).toHaveBeenCalledWith(
        "tasks", null, "name", "asc", null, null, undefined, null,
      )
    })
  })

  describe("withIndex()", () => {
    it("passes index query to queryRaw", async () => {
      const ops = makeMockOps([])
      const reader = makeReader(ops)

      await new QueryBuilder("tasks", reader)
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .collect()

      expect(ops.query).toHaveBeenCalledWith(
        "tasks", null, null, "asc", null,
        { indexName: "by_status", ranges: [{ field: "status", op: "eq", value: "active" }] },
        undefined, null,
      )
    })

    it("allows withIndex without range function", async () => {
      const ops = makeMockOps([])
      const reader = makeReader(ops)

      await new QueryBuilder("tasks", reader)
        .withIndex("by_creation_time")
        .collect()

      expect(ops.query).toHaveBeenCalledWith(
        "tasks", null, null, "asc", null,
        { indexName: "by_creation_time", ranges: [] },
        undefined, null,
      )
    })

    it("throws when combined with search()", () => {
      const reader = makeReader()
      const qb = new QueryBuilder("tasks", reader).search("body", "hello")
      expect(() => qb.withIndex("by_status")).toThrow("cannot be combined")
    })
  })

  describe("search()", () => {
    it("passes search query to queryRaw", async () => {
      const ops = makeMockOps([])
      const reader = makeReader(ops)

      await new QueryBuilder("tasks", reader)
        .search("body", "hello world")
        .collect()

      expect(ops.query).toHaveBeenCalledWith(
        "tasks", null, null, "asc", null, null, undefined,
        { searchField: "body", searchQuery: "hello world" },
      )
    })

    it("throws when combined with withIndex()", () => {
      const reader = makeReader()
      const qb = new QueryBuilder("tasks", reader).withIndex("idx")
      expect(() => qb.search("body", "hello")).toThrow("cannot be combined")
    })
  })

  describe("paginate()", () => {
    it("returns first page with cursor", async () => {
      const docs = [
        { _id: "t:1", name: "A" },
        { _id: "t:2", name: "B" },
        { _id: "t:3", name: "C" }, // extra doc → hasMore=true
      ]
      const ops = makeMockOps(docs)
      const reader = makeReader(ops)

      const result = await new QueryBuilder("tasks", reader)
        .paginate({ cursor: null, numItems: 2 })

      expect(result.page).toHaveLength(2)
      expect(result.isDone).toBe(false)
      expect(result.continueCursor).toBeTruthy()
    })

    it("returns isDone=true when no more results", async () => {
      const docs = [{ _id: "t:1", name: "A" }]
      const ops = makeMockOps(docs)
      const reader = makeReader(ops)

      const result = await new QueryBuilder("tasks", reader)
        .paginate({ cursor: null, numItems: 5 })

      expect(result.page).toEqual([{ _id: "t:1", name: "A" }])
      expect(result.isDone).toBe(true)
      expect(result.continueCursor).toBeNull()
    })

    it("cursor round-trips through encode/decode", async () => {
      // First page
      const docs1 = [
        { _id: "t:1", name: "A" },
        { _id: "t:2", name: "B" },
        { _id: "t:3", name: "C" },
      ]
      const ops = makeMockOps(docs1)
      const reader = makeReader(ops)

      const page1 = await new QueryBuilder("tasks", reader)
        .paginate({ cursor: null, numItems: 2 })

      expect(page1.continueCursor).toBeTruthy()

      // Second page with cursor
      const docs2 = [{ _id: "t:4", name: "D" }]
      ;(ops.query as any).mockResolvedValueOnce(docs2)

      const page2 = await new QueryBuilder("tasks", reader)
        .paginate({ cursor: page1.continueCursor, numItems: 2 })

      expect(page2.page).toEqual([{ _id: "t:4", name: "D" }])
      expect(page2.isDone).toBe(true)

      // Verify the cursor was decoded and passed to queryRaw
      const secondCall = (ops.query as any).mock.calls[1]
      const keysetCursor = secondCall[6] // 7th arg is keysetCursor
      expect(keysetCursor).toBeDefined()
      expect(keysetCursor.lastId).toBe("t:2")
      expect(keysetCursor.direction).toBe("asc")
    })

    it("uses custom orderBy field in cursor", async () => {
      const docs = [
        { _id: "t:1", score: 10 },
        { _id: "t:2", score: 20 },
        { _id: "t:3", score: 30 },
      ]
      const ops = makeMockOps(docs)
      const reader = makeReader(ops)

      const result = await new QueryBuilder("tasks", reader)
        .orderBy("score", "desc")
        .paginate({ cursor: null, numItems: 2 })

      // Decode the cursor to verify sortField
      const cursor = JSON.parse(atob(result.continueCursor!))
      expect(cursor.f).toBe("score")
      expect(cursor.d).toBe("desc")
      expect(cursor.v).toBe(20) // last doc's score
    })

    it("returns null cursor when no hasMore even with results", async () => {
      const docs = [{ _id: "t:1" }, { _id: "t:2" }]
      const ops = makeMockOps(docs)
      const reader = makeReader(ops)

      const result = await new QueryBuilder("tasks", reader)
        .paginate({ cursor: null, numItems: 5 })

      expect(result.continueCursor).toBeNull()
      expect(result.isDone).toBe(true)
    })

    it("handles invalid cursor gracefully (treats as restart)", async () => {
      const ops = makeMockOps([{ _id: "t:1" }])
      const reader = makeReader(ops)

      // Pass a garbage cursor
      const result = await new QueryBuilder("tasks", reader)
        .paginate({ cursor: "not-valid-base64", numItems: 5 })

      // Should still work (decodeKeysetCursor returns null)
      expect(result.page).toEqual([{ _id: "t:1" }])

      const callArgs = (ops.query as any).mock.calls[0]
      expect(callArgs[6]).toBeNull() // keysetCursor should be null
    })
  })

  describe("chaining multiple builders", () => {
    it("combines filter + order + withIndex", async () => {
      const ops = makeMockOps([])
      const reader = makeReader(ops)

      await new QueryBuilder("tasks", reader)
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .filter((q: any) => q.gt(q.field("priority"), 5))
        .orderBy("priority", "desc")
        .take(10)

      expect(ops.query).toHaveBeenCalledWith(
        "tasks",
        { op: "gt", a: { op: "field", path: "priority" }, b: { op: "literal", value: 5 } },
        "priority",
        "desc",
        10,
        { indexName: "by_status", ranges: [{ field: "status", op: "eq", value: "active" }] },
        undefined,
        null,
      )
    })
  })
})

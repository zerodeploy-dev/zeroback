import { describe, it, expect } from "vitest"
import { defineTable, defineSchema } from "./schema"
import { v } from "@zeroback/values"

describe("defineTable", () => {
  it("returns a table definition with empty indexes", () => {
    const table = defineTable({ name: v.string() })
    expect(table.indexes).toEqual([])
    expect(table.searchIndexes).toEqual([])
  })

  it("supports chaining .index()", () => {
    const table = defineTable({ name: v.string(), status: v.string() })
      .index("by_status", ["status"])
      .index("by_name", ["name"])

    expect(table.indexes).toHaveLength(2)
    expect(table.indexes[0]).toEqual({ name: "by_status", fields: ["status"] })
    expect(table.indexes[1]).toEqual({ name: "by_name", fields: ["name"] })
  })

  it("supports chaining .searchIndex()", () => {
    const table = defineTable({ body: v.string() })
      .searchIndex("search_body", { searchField: "body" })

    expect(table.searchIndexes).toHaveLength(1)
    expect(table.searchIndexes[0]).toEqual({
      name: "search_body",
      searchField: "body",
    })
  })

  it("supports mixing .index() and .searchIndex()", () => {
    const table = defineTable({ name: v.string(), body: v.string() })
      .index("by_name", ["name"])
      .searchIndex("search_body", { searchField: "body" })

    expect(table.indexes).toHaveLength(1)
    expect(table.searchIndexes).toHaveLength(1)
  })
})

describe("defineSchema", () => {
  it("wraps tables in a schema definition", () => {
    const users = defineTable({ name: v.string() })
    const posts = defineTable({ title: v.string(), body: v.string() })

    const schema = defineSchema({ users, posts })
    expect(schema.tables.users).toBe(users)
    expect(schema.tables.posts).toBe(posts)
  })

  it("returns object with tables property", () => {
    const schema = defineSchema({
      tasks: defineTable({ title: v.string() }),
    })
    expect(Object.keys(schema.tables)).toEqual(["tasks"])
  })
})

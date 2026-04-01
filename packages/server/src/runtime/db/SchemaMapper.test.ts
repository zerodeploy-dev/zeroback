import { describe, it, expect, vi } from "vitest"
import { typeid } from "typeid-js"
import {
  validatorToSQLType,
  generateTableDDL,
  generateSearchIndexDDL,
  buildTableColumns,
  docToSQLParams,
  sqlRowToDoc,
  migrateSchema,
} from "./SchemaMapper"
import type { SqlApi } from "../types"

describe("validatorToSQLType", () => {
  it("maps string to TEXT", () => {
    expect(validatorToSQLType({ type: "string" })).toEqual({
      sqlType: "TEXT", nullable: false, isJsonColumn: false,
    })
  })

  it("maps number to REAL", () => {
    expect(validatorToSQLType({ type: "number" })).toEqual({
      sqlType: "REAL", nullable: false, isJsonColumn: false,
    })
  })

  it("maps float64 to REAL", () => {
    expect(validatorToSQLType({ type: "float64" })).toEqual({
      sqlType: "REAL", nullable: false, isJsonColumn: false,
    })
  })

  it("maps int64 to INTEGER", () => {
    expect(validatorToSQLType({ type: "int64" })).toEqual({
      sqlType: "INTEGER", nullable: false, isJsonColumn: false,
    })
  })

  it("maps boolean to INTEGER", () => {
    expect(validatorToSQLType({ type: "boolean" })).toEqual({
      sqlType: "INTEGER", nullable: false, isJsonColumn: false,
    })
  })

  it("maps id to TEXT", () => {
    expect(validatorToSQLType({ type: "id", tableName: "tasks" })).toEqual({
      sqlType: "TEXT", nullable: false, isJsonColumn: false,
    })
  })

  it("maps null to TEXT nullable", () => {
    expect(validatorToSQLType({ type: "null" })).toEqual({
      sqlType: "TEXT", nullable: true, isJsonColumn: false,
    })
  })

  it("maps bytes to BLOB", () => {
    expect(validatorToSQLType({ type: "bytes" })).toEqual({
      sqlType: "BLOB", nullable: false, isJsonColumn: false,
    })
  })

  it("maps optional to inner type with nullable", () => {
    expect(validatorToSQLType({ type: "optional", value: { type: "string" } })).toEqual({
      sqlType: "TEXT", nullable: true, isJsonColumn: false,
    })
  })

  it("maps object/array/union/record/any to JSON TEXT", () => {
    for (const type of ["object", "array", "union", "record", "any"]) {
      const result = validatorToSQLType({ type, value: {} } as any)
      expect(result.isJsonColumn).toBe(true)
      expect(result.sqlType).toBe("TEXT")
    }
  })

  it("maps literal string to TEXT", () => {
    expect(validatorToSQLType({ type: "literal", value: "hello" })).toEqual({
      sqlType: "TEXT", nullable: false, isJsonColumn: false,
    })
  })

  it("maps literal number to REAL", () => {
    expect(validatorToSQLType({ type: "literal", value: 42 })).toEqual({
      sqlType: "REAL", nullable: false, isJsonColumn: false,
    })
  })

  it("maps literal boolean to INTEGER", () => {
    expect(validatorToSQLType({ type: "literal", value: true })).toEqual({
      sqlType: "INTEGER", nullable: false, isJsonColumn: false,
    })
  })

  it("maps unknown type to JSON TEXT", () => {
    expect(validatorToSQLType({ type: "unknown_type" } as any)).toEqual({
      sqlType: "TEXT", nullable: false, isJsonColumn: true,
    })
  })
})

describe("generateTableDDL", () => {
  it("generates CREATE TABLE with system columns", () => {
    const stmts = generateTableDDL("tasks", {
      fields: { title: { type: "string" } },
      indexes: [],
      searchIndexes: [],
    })
    expect(stmts[0]).toContain('CREATE TABLE IF NOT EXISTS "tasks"')
    expect(stmts[0]).toContain("_id TEXT PRIMARY KEY")
    expect(stmts[0]).toContain("_ts INTEGER NOT NULL")
    expect(stmts[0]).toContain('"title" TEXT NOT NULL')
  })

  it("generates indexes", () => {
    const stmts = generateTableDDL("tasks", {
      fields: { status: { type: "string" } },
      indexes: [{ name: "by_status", fields: ["status"] }],
      searchIndexes: [],
    })
    const indexStmt = stmts.find((s) => s.includes("CREATE INDEX"))
    expect(indexStmt).toContain('"tasks_by_status"')
    expect(indexStmt).toContain('"status"')
    expect(indexStmt).toContain("_id")
  })

  it("skips by_id index", () => {
    const stmts = generateTableDDL("tasks", {
      fields: {},
      indexes: [{ name: "by_id", fields: ["_id"] }],
      searchIndexes: [],
    })
    const indexStmts = stmts.filter((s) => s.includes("CREATE INDEX"))
    expect(indexStmts).toHaveLength(0)
  })

  it("generates search index DDL", () => {
    const stmts = generateTableDDL("posts", {
      fields: { body: { type: "string" } },
      indexes: [],
      searchIndexes: [{ name: "search_body", searchField: "body" }],
    })
    expect(stmts.some((s) => s.includes("fts5"))).toBe(true)
    expect(stmts.some((s) => s.includes("AFTER INSERT"))).toBe(true)
    expect(stmts.some((s) => s.includes("AFTER DELETE"))).toBe(true)
  })
})

describe("generateSearchIndexDDL", () => {
  it("creates FTS5 table and triggers", () => {
    const stmts = generateSearchIndexDDL("posts", { name: "search_body", searchField: "body" })
    expect(stmts).toHaveLength(3)
    expect(stmts[0]).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS "posts_search_body"')
    expect(stmts[0]).toContain("fts5")
    expect(stmts[1]).toContain("AFTER INSERT")
    expect(stmts[2]).toContain("AFTER DELETE")
  })
})

describe("buildTableColumns", () => {
  it("builds column metadata from schema", () => {
    const schema = {
      tables: {
        tasks: {
          fields: {
            title: { type: "string" as const },
            done: { type: "boolean" as const },
            metadata: { type: "any" as const },
          },
          indexes: [],
          searchIndexes: [],
        },
      },
    }

    const result = buildTableColumns(schema)
    expect(result.has("tasks")).toBe(true)

    const taskInfo = result.get("tasks")!
    expect(taskInfo.columns.get("_id")!.sqlType).toBe("TEXT")
    expect(taskInfo.columns.get("_ts")!.sqlType).toBe("INTEGER")
    expect(taskInfo.columns.get("title")!.sqlType).toBe("TEXT")
    expect(taskInfo.columns.get("title")!.isJsonColumn).toBe(false)
    expect(taskInfo.columns.get("done")!.isBoolean).toBe(true)
    expect(taskInfo.columns.get("metadata")!.isJsonColumn).toBe(true)

    expect(taskInfo.orderedFieldNames).toEqual(["title", "done", "metadata"])
  })

  it("detects optional boolean as isBoolean", () => {
    const schema = {
      tables: {
        t: {
          fields: {
            active: { type: "optional" as const, value: { type: "boolean" as const } },
          },
          indexes: [],
          searchIndexes: [],
        },
      },
    }
    const result = buildTableColumns(schema)
    expect(result.get("t")!.columns.get("active")!.isBoolean).toBe(true)
    expect(result.get("t")!.columns.get("active")!.nullable).toBe(true)
  })
})

describe("docToSQLParams", () => {
  it("serializes document to SQL param array", () => {
    const schema = {
      tables: {
        tasks: {
          fields: {
            title: { type: "string" as const },
            done: { type: "boolean" as const },
            tags: { type: "array" as const, value: { type: "string" as const } },
          },
          indexes: [],
          searchIndexes: [],
        },
      },
    }
    const info = buildTableColumns(schema).get("tasks")!

    const id = typeid("tasks").toString()
    const params = docToSQLParams(
      { _id: id, title: "Test", done: true, tags: ["a", "b"] },
      info,
      42
    )

    expect(params).toEqual([
      id,            // _id
      42,            // commitTs
      "Test",        // title (string)
      1,             // done (boolean → 1)
      '["a","b"]',   // tags (JSON)
    ])
  })

  it("handles null/undefined as null", () => {
    const schema = {
      tables: {
        t: {
          fields: { name: { type: "optional" as const, value: { type: "string" as const } } },
          indexes: [],
          searchIndexes: [],
        },
      },
    }
    const info = buildTableColumns(schema).get("t")!
    const id = typeid("t").toString()
    const params = docToSQLParams({ _id: id }, info, 1)
    expect(params).toEqual([id, 1, null])
  })
})

describe("sqlRowToDoc", () => {
  it("deserializes SQL row to JS doc", () => {
    const schema = {
      tables: {
        tasks: {
          fields: {
            title: { type: "string" as const },
            done: { type: "boolean" as const },
            tags: { type: "array" as const, value: { type: "string" as const } },
          },
          indexes: [],
          searchIndexes: [],
        },
      },
    }
    const info = buildTableColumns(schema).get("tasks")!

    const id = typeid("tasks").toString()

    const doc = sqlRowToDoc(
      { _id: id, _ts: 42, title: "Test", done: 1, tags: '["a","b"]' },
      info
    )

    expect(doc._id).toBe(id)
    expect(doc._creationTime).toBeTypeOf("number")
    expect(doc.title).toBe("Test")
    expect(doc.done).toBe(true)
    expect(doc.tags).toEqual(["a", "b"])
  })

  it("converts 0 to false for boolean columns", () => {
    const schema = {
      tables: {
        t: {
          fields: { active: { type: "boolean" as const } },
          indexes: [],
          searchIndexes: [],
        },
      },
    }
    const info = buildTableColumns(schema).get("t")!
    const id = typeid("t").toString()
    const doc = sqlRowToDoc(
      { _id: id, _ts: 1, active: 0 },
      info
    )
    expect(doc.active).toBe(false)
  })

  it("omits optional null fields", () => {
    const schema = {
      tables: {
        t: {
          fields: { bio: { type: "optional" as const, value: { type: "string" as const } } },
          indexes: [],
          searchIndexes: [],
        },
      },
    }
    const info = buildTableColumns(schema).get("t")!
    const id = typeid("t").toString()
    const doc = sqlRowToDoc(
      { _id: id, _ts: 1, bio: null },
      info
    )
    expect("bio" in doc).toBe(false)
  })

  it("keeps non-nullable null fields as null", () => {
    const schema = {
      tables: {
        t: {
          fields: { name: { type: "string" as const } },
          indexes: [],
          searchIndexes: [],
        },
      },
    }
    const info = buildTableColumns(schema).get("t")!
    const id = typeid("t").toString()
    const doc = sqlRowToDoc(
      { _id: id, _ts: 1, name: null },
      info
    )
    expect(doc.name).toBeNull()
  })

  it("excludes _ts from output", () => {
    const schema = {
      tables: {
        t: { fields: {}, indexes: [], searchIndexes: [] },
      },
    }
    const info = buildTableColumns(schema).get("t")!
    const id = typeid("t").toString()
    const doc = sqlRowToDoc(
      { _id: id, _ts: 99 },
      info
    )
    expect("_ts" in doc).toBe(false)
  })
})

describe("migrateSchema", () => {
  function makeMockSql(): SqlApi & { calls: string[] } {
    const calls: string[] = []
    return {
      calls,
      exec(query: string, ...bindings: unknown[]) {
        calls.push(query.trim())
        // Mock responses for PRAGMA and sqlite_master queries
        if (query.includes("sqlite_master") && query.includes("fts5")) {
          return { toArray: () => [] }
        }
        if (query.includes("sqlite_master")) {
          return { toArray: () => [] }
        }
        if (query.includes("PRAGMA table_info")) {
          return { toArray: () => [] }
        }
        if (query.includes("PRAGMA index_list")) {
          return { toArray: () => [] }
        }
        return { toArray: () => [] }
      },
    }
  }

  it("creates new tables", () => {
    const sql = makeMockSql()
    migrateSchema(sql, {
      tables: {
        tasks: {
          fields: { title: { type: "string" } },
          indexes: [],
          searchIndexes: [],
        },
      },
    })

    const createStmt = sql.calls.find((c) => c.includes("CREATE TABLE") && c.includes("tasks"))
    expect(createStmt).toBeDefined()
  })

  it("drops tables not in schema", () => {
    const sql = {
      exec(query: string, ...bindings: unknown[]) {
        if (query.includes("sqlite_master") && query.includes("fts5")) {
          return { toArray: () => [] }
        }
        if (query.includes("sqlite_master")) {
          return { toArray: () => [{ name: "old_table" }] }
        }
        if (query.includes("PRAGMA table_info")) {
          return { toArray: () => [] }
        }
        return { toArray: () => [] }
      },
    } as SqlApi

    const calls: string[] = []
    const original = sql.exec.bind(sql)
    sql.exec = (query: string, ...bindings: unknown[]) => {
      calls.push(query.trim())
      return original(query, ...bindings)
    }

    migrateSchema(sql, { tables: {} })
    expect(calls.some((c) => c.includes("DROP TABLE") && c.includes("old_table"))).toBe(true)
  })

  it("does not drop _auth_ tables", () => {
    const sql = {
      exec(query: string, ...bindings: unknown[]) {
        if (query.includes("sqlite_master") && query.includes("fts5")) {
          return { toArray: () => [] }
        }
        if (query.includes("sqlite_master")) {
          return { toArray: () => [{ name: "_auth_user" }] }
        }
        if (query.includes("PRAGMA table_info")) {
          return { toArray: () => [] }
        }
        return { toArray: () => [] }
      },
    } as SqlApi

    const calls: string[] = []
    const original = sql.exec.bind(sql)
    sql.exec = (query: string, ...bindings: unknown[]) => {
      calls.push(query.trim())
      return original(query, ...bindings)
    }

    migrateSchema(sql, { tables: {} })
    expect(calls.some((c) => c.includes("DROP TABLE") && c.includes("_auth_user"))).toBe(false)
  })
})

import { describe, it, expect } from "vitest"
import {
  applyFilter,
  evaluateFilter,
  applyOrder,
  applyLimit,
  compileFilterToSQL,
} from "./FilterEngine"

const rows = [
  { name: "Alice", age: 30, active: true },
  { name: "Bob", age: 25, active: false },
  { name: "Charlie", age: 35, active: true },
]

describe("evaluateFilter", () => {
  it("eq: matches equal values", () => {
    expect(evaluateFilter(rows[0], {
      op: "eq",
      a: { op: "field", path: "name" },
      b: { op: "literal", value: "Alice" },
    })).toBe(true)
  })

  it("eq: rejects non-equal values", () => {
    expect(evaluateFilter(rows[0], {
      op: "eq",
      a: { op: "field", path: "name" },
      b: { op: "literal", value: "Bob" },
    })).toBe(false)
  })

  it("neq: matches non-equal", () => {
    expect(evaluateFilter(rows[0], {
      op: "neq",
      a: { op: "field", path: "name" },
      b: { op: "literal", value: "Bob" },
    })).toBe(true)
  })

  it("lt: less than comparison", () => {
    expect(evaluateFilter(rows[1], {
      op: "lt",
      a: { op: "field", path: "age" },
      b: { op: "literal", value: 30 },
    })).toBe(true)
  })

  it("lte: less than or equal", () => {
    expect(evaluateFilter(rows[0], {
      op: "lte",
      a: { op: "field", path: "age" },
      b: { op: "literal", value: 30 },
    })).toBe(true)
  })

  it("gt: greater than", () => {
    expect(evaluateFilter(rows[2], {
      op: "gt",
      a: { op: "field", path: "age" },
      b: { op: "literal", value: 30 },
    })).toBe(true)
  })

  it("gte: greater than or equal", () => {
    expect(evaluateFilter(rows[0], {
      op: "gte",
      a: { op: "field", path: "age" },
      b: { op: "literal", value: 30 },
    })).toBe(true)
  })

  it("and: all must match", () => {
    expect(evaluateFilter(rows[0], {
      op: "and",
      exprs: [
        { op: "eq", a: { op: "field", path: "active" }, b: { op: "literal", value: true } },
        { op: "gte", a: { op: "field", path: "age" }, b: { op: "literal", value: 30 } },
      ],
    })).toBe(true)

    // Bob is not active
    expect(evaluateFilter(rows[1], {
      op: "and",
      exprs: [
        { op: "eq", a: { op: "field", path: "active" }, b: { op: "literal", value: true } },
        { op: "gte", a: { op: "field", path: "age" }, b: { op: "literal", value: 20 } },
      ],
    })).toBe(false)
  })

  it("or: at least one must match", () => {
    expect(evaluateFilter(rows[1], {
      op: "or",
      exprs: [
        { op: "eq", a: { op: "field", path: "name" }, b: { op: "literal", value: "Alice" } },
        { op: "eq", a: { op: "field", path: "name" }, b: { op: "literal", value: "Bob" } },
      ],
    })).toBe(true)
  })

  it("not: negates expression", () => {
    expect(evaluateFilter(rows[1], {
      op: "not",
      expr: { op: "eq", a: { op: "field", path: "active" }, b: { op: "literal", value: true } },
    })).toBe(true)
  })

  it("nested path: accesses deep fields", () => {
    const row = { address: { city: "NYC" } }
    expect(evaluateFilter(row, {
      op: "eq",
      a: { op: "field", path: "address.city" },
      b: { op: "literal", value: "NYC" },
    })).toBe(true)
  })

  it("unknown op defaults to true", () => {
    expect(evaluateFilter(rows[0], { op: "unknown" } as any)).toBe(true)
  })
})

describe("applyFilter", () => {
  it("returns all rows when filter is null", () => {
    expect(applyFilter(rows, null)).toEqual(rows)
  })

  it("filters rows by expression", () => {
    const result = applyFilter(rows, {
      op: "eq",
      a: { op: "field", path: "active" },
      b: { op: "literal", value: true },
    })
    expect(result).toHaveLength(2)
    expect(result.map((r: any) => r.name)).toEqual(["Alice", "Charlie"])
  })
})

describe("applyOrder", () => {
  it("returns rows unchanged when field is null", () => {
    expect(applyOrder(rows, null, "asc")).toEqual(rows)
  })

  it("sorts ascending", () => {
    const result = applyOrder(rows, "age", "asc")
    expect(result.map((r: any) => r.age)).toEqual([25, 30, 35])
  })

  it("sorts descending", () => {
    const result = applyOrder(rows, "age", "desc")
    expect(result.map((r: any) => r.age)).toEqual([35, 30, 25])
  })

  it("does not mutate original array", () => {
    const original = [...rows]
    applyOrder(rows, "age", "desc")
    expect(rows).toEqual(original)
  })
})

describe("applyLimit", () => {
  it("returns all rows when limit is null", () => {
    expect(applyLimit(rows, null)).toEqual(rows)
  })

  it("limits to n rows", () => {
    expect(applyLimit(rows, 2)).toHaveLength(2)
  })

  it("returns all if limit exceeds length", () => {
    expect(applyLimit(rows, 100)).toEqual(rows)
  })
})

describe("compileFilterToSQL", () => {
  it("compiles eq on scalar column", () => {
    const result = compileFilterToSQL({
      op: "eq",
      a: { op: "field", path: "status" },
      b: { op: "literal", value: "active" },
    })
    expect(result).toEqual({
      sql: '("status" = ?)',
      params: ["active"],
    })
  })

  it("compiles neq", () => {
    const result = compileFilterToSQL({
      op: "neq",
      a: { op: "field", path: "status" },
      b: { op: "literal", value: "done" },
    })
    expect(result!.sql).toBe('("status" != ?)')
  })

  it("compiles lt/lte/gt/gte", () => {
    for (const [op, sqlOp] of [["lt", "<"], ["lte", "<="], ["gt", ">"], ["gte", ">="]]) {
      const result = compileFilterToSQL({
        op: op as any,
        a: { op: "field", path: "age" },
        b: { op: "literal", value: 18 },
      })
      expect(result!.sql).toBe(`("age" ${sqlOp} ?)`)
    }
  })

  it("compiles and", () => {
    const result = compileFilterToSQL({
      op: "and",
      exprs: [
        { op: "eq", a: { op: "field", path: "a" }, b: { op: "literal", value: 1 } },
        { op: "eq", a: { op: "field", path: "b" }, b: { op: "literal", value: 2 } },
      ],
    })
    expect(result!.sql).toBe('(("a" = ?) AND ("b" = ?))')
    expect(result!.params).toEqual([1, 2])
  })

  it("compiles or", () => {
    const result = compileFilterToSQL({
      op: "or",
      exprs: [
        { op: "eq", a: { op: "field", path: "a" }, b: { op: "literal", value: 1 } },
        { op: "eq", a: { op: "field", path: "b" }, b: { op: "literal", value: 2 } },
      ],
    })
    expect(result!.sql).toBe('(("a" = ?) OR ("b" = ?))')
  })

  it("compiles not", () => {
    const result = compileFilterToSQL({
      op: "not",
      expr: { op: "eq", a: { op: "field", path: "a" }, b: { op: "literal", value: 1 } },
    })
    expect(result!.sql).toBe('(NOT ("a" = ?))')
  })

  it("empty and returns '1'", () => {
    const result = compileFilterToSQL({ op: "and", exprs: [] })
    expect(result!.sql).toBe("1")
  })

  it("empty or returns '0'", () => {
    const result = compileFilterToSQL({ op: "or", exprs: [] })
    expect(result!.sql).toBe("0")
  })

  it("converts boolean literals to 1/0", () => {
    const result = compileFilterToSQL({
      op: "eq",
      a: { op: "field", path: "active" },
      b: { op: "literal", value: true },
    })
    expect(result!.params).toEqual([1])
  })

  it("wraps object literals with json()", () => {
    const result = compileFilterToSQL({
      op: "eq",
      a: { op: "field", path: "data" },
      b: { op: "literal", value: { key: "val" } },
    })
    expect(result!.sql).toContain("json(?)")
    expect(result!.params).toEqual(['{"key":"val"}'])
  })

  it("uses json_extract for JSON columns", () => {
    const result = compileFilterToSQL(
      {
        op: "eq",
        a: { op: "field", path: "metadata" },
        b: { op: "literal", value: "test" },
      },
      new Set(["metadata"])
    )
    expect(result!.sql).toBe("(json_extract(\"metadata\", '$') = ?)")
  })

  it("uses json_extract for nested paths on JSON columns", () => {
    const result = compileFilterToSQL(
      {
        op: "eq",
        a: { op: "field", path: "address.city" },
        b: { op: "literal", value: "NYC" },
      },
      new Set(["address"])
    )
    expect(result!.sql).toBe('(json_extract("address", ?) = ?)')
    expect(result!.params).toEqual(["$.city", "NYC"])
  })

  it("returns null for nested path on non-JSON column", () => {
    const result = compileFilterToSQL({
      op: "eq",
      a: { op: "field", path: "address.city" },
      b: { op: "literal", value: "NYC" },
    })
    expect(result).toBeNull()
  })

  it("returns null for unsafe column names", () => {
    const result = compileFilterToSQL({
      op: "eq",
      a: { op: "field", path: "drop table; --" },
      b: { op: "literal", value: 1 },
    })
    expect(result).toBeNull()
  })
})

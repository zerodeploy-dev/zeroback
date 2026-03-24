import { describe, it, expect } from "vitest"
import {
  FilterBuilder,
  Expression,
  FilterExpression,
  field,
  literal,
} from "./filter"

describe("Expression", () => {
  it("creates field expression from path", () => {
    const expr = new Expression("name")
    expect(expr.toJSON()).toEqual({ op: "field", path: "name" })
  })

  it("creates literal expression via static method", () => {
    const expr = Expression.literal(42)
    expect(expr.toJSON()).toEqual({ op: "literal", value: 42 })
  })

  it("handles null literal", () => {
    const expr = Expression.literal(null)
    expect(expr.toJSON()).toEqual({ op: "literal", value: null })
  })

  it("handles string literal", () => {
    const expr = Expression.literal("hello")
    expect(expr.toJSON()).toEqual({ op: "literal", value: "hello" })
  })

  it("handles boolean literal", () => {
    const expr = Expression.literal(true)
    expect(expr.toJSON()).toEqual({ op: "literal", value: true })
  })
})

describe("FilterExpression", () => {
  it("wraps and returns JSON", () => {
    const json = { op: "eq" as const, a: { op: "field" as const, path: "x" }, b: { op: "literal" as const, value: 1 } }
    const fe = new FilterExpression(json)
    expect(fe.toJSON()).toBe(json)
  })
})

describe("field() and literal() helpers", () => {
  it("field() creates a field expression", () => {
    const expr = field<{ name: string }, "name">("name")
    expect(expr.toJSON()).toEqual({ op: "field", path: "name" })
  })

  it("literal() creates a literal expression", () => {
    const expr = literal(99)
    expect(expr.toJSON()).toEqual({ op: "literal", value: 99 })
  })
})

describe("FilterBuilder", () => {
  type Doc = { name: string; age: number; active: boolean }

  it("field() returns Expression with key path", () => {
    const fb = new FilterBuilder<Doc>()
    const expr = fb.field("name")
    expect(expr.toJSON()).toEqual({ op: "field", path: "name" })
  })

  describe("comparison operators", () => {
    it("eq with field and literal", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.eq(fb.field("name"), "Alice")
      expect(result.toJSON()).toEqual({
        op: "eq",
        a: { op: "field", path: "name" },
        b: { op: "literal", value: "Alice" },
      })
    })

    it("neq with field and value", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.neq(fb.field("active"), false)
      expect(result.toJSON()).toEqual({
        op: "neq",
        a: { op: "field", path: "active" },
        b: { op: "literal", value: false },
      })
    })

    it("lt", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.lt(fb.field("age"), 18)
      expect(result.toJSON()).toEqual({
        op: "lt",
        a: { op: "field", path: "age" },
        b: { op: "literal", value: 18 },
      })
    })

    it("lte", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.lte(fb.field("age"), 18)
      expect(result.toJSON()).toMatchObject({ op: "lte" })
    })

    it("gt", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.gt(fb.field("age"), 21)
      expect(result.toJSON()).toMatchObject({ op: "gt" })
    })

    it("gte", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.gte(fb.field("age"), 21)
      expect(result.toJSON()).toMatchObject({ op: "gte" })
    })

    it("auto-wraps raw values as literals", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.eq("raw-string", 42)
      expect(result.toJSON()).toEqual({
        op: "eq",
        a: { op: "literal", value: "raw-string" },
        b: { op: "literal", value: 42 },
      })
    })

    it("accepts null as value", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.eq(fb.field("name"), null)
      expect(result.toJSON()).toEqual({
        op: "eq",
        a: { op: "field", path: "name" },
        b: { op: "literal", value: null },
      })
    })
  })

  describe("logical operators", () => {
    it("and() combines expressions", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.and(
        fb.eq(fb.field("active"), true),
        fb.gt(fb.field("age"), 18),
      )
      const json = result.toJSON() as any
      expect(json.op).toBe("and")
      expect(json.exprs).toHaveLength(2)
      expect(json.exprs[0].op).toBe("eq")
      expect(json.exprs[1].op).toBe("gt")
    })

    it("or() combines expressions", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.or(
        fb.eq(fb.field("name"), "Alice"),
        fb.eq(fb.field("name"), "Bob"),
      )
      const json = result.toJSON() as any
      expect(json.op).toBe("or")
      expect(json.exprs).toHaveLength(2)
    })

    it("not() wraps expression", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.not(fb.eq(fb.field("active"), false))
      const json = result.toJSON() as any
      expect(json.op).toBe("not")
      expect(json.expr.op).toBe("eq")
    })

    it("nested logical operators", () => {
      const fb = new FilterBuilder<Doc>()
      const result = fb.and(
        fb.or(
          fb.eq(fb.field("name"), "Alice"),
          fb.eq(fb.field("name"), "Bob"),
        ),
        fb.not(fb.eq(fb.field("active"), false)),
      )
      const json = result.toJSON() as any
      expect(json.op).toBe("and")
      expect(json.exprs[0].op).toBe("or")
      expect(json.exprs[1].op).toBe("not")
    })
  })
})

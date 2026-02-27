import { describe, it, expect } from "vitest";
import { compileFilterToSQL } from "./FilterEngine";
import type { FilterExpressionJSON } from "@vex/server";

describe("compileFilterToSQL", () => {
  it("compiles scalar column eq filter", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "status" },
      b: { op: "literal", value: "active" },
    };
    const result = compileFilterToSQL(filter);
    expect(result).toEqual({
      sql: '("status" = ?)',
      params: ["active"],
    });
  });

  it("compiles JSON column with scalar literal (union)", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "type" },
      b: { op: "literal", value: "user" },
    };
    const jsonColumns = new Set(["type"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).toEqual({
      sql: "(json_extract(\"type\", '$') = ?)",
      params: ["user"],
    });
  });

  it("compiles JSON column with array literal", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "labels" },
      b: { op: "literal", value: ["urgent"] },
    };
    const jsonColumns = new Set(["labels"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).toEqual({
      sql: "(json_extract(\"labels\", '$') = json(?))",
      params: ['["urgent"]'],
    });
  });

  it("compiles JSON column with object literal", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "metadata" },
      b: { op: "literal", value: { key: "val" } },
    };
    const jsonColumns = new Set(["metadata"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).toEqual({
      sql: "(json_extract(\"metadata\", '$') = json(?))",
      params: ['{"key":"val"}'],
    });
  });

  it("compiles nested path on JSON column", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "address.city" },
      b: { op: "literal", value: "NYC" },
    };
    const jsonColumns = new Set(["address"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).toEqual({
      sql: '(json_extract("address", ?) = ?)',
      params: ["$.city", "NYC"],
    });
  });

  it("compiles deeply nested path", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "profile.address.zip" },
      b: { op: "literal", value: "10001" },
    };
    const jsonColumns = new Set(["profile"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).toEqual({
      sql: '(json_extract("profile", ?) = ?)',
      params: ["$.address.zip", "10001"],
    });
  });

  it("returns null for nested path on non-JSON column", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "name.first" },
      b: { op: "literal", value: "Alice" },
    };
    const result = compileFilterToSQL(filter);
    expect(result).toBeNull();
  });

  it("compiles AND with JSON columns", () => {
    const filter: FilterExpressionJSON = {
      op: "and",
      exprs: [
        { op: "eq", a: { op: "field", path: "type" }, b: { op: "literal", value: "user" } },
        { op: "eq", a: { op: "field", path: "address.city" }, b: { op: "literal", value: "NYC" } },
      ],
    };
    const jsonColumns = new Set(["type", "address"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).not.toBeNull();
    expect(result!.sql).toBe(
      "((json_extract(\"type\", '$') = ?) AND (json_extract(\"address\", ?) = ?))"
    );
    expect(result!.params).toEqual(["user", "$.city", "NYC"]);
  });

  it("compiles OR with mixed scalar and JSON columns", () => {
    const filter: FilterExpressionJSON = {
      op: "or",
      exprs: [
        { op: "eq", a: { op: "field", path: "status" }, b: { op: "literal", value: "active" } },
        { op: "eq", a: { op: "field", path: "type" }, b: { op: "literal", value: "admin" } },
      ],
    };
    const jsonColumns = new Set(["type"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).not.toBeNull();
    expect(result!.sql).toBe(
      "((\"status\" = ?) OR (json_extract(\"type\", '$') = ?))"
    );
    expect(result!.params).toEqual(["active", "admin"]);
  });

  it("compiles NOT with JSON column", () => {
    const filter: FilterExpressionJSON = {
      op: "not",
      expr: {
        op: "eq",
        a: { op: "field", path: "type" },
        b: { op: "literal", value: "bot" },
      },
    };
    const jsonColumns = new Set(["type"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).not.toBeNull();
    expect(result!.sql).toBe("(NOT (json_extract(\"type\", '$') = ?))");
    expect(result!.params).toEqual(["bot"]);
  });

  it("compiles boolean literal to 1/0", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "active" },
      b: { op: "literal", value: true },
    };
    const result = compileFilterToSQL(filter);
    expect(result).toEqual({
      sql: '("active" = ?)',
      params: [1],
    });
  });

  it("compiles boolean false literal to 0", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "active" },
      b: { op: "literal", value: false },
    };
    const result = compileFilterToSQL(filter);
    expect(result).toEqual({
      sql: '("active" = ?)',
      params: [0],
    });
  });

  it("returns null for unsafe column name", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "Robert'; DROP TABLE students;--" },
      b: { op: "literal", value: 1 },
    };
    const result = compileFilterToSQL(filter);
    expect(result).toBeNull();
  });

  it("returns null for unsafe nested path segment", () => {
    const filter: FilterExpressionJSON = {
      op: "eq",
      a: { op: "field", path: "address.ci ty" },
      b: { op: "literal", value: "NYC" },
    };
    const jsonColumns = new Set(["address"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).toBeNull();
  });

  it("compiles numeric comparisons on JSON columns", () => {
    const filter: FilterExpressionJSON = {
      op: "gt",
      a: { op: "field", path: "metadata.score" },
      b: { op: "literal", value: 100 },
    };
    const jsonColumns = new Set(["metadata"]);
    const result = compileFilterToSQL(filter, jsonColumns);
    expect(result).toEqual({
      sql: '(json_extract("metadata", ?) > ?)',
      params: ["$.score", 100],
    });
  });
});

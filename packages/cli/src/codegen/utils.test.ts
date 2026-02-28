import { describe, it, expect } from "vitest";
import { quotePropertyName, escapeStringLiteral, validatorTypeToTs } from "./utils";

describe("quotePropertyName", () => {
  it("passes through valid identifiers", () => {
    expect(quotePropertyName("foo")).toBe("foo");
    expect(quotePropertyName("_bar")).toBe("_bar");
    expect(quotePropertyName("$baz")).toBe("$baz");
    expect(quotePropertyName("camelCase")).toBe("camelCase");
  });

  it("quotes hyphenated names", () => {
    expect(quotePropertyName("email-ops")).toBe('"email-ops"');
  });

  it("quotes names with spaces", () => {
    expect(quotePropertyName("my field")).toBe('"my field"');
  });

  it("quotes reserved words", () => {
    expect(quotePropertyName("default")).toBe('"default"');
    expect(quotePropertyName("class")).toBe('"class"');
    expect(quotePropertyName("import")).toBe('"import"');
    expect(quotePropertyName("await")).toBe('"await"');
  });

  it("quotes names starting with a digit", () => {
    expect(quotePropertyName("123abc")).toBe('"123abc"');
  });
});

describe("escapeStringLiteral", () => {
  it("escapes double quotes", () => {
    expect(escapeStringLiteral('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes backslashes", () => {
    expect(escapeStringLiteral("path\\to")).toBe("path\\\\to");
  });

  it("escapes newlines", () => {
    expect(escapeStringLiteral("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes carriage returns", () => {
    expect(escapeStringLiteral("a\rb")).toBe("a\\rb");
  });

  it("escapes tabs", () => {
    expect(escapeStringLiteral("a\tb")).toBe("a\\tb");
  });

  it("handles combined escapes", () => {
    expect(escapeStringLiteral('a\\b\n"c"')).toBe('a\\\\b\\n\\"c\\"');
  });
});

describe("validatorTypeToTs", () => {
  it("handles all primitives", () => {
    expect(validatorTypeToTs({ type: "string" })).toBe("string");
    expect(validatorTypeToTs({ type: "number" })).toBe("number");
    expect(validatorTypeToTs({ type: "boolean" })).toBe("boolean");
    expect(validatorTypeToTs({ type: "null" })).toBe("null");
    expect(validatorTypeToTs({ type: "any" })).toBe("any");
    expect(validatorTypeToTs({ type: "id", tableName: "tasks" })).toBe("string");
    expect(validatorTypeToTs({ type: "float64" })).toBe("number");
    expect(validatorTypeToTs({ type: "int64" })).toBe("bigint");
    expect(validatorTypeToTs({ type: "bytes" })).toBe("ArrayBuffer");
  });

  it("handles string literals with escaping", () => {
    expect(validatorTypeToTs({ type: "literal", value: "hello" })).toBe('"hello"');
    expect(validatorTypeToTs({ type: "literal", value: 'say "hi"' })).toBe('"say \\"hi\\""');
  });

  it("handles numeric and boolean literals", () => {
    expect(validatorTypeToTs({ type: "literal", value: 42 })).toBe("42");
    expect(validatorTypeToTs({ type: "literal", value: true })).toBe("true");
    expect(validatorTypeToTs({ type: "literal", value: false })).toBe("false");
  });

  it("handles objects with quoted field names", () => {
    const json = {
      type: "object",
      value: {
        name: { type: "string" },
        "user-name": { type: "string" },
      },
    };
    expect(validatorTypeToTs(json)).toBe('{ name: string, "user-name": string }');
  });

  it("handles empty objects", () => {
    expect(validatorTypeToTs({ type: "object", value: {} })).toBe("{}");
  });

  it("handles arrays", () => {
    expect(validatorTypeToTs({ type: "array", value: { type: "string" } })).toBe("string[]");
  });

  it("wraps union-typed arrays in parens", () => {
    const json = {
      type: "array",
      value: { type: "union", value: [{ type: "string" }, { type: "number" }] },
    };
    expect(validatorTypeToTs(json)).toBe("(string | number)[]");
  });

  it("handles unions", () => {
    const json = { type: "union", value: [{ type: "string" }, { type: "number" }] };
    expect(validatorTypeToTs(json)).toBe("string | number");
  });

  it("handles empty union as never", () => {
    expect(validatorTypeToTs({ type: "union", value: [] })).toBe("never");
  });

  it("handles optional", () => {
    expect(validatorTypeToTs({ type: "optional", value: { type: "string" } })).toBe("string | undefined");
  });

  it("handles record", () => {
    const json = { type: "record", keys: { type: "string" }, values: { type: "number" } };
    expect(validatorTypeToTs(json)).toBe("Record<string, number>");
  });

  it("handles nested objects recursively", () => {
    const json = {
      type: "object",
      value: {
        inner: {
          type: "object",
          value: { x: { type: "number" } },
        },
      },
    };
    expect(validatorTypeToTs(json)).toBe("{ inner: { x: number } }");
  });

  it("returns unknown for null/undefined input", () => {
    expect(validatorTypeToTs(null)).toBe("unknown");
    expect(validatorTypeToTs(undefined)).toBe("unknown");
  });

  it("returns unknown for unrecognized types", () => {
    expect(validatorTypeToTs({ type: "foobar" })).toBe("unknown");
  });
});

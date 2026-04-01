import { describe, it, expect } from "vitest";
import { v } from "./validators.js";
import { validate, validatorToTypeString } from "./serialize.js";

// ---------- v.string() ----------
describe("v.string()", () => {
  const json = v.string().json;

  it("accepts a string", () => {
    expect(validate("hello", json)).toBe("hello");
  });
  it("rejects a number", () => {
    expect(() => validate(42, json)).toThrow("Expected string");
  });
  it("rejects null", () => {
    expect(() => validate(null, json)).toThrow("Expected string");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("string");
  });
});

// ---------- v.number() ----------
describe("v.number()", () => {
  const json = v.number().json;

  it("accepts an integer", () => {
    expect(validate(42, json)).toBe(42);
  });
  it("accepts a float", () => {
    expect(validate(3.14, json)).toBe(3.14);
  });
  it("rejects a string", () => {
    expect(() => validate("42", json)).toThrow("Expected number");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("number");
  });
});

// ---------- v.boolean() ----------
describe("v.boolean()", () => {
  const json = v.boolean().json;

  it("accepts true", () => {
    expect(validate(true, json)).toBe(true);
  });
  it("accepts false", () => {
    expect(validate(false, json)).toBe(false);
  });
  it("rejects 0", () => {
    expect(() => validate(0, json)).toThrow("Expected boolean");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("boolean");
  });
});

// ---------- v.null() ----------
describe("v.null()", () => {
  const json = v.null().json;

  it("accepts null", () => {
    expect(validate(null, json)).toBe(null);
  });
  it("rejects undefined", () => {
    expect(() => validate(undefined, json)).toThrow("Expected null");
  });
  it("rejects 0", () => {
    expect(() => validate(0, json)).toThrow("Expected null");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("null");
  });
});

// ---------- v.any() ----------
describe("v.any()", () => {
  const json = v.any().json;

  it("accepts anything", () => {
    expect(validate("hello", json)).toBe("hello");
    expect(validate(42, json)).toBe(42);
    expect(validate(null, json)).toBe(null);
    expect(validate(undefined, json)).toBe(undefined);
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("any");
  });
});

// ---------- v.id() ----------
describe("v.id()", () => {
  const json = v.id("users").json;

  it("accepts a string", () => {
    expect(validate("abc123", json)).toBe("abc123");
  });
  it("rejects a number", () => {
    expect(() => validate(123, json)).toThrow("Expected id");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe('Id<"users">');
  });
});

// ---------- v.literal() ----------
describe("v.literal()", () => {
  it("accepts matching string literal", () => {
    const json = v.literal("active").json;
    expect(validate("active", json)).toBe("active");
  });
  it("rejects non-matching string", () => {
    const json = v.literal("active").json;
    expect(() => validate("inactive", json)).toThrow();
  });
  it("accepts matching number literal", () => {
    const json = v.literal(42).json;
    expect(validate(42, json)).toBe(42);
  });
  it("rejects non-matching number", () => {
    const json = v.literal(42).json;
    expect(() => validate(43, json)).toThrow();
  });
  it("accepts matching boolean literal", () => {
    const json = v.literal(true).json;
    expect(validate(true, json)).toBe(true);
  });
  it("type string for string literal", () => {
    expect(validatorToTypeString(v.literal("active").json)).toBe('"active"');
  });
  it("type string for number literal", () => {
    expect(validatorToTypeString(v.literal(42).json)).toBe("42");
  });
  it("type string for boolean literal", () => {
    expect(validatorToTypeString(v.literal(true).json)).toBe("true");
  });
});

// ---------- v.object() ----------
describe("v.object()", () => {
  const json = v.object({ name: v.string(), age: v.number() }).json;

  it("accepts matching object", () => {
    const result = validate({ name: "Alice", age: 30 }, json);
    expect(result).toEqual({ name: "Alice", age: 30 });
  });
  it("rejects missing required field", () => {
    expect(() => validate({ name: "Alice" }, json)).toThrow("Missing required field: age");
  });
  it("rejects wrong field type", () => {
    expect(() => validate({ name: "Alice", age: "thirty" }, json)).toThrow("Expected number");
  });
  it("rejects non-object", () => {
    expect(() => validate("hello", json)).toThrow("Expected object");
  });
  it("rejects null", () => {
    expect(() => validate(null, json)).toThrow("Expected object");
  });
  it("rejects array", () => {
    expect(() => validate([1, 2], json)).toThrow("Expected object");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("{ name: string, age: number }");
  });
});

// ---------- v.array() ----------
describe("v.array()", () => {
  const json = v.array(v.number()).json;

  it("accepts matching array", () => {
    expect(validate([1, 2, 3], json)).toEqual([1, 2, 3]);
  });
  it("accepts empty array", () => {
    expect(validate([], json)).toEqual([]);
  });
  it("rejects array with wrong element type", () => {
    expect(() => validate([1, "two", 3], json)).toThrow("Expected number");
  });
  it("rejects non-array", () => {
    expect(() => validate("hello", json)).toThrow("Expected array");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("number[]");
  });
});

// ---------- v.optional() ----------
describe("v.optional()", () => {
  const json = v.optional(v.string()).json;

  it("accepts the inner type", () => {
    expect(validate("hello", json)).toBe("hello");
  });
  it("accepts undefined", () => {
    expect(validate(undefined, json)).toBe(undefined);
  });
  it("rejects wrong type", () => {
    expect(() => validate(42, json)).toThrow("Expected string");
  });
  it("object with optional field accepts missing field", () => {
    const obj = v.object({ name: v.string(), nick: v.optional(v.string()) }).json;
    expect(validate({ name: "Alice" }, obj)).toEqual({ name: "Alice", nick: undefined });
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("string | undefined");
  });
});

// ---------- v.union() ----------
describe("v.union()", () => {
  const json = v.union(v.string(), v.number()).json;

  it("accepts first variant", () => {
    expect(validate("hello", json)).toBe("hello");
  });
  it("accepts second variant", () => {
    expect(validate(42, json)).toBe(42);
  });
  it("rejects non-matching value", () => {
    expect(() => validate(true, json)).toThrow("does not match any union variant");
  });
  it("literal union", () => {
    const lit = v.union(v.literal("a"), v.literal("b")).json;
    expect(validate("a", lit)).toBe("a");
    expect(validate("b", lit)).toBe("b");
    expect(() => validate("c", lit)).toThrow();
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("string | number");
  });
});

// ---------- v.record() ----------
describe("v.record()", () => {
  const json = v.record(v.string(), v.number()).json;

  it("accepts matching record", () => {
    expect(validate({ a: 1, b: 2 }, json)).toEqual({ a: 1, b: 2 });
  });
  it("accepts empty record", () => {
    expect(validate({}, json)).toEqual({});
  });
  it("rejects wrong value type", () => {
    expect(() => validate({ a: "one" }, json)).toThrow("Expected number");
  });
  it("rejects non-object", () => {
    expect(() => validate("hello", json)).toThrow("Expected record");
  });
  it("rejects null", () => {
    expect(() => validate(null, json)).toThrow("Expected record");
  });
  it("rejects array", () => {
    expect(() => validate([1], json)).toThrow("Expected record");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("Record<string, number>");
  });
});

// ---------- v.float64() ----------
describe("v.float64()", () => {
  const json = v.float64().json;

  it("accepts an integer", () => {
    expect(validate(42, json)).toBe(42);
  });
  it("accepts a float", () => {
    expect(validate(3.14, json)).toBe(3.14);
  });
  it("accepts negative", () => {
    expect(validate(-0.5, json)).toBe(-0.5);
  });
  it("accepts Infinity", () => {
    expect(validate(Infinity, json)).toBe(Infinity);
  });
  it("accepts NaN", () => {
    expect(validate(NaN, json)).toBeNaN();
  });
  it("rejects a string", () => {
    expect(() => validate("3.14", json)).toThrow("Expected float64");
  });
  it("rejects boolean", () => {
    expect(() => validate(true, json)).toThrow("Expected float64");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("number");
  });
});

// ---------- v.int64() ----------
describe("v.int64()", () => {
  const json = v.int64().json;

  it("accepts a bigint", () => {
    expect(validate(BigInt(42), json)).toBe(BigInt(42));
  });
  it("accepts a large bigint", () => {
    const big = BigInt("9007199254740993");
    expect(validate(big, json)).toBe(big);
  });
  it("accepts an integer number", () => {
    expect(validate(42, json)).toBe(42);
  });
  it("accepts zero", () => {
    expect(validate(0, json)).toBe(0);
  });
  it("accepts negative integer", () => {
    expect(validate(-10, json)).toBe(-10);
  });
  it("rejects a non-integer number", () => {
    expect(() => validate(3.14, json)).toThrow("non-integer number");
  });
  it("rejects a string", () => {
    expect(() => validate("42", json)).toThrow("Expected int64");
  });
  it("rejects boolean", () => {
    expect(() => validate(true, json)).toThrow("Expected int64");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("bigint");
  });
});

// ---------- v.bytes() ----------
describe("v.bytes()", () => {
  const json = v.bytes().json;

  it("accepts an ArrayBuffer", () => {
    const buf = new ArrayBuffer(8);
    expect(validate(buf, json)).toBe(buf);
  });
  it("accepts a Uint8Array (ArrayBuffer view)", () => {
    const arr = new Uint8Array([1, 2, 3]);
    expect(validate(arr, json)).toBe(arr);
  });
  it("accepts a base64 string", () => {
    expect(validate("SGVsbG8=", json)).toBe("SGVsbG8=");
  });
  it("rejects a number", () => {
    expect(() => validate(42, json)).toThrow("Expected bytes");
  });
  it("rejects null", () => {
    expect(() => validate(null, json)).toThrow("Expected bytes");
  });
  it("rejects boolean", () => {
    expect(() => validate(true, json)).toThrow("Expected bytes");
  });
  it("type string", () => {
    expect(validatorToTypeString(json)).toBe("ArrayBuffer");
  });
});

// ---------- Nested / composite validators ----------
describe("nested validators", () => {
  it("array of objects", () => {
    const json = v.array(v.object({ x: v.number() })).json;
    expect(validate([{ x: 1 }, { x: 2 }], json)).toEqual([{ x: 1 }, { x: 2 }]);
    expect(() => validate([{ x: "a" }], json)).toThrow("Expected number");
  });

  it("object with optional array", () => {
    const json = v.object({
      tags: v.optional(v.array(v.string())),
    }).json;
    expect(validate({}, json)).toEqual({ tags: undefined });
    expect(validate({ tags: ["a", "b"] }, json)).toEqual({ tags: ["a", "b"] });
  });

  it("union of objects", () => {
    const json = v.union(
      v.object({ type: v.literal("a"), value: v.string() }),
      v.object({ type: v.literal("b"), value: v.number() }),
    ).json;
    expect(validate({ type: "a", value: "hello" }, json)).toEqual({ type: "a", value: "hello" });
    expect(validate({ type: "b", value: 42 }, json)).toEqual({ type: "b", value: 42 });
    expect(() => validate({ type: "c", value: true }, json)).toThrow("does not match any union variant");
  });

  it("record of arrays", () => {
    const json = v.record(v.string(), v.array(v.number())).json;
    expect(validate({ scores: [1, 2, 3] }, json)).toEqual({ scores: [1, 2, 3] });
    expect(() => validate({ scores: ["a"] }, json)).toThrow("Expected number");
  });

  it("deeply nested object", () => {
    const json = v.object({
      user: v.object({
        profile: v.object({
          name: v.string(),
        }),
      }),
    }).json;
    expect(validate({ user: { profile: { name: "Alice" } } }, json)).toEqual({
      user: { profile: { name: "Alice" } },
    });
  });
});

// ---------- validatorToTypeString edge cases ----------
describe("validatorToTypeString", () => {
  it("nested object type", () => {
    const json = v.object({ user: v.object({ name: v.string() }) }).json;
    expect(validatorToTypeString(json)).toBe("{ user: { name: string } }");
  });

  it("optional array type", () => {
    const json = v.optional(v.array(v.number())).json;
    expect(validatorToTypeString(json)).toBe("number[] | undefined");
  });

  it("union of literals type", () => {
    const json = v.union(v.literal("a"), v.literal("b"), v.literal("c")).json;
    expect(validatorToTypeString(json)).toBe('"a" | "b" | "c"');
  });

  it("record with complex values type", () => {
    const json = v.record(v.string(), v.array(v.number())).json;
    expect(validatorToTypeString(json)).toBe("Record<string, number[]>");
  });
});

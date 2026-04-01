import type { ValidatorJSON } from "./types.js";

const JS_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const JS_RESERVED_WORDS = new Set([
  "break", "case", "catch", "continue", "debugger", "default", "delete", "do",
  "else", "finally", "for", "function", "if", "in", "instanceof", "new",
  "return", "switch", "this", "throw", "try", "typeof", "var", "void",
  "while", "with", "class", "const", "enum", "export", "extends", "import",
  "super", "implements", "interface", "let", "package", "private", "protected",
  "public", "static", "yield", "await", "async",
]);

/**
 * Returns `name` unchanged if it's a valid JS identifier, otherwise wraps in quotes.
 */
export function quotePropertyName(name: string): string {
  if (JS_IDENTIFIER_RE.test(name) && !JS_RESERVED_WORDS.has(name)) {
    return name;
  }
  return JSON.stringify(name);
}

/**
 * Escapes special characters in a string for use inside a JS string literal.
 */
export function escapeStringLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Converts ValidatorJSON to a TypeScript type string.
 * Handles all 15 ValidatorJSON types with proper edge-case handling:
 * - Parenthesizes union types inside arrays: `(A | B)[]`
 * - Quotes non-identifier property names
 * - Escapes special characters in string literals
 */
export function validatorToTypeString(json: ValidatorJSON | null | undefined): string {
  if (!json) return "unknown";
  switch (json.type) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "any": return "any";
    case "id": return `Id<"${json.tableName}">`;
    case "float64": return "number";
    case "int64": return "bigint";
    case "bytes": return "ArrayBuffer";
    case "literal": {
      if (typeof json.value === "string") {
        return `"${escapeStringLiteral(json.value)}"`;
      }
      return `${json.value}`;
    }
    case "object": {
      const entries = Object.entries(json.value || {});
      if (entries.length === 0) return "{}";
      const fields = entries.map(([k, v]) =>
        `${quotePropertyName(k)}: ${validatorToTypeString(v)}`
      );
      return `{ ${fields.join(", ")} }`;
    }
    case "array": {
      const inner = validatorToTypeString(json.value);
      // Wrap union types in parens so `(A | B)[]` not `A | B[]`
      if (json.value && json.value.type === "union") {
        return `(${inner})[]`;
      }
      return `${inner}[]`;
    }
    case "union": {
      const variants = json.value || [];
      if (variants.length === 0) return "never";
      return variants.map((v) => validatorToTypeString(v)).join(" | ");
    }
    case "optional": return `${validatorToTypeString(json.value)} | undefined`;
    case "record": return `Record<${validatorToTypeString(json.keys)}, ${validatorToTypeString(json.values)}>`;
    default: return "unknown";
  }
}

export function validate<T>(value: unknown, json: ValidatorJSON): T {
  if (json.type === "any") {
    return value as T;
  }

  if (json.type === "null") {
    if (value !== null) {
      throw new Error(`Expected null, got ${value}`);
    }
    return value as T;
  }

  if (json.type === "string") {
    if (typeof value !== "string") {
      throw new Error(`Expected string, got ${typeof value}`);
    }
    return value as T;
  }

  if (json.type === "number") {
    if (typeof value !== "number") {
      throw new Error(`Expected number, got ${typeof value}`);
    }
    return value as T;
  }

  if (json.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error(`Expected boolean, got ${typeof value}`);
    }
    return value as T;
  }

  if (json.type === "literal") {
    if (value !== json.value) {
      throw new Error(`Expected ${json.value}, got ${value}`);
    }
    return value as T;
  }

  if (json.type === "id") {
    if (typeof value !== "string") {
      throw new Error(`Expected id (string), got ${typeof value}`);
    }
    return value as T;
  }

  if (json.type === "array") {
    if (!Array.isArray(value)) {
      throw new Error(`Expected array, got ${typeof value}`);
    }
    return value.map((item) => validate(item, json.value)) as T;
  }

  if (json.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Expected object, got ${typeof value}`);
    }
    const result: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(json.value)) {
      if (!(key in (value as Record<string, unknown>))) {
        if (schema.type === "optional") {
          result[key] = undefined;
          continue;
        }
        throw new Error(`Missing required field: ${key}`);
      }
      result[key] = validate((value as Record<string, unknown>)[key], schema);
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (!(key in json.value)) {
        throw new Error(`Unexpected field: ${key}`);
      }
    }
    return result as T;
  }

  if (json.type === "union") {
    for (const variant of json.value) {
      try {
        return validate(value, variant);
      } catch {
        // continue
      }
    }
    throw new Error(`Value does not match any union variant`);
  }

  if (json.type === "optional") {
    if (value === undefined) {
      return undefined as T;
    }
    return validate(value, json.value) as T;
  }

  if (json.type === "record") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Expected record (object), got ${typeof value}`);
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      validate(key, json.keys);
      result[key] = validate(val, json.values);
    }
    return result as T;
  }

  if (json.type === "float64") {
    if (typeof value !== "number") {
      throw new Error(`Expected float64 (number), got ${typeof value}`);
    }
    return value as T;
  }

  if (json.type === "int64") {
    if (typeof value === "bigint") {
      return value as T;
    }
    if (typeof value === "number" && Number.isInteger(value)) {
      return value as T;
    }
    throw new Error(`Expected int64 (integer), got ${typeof value === "number" ? "non-integer number" : typeof value}`);
  }

  if (json.type === "bytes") {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return value as T;
    }
    if (typeof value === "string") {
      return value as T;
    }
    throw new Error(`Expected bytes (ArrayBuffer or base64 string), got ${typeof value}`);
  }

  throw new Error(`Unknown validator type`);
}

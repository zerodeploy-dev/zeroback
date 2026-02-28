// Shared codegen utilities

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
 * Canonical implementation: converts ValidatorJSON to a TypeScript type string.
 * Covers all 15 ValidatorJSON types.
 */
export function validatorTypeToTs(json: any): string {
  if (!json) return "unknown";
  switch (json.type) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "any": return "any";
    case "id": return "string";
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
        `${quotePropertyName(k)}: ${validatorTypeToTs(v)}`
      );
      return `{ ${fields.join(", ")} }`;
    }
    case "array": {
      const inner = validatorTypeToTs(json.value);
      // Wrap union types in parens so `(A | B)[]` not `A | B[]`
      if (json.value && json.value.type === "union") {
        return `(${inner})[]`;
      }
      return `${inner}[]`;
    }
    case "union": {
      const variants: any[] = json.value || [];
      if (variants.length === 0) return "never";
      return variants.map((v: any) => validatorTypeToTs(v)).join(" | ");
    }
    case "optional": return `${validatorTypeToTs(json.value)} | undefined`;
    case "record": return `Record<${validatorTypeToTs(json.keys)}, ${validatorTypeToTs(json.values)}>`;
    default: return "unknown";
  }
}

import type { ValidatorJSON } from "./types.js";

export function validatorToTypeString(json: ValidatorJSON): string {
  switch (json.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "any":
      return "any";
    case "id":
      return `string`;
    case "literal":
      return typeof json.value === "string" ? `"${json.value}"` : `${json.value}`;
    case "object":
      return `{ ${Object.entries(json.value)
        .map(([key, val]) => `${key}: ${validatorToTypeString(val)}`)
        .join(", ")} }`;
    case "array":
      return `${validatorToTypeString(json.value)}[]`;
    case "union":
      return json.value.map((v) => validatorToTypeString(v)).join(" | ");
    case "optional":
      return `${validatorToTypeString(json.value)} | undefined`;
    case "record":
      return `Record<${validatorToTypeString(json.keys)}, ${validatorToTypeString(json.values)}>`;
    case "float64":
      return "number";
    case "int64":
      return "bigint";
    case "bytes":
      return "ArrayBuffer";
    default:
      return "any";
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

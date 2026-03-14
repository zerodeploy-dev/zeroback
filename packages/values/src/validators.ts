import type { Validator, ValidatorJSON, PropertyValidators, ObjectType, Id, ValidatorKind } from "./types.js";

function createValidator<T, K extends ValidatorKind>(kind: K, json: ValidatorJSON): Validator<T> {
  return {
    _type: undefined as unknown as T,
    kind,
    json,
  };
}

export const v = {
  string(): Validator<string> {
    return createValidator<string, "string">("string", { type: "string" });
  },

  number(): Validator<number> {
    return createValidator<number, "number">("number", { type: "number" });
  },

  boolean(): Validator<boolean> {
    return createValidator<boolean, "boolean">("boolean", { type: "boolean" });
  },

  null(): Validator<null> {
    return createValidator<null, "null">("null", { type: "null" });
  },

  any(): Validator<any> {
    return createValidator<any, "any">("any", { type: "any" });
  },

  id<T extends string>(tableName: T): Validator<Id<T>> {
    return createValidator<Id<T>, "id">("id", { type: "id", tableName });
  },

  literal<T extends string | number | boolean>(value: T): Validator<T> {
    return createValidator<T, "literal">("literal", { type: "literal", value });
  },

  object<F extends PropertyValidators>(fields: F): Validator<ObjectType<F>> {
    const json: ValidatorJSON = {
      type: "object",
      value: Object.fromEntries(
        Object.entries(fields).map(([key, validator]) => [key, validator.json])
      ),
    };
    return createValidator<ObjectType<F>, "object">("object", json);
  },

  array<T>(element: Validator<T>): Validator<T[]> {
    return createValidator<T[], "array">("array", { type: "array", value: element.json });
  },

  optional<T>(validator: Validator<T>): Validator<T | undefined> {
    return createValidator<T | undefined, "optional">("optional", {
      type: "optional",
      value: validator.json,
    });
  },

  union<T extends Validator<any>[]>(...members: T): Validator<T[number]["_type"]> {
    return createValidator<T[number]["_type"], "union">("union", {
      type: "union",
      value: members.map((m) => m.json),
    });
  },

  record<K extends Validator<string>, V extends Validator<any>>(
    keys: K,
    values: V
  ): Validator<Record<K["_type"], V["_type"]>> {
    return createValidator<Record<K["_type"], V["_type"]>, "record">("record", {
      type: "record",
      keys: keys.json,
      values: values.json,
    });
  },

  float64(): Validator<number> {
    return createValidator<number, "float64">("float64", { type: "float64" });
  },

  int64(): Validator<bigint> {
    return createValidator<bigint, "int64">("int64", { type: "int64" });
  },

  bytes(): Validator<ArrayBuffer> {
    return createValidator<ArrayBuffer, "bytes">("bytes", { type: "bytes" });
  },
};

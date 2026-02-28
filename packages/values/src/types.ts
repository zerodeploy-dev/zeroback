export type ValidatorKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "id"
  | "object"
  | "array"
  | "union"
  | "literal"
  | "any"
  | "optional"
  | "record"
  | "float64"
  | "int64"
  | "bytes";

export type ValidatorJSON =
  | { type: "string" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "null" }
  | { type: "id"; tableName: string }
  | { type: "object"; value: Record<string, ValidatorJSON> }
  | { type: "array"; value: ValidatorJSON }
  | { type: "union"; value: ValidatorJSON[] }
  | { type: "literal"; value: string | number | boolean }
  | { type: "any" }
  | { type: "optional"; value: ValidatorJSON }
  | { type: "record"; keys: ValidatorJSON; values: ValidatorJSON }
  | { type: "float64" }
  | { type: "int64" }
  | { type: "bytes" };

export type PropertyValidators = Record<string, Validator<any>>;

export type Validator<T> = {
  _type: T;
  kind: ValidatorKind;
  json: ValidatorJSON;
};

export type Infer<V extends Validator<any>> = V["_type"];

export type ObjectType<F extends PropertyValidators> = {
  [K in keyof F as F[K] extends Validator<infer T>
    ? undefined extends T ? never : K
    : K]: F[K] extends Validator<infer T> ? T : never
} & {
  [K in keyof F as F[K] extends Validator<infer T>
    ? undefined extends T ? K : never
    : never]?: F[K] extends Validator<infer T> ? Exclude<T, undefined> : never
};

export type Id<TableName extends string = string> = string;

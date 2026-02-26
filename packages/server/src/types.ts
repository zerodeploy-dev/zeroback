import type { Validator, ValidatorJSON, PropertyValidators, ObjectType, Id } from "@vex/values";

export interface DbOps {
  query(table: string, filter: FilterExpressionJSON | null, orderField: string | null, orderDirection: "asc" | "desc", limit: number | null, indexQuery?: IndexQueryJSON | null): Promise<any[]>;
  get(table: string, id: string): Promise<any>;
  getMany(table: string, ids: string[]): Promise<Map<string, any>>;
  insert(table: string, id: string, data: any): Promise<void>;
  patch(table: string, id: string, fields: any): Promise<void>;
  replace(table: string, id: string, data: any): Promise<void>;
  delete(table: string, id: string): Promise<void>;
}

export type Scheduler = {
  runAfter(delayMs: number, fnName: string, args?: unknown): Promise<string>;
  runAt(timestamp: number, fnName: string, args?: unknown): Promise<string>;
  cancel(id: string): Promise<void>;
};

export type QueryCtx<DataModel> = {
  db: import("./db/reader.js").DatabaseReader<DataModel>;
};

export type MutationCtx<DataModel> = {
  db: import("./db/writer.js").DatabaseWriter<DataModel>;
  scheduler: Scheduler;
};

export type ActionCtx<DataModel> = {
  runQuery(fnName: string, args?: unknown): Promise<any>;
  runMutation(fnName: string, args?: unknown): Promise<any>;
  runAction(fnName: string, args?: unknown): Promise<any>;
  scheduler: Scheduler;
};

export type RegisteredQuery<Args, Returns> = {
  _name: string;
  _type: "query";
  _isInternal: boolean;
  _args: Args;
  _returns: Returns;
};

export type RegisteredMutation<Args, Returns> = {
  _name: string;
  _type: "mutation";
  _isInternal: boolean;
  _args: Args;
  _returns: Returns;
};

export type RegisteredAction<Args, Returns> = {
  _name: string;
  _type: "action";
  _isInternal: boolean;
  _args: Args;
  _returns: Returns;
};

export type FunctionReference<
  Type extends "query" | "mutation" | "action",
  Args = unknown,
  Returns = unknown
> = Type extends "query"
  ? RegisteredQuery<Args, Returns>
  : Type extends "mutation"
    ? RegisteredMutation<Args, Returns>
    : RegisteredAction<Args, Returns>;

export type TableDefinition<F> = {
  validator: Validator<F>;
  _doc: F;
  indexes: TableIndex[];
  index(name: string, fields: string[]): TableDefinition<F>;
};

export type TableIndex = {
  name: string;
  fields: string[];
};

export type SchemaDefinition<T> = {
  tables: T;
};

export type DataModelFromSchema<S extends SchemaDefinition<any>> = {
  [TableName in keyof S["tables"]]: S["tables"][TableName]["_doc"] & {
    _id: Id<string & TableName>;
    _creationTime: number;
  };
};

export type FilterExpressionJSON =
  | { op: "eq"; a: ExprJSON; b: ExprJSON }
  | { op: "neq"; a: ExprJSON; b: ExprJSON }
  | { op: "lt"; a: ExprJSON; b: ExprJSON }
  | { op: "lte"; a: ExprJSON; b: ExprJSON }
  | { op: "gt"; a: ExprJSON; b: ExprJSON }
  | { op: "gte"; a: ExprJSON; b: ExprJSON }
  | { op: "and"; exprs: FilterExpressionJSON[] }
  | { op: "or"; exprs: FilterExpressionJSON[] }
  | { op: "not"; expr: FilterExpressionJSON }
  | { op: "field"; path: string }
  | { op: "literal"; value: unknown };

export type ExprJSON = { op: "field"; path: string } | { op: "literal"; value: unknown };

export type ReadSetEntry = {
  table: string;
  documentId: string;
  ts: number;
};

export type WriteSetEntry = {
  table: string;
  documentId: string;
  data: unknown | null;
};

export type FunctionManifest = {
  [fnName: string]: {
    type: "query" | "mutation" | "action";
    args: ValidatorJSON;
    returnsTypeString: string;
  };
};

export type SchemaJSON = {
  tables: Record<
    string,
    {
      fields: Record<string, ValidatorJSON>;
      indexes: { name: string; fields: string[] }[];
    }
  >;
};

export type IndexQueryJSON = {
  indexName: string;
  ranges: { field: string; op: "eq" | "gt" | "gte" | "lt" | "lte"; value: unknown }[];
};

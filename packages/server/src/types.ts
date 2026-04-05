import type { Validator, ValidatorJSON, PropertyValidators, ObjectType, Id } from "@zeroback/values";

export type KeysetCursorInfo = {
  sortValue: unknown;
  lastId: string;
  sortField: string;
  direction: "asc" | "desc";
};

export interface DbOps {
  query(table: string, filter: FilterExpressionJSON | null, orderField: string | null, orderDirection: "asc" | "desc", limit: number | null, indexQuery?: IndexQueryJSON | null, keysetCursor?: KeysetCursorInfo | null, searchQuery?: SearchQueryJSON | null): Promise<Record<string, unknown>[]>;
  count(table: string, filter: FilterExpressionJSON | null, indexQuery?: IndexQueryJSON | null, searchQuery?: SearchQueryJSON | null): Promise<number>;
  get(table: string, id: string): Promise<Record<string, unknown> | null>;
  getMany(table: string, ids: string[]): Promise<Map<string, Record<string, unknown> | null>>;
  insert(table: string, id: string, data: Record<string, unknown>): Promise<void>;
  patch(table: string, id: string, fields: Record<string, unknown>): Promise<void>;
  replace(table: string, id: string, data: Record<string, unknown>): Promise<void>;
  delete(table: string, id: string): Promise<void>;
}

export type Scheduler = {
  runAfter(delayMs: number, fnName: string, args?: unknown): Promise<string>;
  runAt(timestamp: number, fnName: string, args?: unknown): Promise<string>;
  cancel(id: string): Promise<void>;
};

import type { UserIdentity } from "@zeroback/values";

export type AuthCtx = {
  getUserIdentity(): Promise<UserIdentity | null>
}

type WithAuth<Base, Auth> = Auth extends undefined ? Base : Base & { auth: NonNullable<Auth> }

export type QueryCtx<DataModel, Auth = undefined> = WithAuth<{
  db: import("./db/reader.js").DatabaseReader<DataModel>;
  storage: import("./storage.js").StorageReader;
}, Auth>

export type MutationCtx<DataModel, Auth = undefined> = WithAuth<{
  db: import("./db/writer.js").DatabaseWriter<DataModel>;
  scheduler: Scheduler;
  storage: import("./storage.js").StorageWriter;
}, Auth>

export type ActionCtx<DataModel, Auth = undefined> = WithAuth<{
  runQuery<T>(fnName: string, args?: Record<string, unknown>): Promise<T>;
  runMutation<T>(fnName: string, args?: Record<string, unknown>): Promise<T>;
  runAction<T>(fnName: string, args?: Record<string, unknown>): Promise<T>;
  scheduler: Scheduler;
  storage: import("./storage.js").StorageActions;
}, Auth>

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
  searchIndexes: SearchIndex[];
  _idPrefix?: string;
  index(name: string, fields: string[]): TableDefinition<F>;
  searchIndex(name: string, opts: { searchField: string }): TableDefinition<F>;
  idPrefix(prefix: string): TableDefinition<F>;
};

export type TableIndex = {
  name: string;
  fields: string[];
};

export type SearchIndex = {
  name: string;
  searchField: string;
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
    isInternal: boolean;
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
      searchIndexes?: { name: string; searchField: string }[];
      idPrefix?: string;
    }
  >;
};

export type IndexQueryJSON = {
  indexName: string;
  ranges: { field: string; op: "eq" | "gt" | "gte" | "lt" | "lte"; value: unknown }[];
};

export type SearchQueryJSON = {
  searchField: string;
  searchQuery: string;
};

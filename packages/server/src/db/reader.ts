import type { DbOps, FilterExpressionJSON, IndexQueryJSON, KeysetCursorInfo, SearchQueryJSON } from "../types.js";
import { QueryBuilder } from "./query-builder.js";
import { tableFromId, type Id } from "@zeroback/values";

export class DatabaseReader<DataModel> {
  constructor(protected ops: DbOps) {}

  query<T extends keyof DataModel & string>(table: T): QueryBuilder<DataModel[T]> {
    return new QueryBuilder(table, this);
  }

  async get<T extends keyof DataModel & string>(table: T, id: string): Promise<DataModel[T] | null>
  async get(id: string): Promise<DataModel[keyof DataModel & string] | null>
  async get<T extends keyof DataModel & string>(
    tableOrId: T | string,
    id?: string
  ): Promise<DataModel[T] | DataModel[keyof DataModel & string] | null> {
    if (id !== undefined) {
      return (await this.ops.get(tableOrId, id)) as DataModel[T] | null;
    }
    const table = tableFromId(tableOrId);
    return (await this.ops.get(table, tableOrId)) as DataModel[keyof DataModel & string] | null;
  }

  async getMany<T extends keyof DataModel & string>(table: T, ids: string[]): Promise<Map<string, DataModel[T] | null>>
  async getMany(ids: string[]): Promise<Map<string, DataModel[keyof DataModel & string] | null>>
  async getMany<T extends keyof DataModel & string>(
    tableOrIds: T | string[],
    ids?: string[]
  ): Promise<Map<string, DataModel[T] | DataModel[keyof DataModel & string] | null>> {
    if (Array.isArray(tableOrIds)) {
      // plain-string overload: getMany(ids)
      if (tableOrIds.length === 0) return new Map();
      const table = tableFromId(tableOrIds[0]);
      const result = await this.ops.getMany(table, tableOrIds);
      const out = new Map<string, DataModel[keyof DataModel & string] | null>();
      for (const id of tableOrIds) {
        out.set(id, (result.get(id) ?? null) as DataModel[keyof DataModel & string] | null);
      }
      return out;
    }
    // table-explicit overload: getMany(table, ids)
    const resolvedIds = ids ?? [];
    if (resolvedIds.length === 0) return new Map();
    const result = await this.ops.getMany(tableOrIds, resolvedIds);
    const out = new Map<string, DataModel[T] | null>();
    for (const id of resolvedIds) {
      out.set(id, (result.get(id) ?? null) as DataModel[T] | null);
    }
    return out;
  }

  async queryRaw(
    table: string,
    filter: FilterExpressionJSON | null,
    orderField: string | null,
    orderDirection: "asc" | "desc",
    limit: number | null,
    indexQuery?: IndexQueryJSON | null,
    keysetCursor?: KeysetCursorInfo | null,
    searchQuery?: SearchQueryJSON | null
  ): Promise<Record<string, unknown>[]> {
    return this.ops.query(table, filter, orderField, orderDirection, limit, indexQuery, keysetCursor, searchQuery);
  }
}


import type { DbOps, FilterExpressionJSON, IndexQueryJSON, KeysetCursorInfo, SearchQueryJSON } from "../types.js";
import { QueryBuilder } from "./query-builder.js";
import type { Id } from "@zeroback/values";

export class DatabaseReader<DataModel> {
  constructor(protected ops: DbOps) {}

  query<T extends keyof DataModel & string>(table: T): QueryBuilder<DataModel[T]> {
    return new QueryBuilder(table, this as DatabaseReader<any>);
  }

  async get<T extends keyof DataModel & string>(
    id: Id<T>
  ): Promise<DataModel[T] | null> {
    const table = tableFromId(id);
    return (await this.ops.get(table, id)) as DataModel[T] | null;
  }

  async getMany<T extends keyof DataModel & string>(
    ...ids: Id<T>[]
  ): Promise<Map<Id<T>, DataModel[T] | null>> {
    if (ids.length === 0) return new Map();
    const table = tableFromId(ids[0]);
    const result = await this.ops.getMany(table, ids as string[]);
    const out = new Map<Id<T>, DataModel[T] | null>();
    for (const id of ids) {
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
  ): Promise<any[]> {
    return this.ops.query(table, filter, orderField, orderDirection, limit, indexQuery, keysetCursor, searchQuery);
  }
}

function tableFromId(id: string): string {
  const parts = id.split(":");
  return parts[0] ?? "";
}

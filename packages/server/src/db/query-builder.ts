import type { FilterExpressionJSON, IndexQueryJSON, KeysetCursorInfo } from "../types.js";
import type { DatabaseReader } from "./reader.js";
import { FilterBuilder, FilterExpression } from "./filter.js";

export interface PaginationResult<Doc> {
  page: Doc[];
  continueCursor: string | null;
  isDone: boolean;
}

export class IndexRangeBuilder {
  private ranges: IndexQueryJSON["ranges"] = [];

  eq(field: string, value: unknown): this {
    this.ranges.push({ field, op: "eq", value });
    return this;
  }

  gt(field: string, value: unknown): this {
    this.ranges.push({ field, op: "gt", value });
    return this;
  }

  gte(field: string, value: unknown): this {
    this.ranges.push({ field, op: "gte", value });
    return this;
  }

  lt(field: string, value: unknown): this {
    this.ranges.push({ field, op: "lt", value });
    return this;
  }

  lte(field: string, value: unknown): this {
    this.ranges.push({ field, op: "lte", value });
    return this;
  }

  toJSON(): IndexQueryJSON["ranges"] {
    return this.ranges;
  }
}

export class QueryBuilder<Doc> {
  private filterExpr: FilterExpressionJSON | null = null;
  private indexQueryValue: IndexQueryJSON | null = null;
  private orderField: string | null = null;
  private orderDirection: "asc" | "desc" = "asc";
  private limitValue: number | null = null;

  constructor(
    private table: string,
    private reader: DatabaseReader<any>
  ) {}

  withIndex(indexName: string, fn?: (q: IndexRangeBuilder) => IndexRangeBuilder): this {
    const builder = new IndexRangeBuilder();
    if (fn) {
      fn(builder);
    }
    this.indexQueryValue = { indexName, ranges: builder.toJSON() };
    return this;
  }

  filter(fn: (q: FilterBuilder<Doc>) => FilterExpression): this {
    const fb = new FilterBuilder<Doc>();
    this.filterExpr = fn(fb).toJSON();
    return this;
  }

  order(direction: "asc" | "desc"): this {
    this.orderDirection = direction;
    return this;
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): this {
    this.orderField = field;
    this.orderDirection = direction;
    return this;
  }

  take(n: number): Promise<Doc[]> {
    this.limitValue = n;
    return this.collect();
  }

  async collect(): Promise<Doc[]> {
    const result = await this.reader.queryRaw(
      this.table,
      this.filterExpr,
      this.orderField,
      this.orderDirection,
      this.limitValue,
      this.indexQueryValue
    );
    return result as Doc[];
  }

  async first(): Promise<Doc | null> {
    const results = await this.take(1);
    return results[0] ?? null;
  }

  async unique(): Promise<Doc> {
    const results = await this.take(2);
    if (results.length === 0) {
      throw new Error("Expected exactly one result, got none");
    }
    if (results.length > 1) {
      throw new Error("Expected exactly one result, got multiple");
    }
    return results[0];
  }

  async paginate(opts: { cursor: string | null; numItems: number }): Promise<PaginationResult<Doc>> {
    const numItems = opts.numItems;
    const keysetCursor = opts.cursor ? decodeKeysetCursor(opts.cursor) : null;

    // Fetch one extra to determine if there are more results
    const allResults = await this.reader.queryRaw(
      this.table,
      this.filterExpr,
      this.orderField,
      this.orderDirection,
      numItems + 1,
      this.indexQueryValue,
      keysetCursor
    );

    const hasMore = allResults.length > numItems;
    const page = hasMore ? allResults.slice(0, numItems) as Doc[] : allResults as Doc[];

    let continueCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const lastDoc = page[page.length - 1] as any;
      const sortField = this.orderField ?? "_creationTime";
      continueCursor = encodeKeysetCursor({
        sortValue: lastDoc[sortField],
        lastId: lastDoc._id,
        sortField,
        direction: this.orderDirection,
      });
    }

    return {
      page,
      continueCursor,
      isDone: !hasMore,
    };
  }
}

type KeysetCursorV2 = { k: 2; v: unknown; id: string; f: string; d: "asc" | "desc" };

function encodeKeysetCursor(info: KeysetCursorInfo): string {
  return btoa(JSON.stringify({ k: 2, v: info.sortValue, id: info.lastId, f: info.sortField, d: info.direction }));
}

function decodeKeysetCursor(cursor: string): KeysetCursorInfo | null {
  try {
    const parsed = JSON.parse(atob(cursor));
    if (parsed.k !== 2) return null; // v1 offset cursor — treat as restart
    const c = parsed as KeysetCursorV2;
    return { sortValue: c.v, lastId: c.id, sortField: c.f, direction: c.d };
  } catch {
    return null;
  }
}

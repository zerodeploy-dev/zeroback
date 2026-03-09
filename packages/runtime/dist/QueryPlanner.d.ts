import type { FilterExpressionJSON, IndexQueryJSON, KeysetCursorInfo, SchemaJSON, SearchQueryJSON } from "@zeroback/server";
import type { TableColumnInfo } from "./db/SchemaMapper";
import type { SqlApi } from "./types";
export type QueryResult = {
    documentId: string;
    data: unknown;
    ts: number;
};
export declare function queryTable(sql: SqlApi, schemaInfo: SchemaJSON, tableColumns: Map<string, TableColumnInfo>, table: string, asOfTs: number, filter: FilterExpressionJSON | null, indexQuery: IndexQueryJSON | null, orderField: string | null, orderDirection: "asc" | "desc", limit: number | null, keysetCursor?: KeysetCursorInfo | null, searchQuery?: SearchQueryJSON | null): QueryResult[];
//# sourceMappingURL=QueryPlanner.d.ts.map
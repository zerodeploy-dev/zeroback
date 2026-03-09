import type { ValidatorJSON, SchemaJSON } from "@zeroback/server";
import type { SqlApi } from "../types";
export type ColumnInfo = {
    name: string;
    sqlType: string;
    nullable: boolean;
    isJsonColumn: boolean;
    isBoolean: boolean;
};
export type TableColumnInfo = {
    columns: Map<string, ColumnInfo>;
    orderedFieldNames: string[];
};
export declare function validatorToSQLType(validator: ValidatorJSON): {
    sqlType: string;
    nullable: boolean;
    isJsonColumn: boolean;
};
export declare function generateTableDDL(tableName: string, tableInfo: SchemaJSON["tables"][string]): string[];
export declare function generateSearchIndexDDL(tableName: string, searchIndex: {
    name: string;
    searchField: string;
}): string[];
export declare function buildTableColumns(schema: SchemaJSON): Map<string, TableColumnInfo>;
/**
 * Convert a JS document to an array of SQL parameters matching column order:
 * [_id, _ts, ...userFields]
 */
export declare function docToSQLParams(doc: Record<string, unknown>, info: TableColumnInfo, commitTs: number): unknown[];
/**
 * Convert a SQL row object to a JS document.
 * - Booleans: 1/0 → true/false
 * - JSON columns: JSON.parse
 * - Optional fields with null: omit key
 * - Excludes _ts (internal)
 */
export declare function sqlRowToDoc(row: Record<string, unknown>, info: TableColumnInfo): Record<string, unknown>;
export declare function migrateSchema(sql: SqlApi, schema: SchemaJSON): void;
//# sourceMappingURL=SchemaMapper.d.ts.map
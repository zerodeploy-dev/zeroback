import type { FilterExpressionJSON } from "@zeroback/server";
export declare function applyFilter<T>(rows: T[], filter: FilterExpressionJSON | null): T[];
export declare function evaluateFilter<T>(row: T, filter: FilterExpressionJSON): boolean;
export declare function applyOrder<T>(rows: T[], field: string | null, direction: "asc" | "desc"): T[];
export declare function applyLimit<T>(rows: T[], n: number | null): T[];
/**
 * Compile a FilterExpressionJSON to a SQL WHERE clause fragment with
 * parameterized values.
 *
 * - Scalar columns use direct column references.
 * - JSON columns use `json_extract(col, '$')` for top-level access.
 * - Nested paths use `json_extract(col, '$.path')` with parameterized paths.
 * - Array/object literals are wrapped with `json()` to match json_extract output.
 *
 * Falls back to null (JS evaluation) for:
 * - Nested paths on non-JSON columns
 * - Unsafe column names
 */
export declare function compileFilterToSQL(filter: FilterExpressionJSON, jsonColumns?: Set<string>): {
    sql: string;
    params: unknown[];
} | null;
//# sourceMappingURL=FilterEngine.d.ts.map
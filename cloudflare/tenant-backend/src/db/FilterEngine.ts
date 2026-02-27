import type { FilterExpressionJSON, ExprJSON } from "@vex/server";

export function applyFilter<T>(rows: T[], filter: FilterExpressionJSON | null): T[] {
  if (!filter) {
    return rows;
  }

  return rows.filter((row) => evaluateFilter(row, filter));
}

export function evaluateFilter<T>(row: T, filter: FilterExpressionJSON): boolean {
  switch (filter.op) {
    case "eq": {
      const a = evaluateExpr(row, filter.a);
      const b = evaluateExpr(row, filter.b);
      return a === b;
    }
    case "neq": {
      const a = evaluateExpr(row, filter.a);
      const b = evaluateExpr(row, filter.b);
      return a !== b;
    }
    case "lt": {
      const a = evaluateExpr(row, filter.a);
      const b = evaluateExpr(row, filter.b);
      return (a as number) < (b as number);
    }
    case "lte": {
      const a = evaluateExpr(row, filter.a);
      const b = evaluateExpr(row, filter.b);
      return (a as number) <= (b as number);
    }
    case "gt": {
      const a = evaluateExpr(row, filter.a);
      const b = evaluateExpr(row, filter.b);
      return (a as number) > (b as number);
    }
    case "gte": {
      const a = evaluateExpr(row, filter.a);
      const b = evaluateExpr(row, filter.b);
      return (a as number) >= (b as number);
    }
    case "and": {
      return filter.exprs.every((expr) => evaluateFilter(row, expr));
    }
    case "or": {
      return filter.exprs.some((expr) => evaluateFilter(row, expr));
    }
    case "not": {
      return !evaluateFilter(row, filter.expr);
    }
    default:
      return true;
  }
}

function evaluateExpr<T>(row: T, expr: ExprJSON): unknown {
  if (expr.op === "field") {
    const value = getByPath(row, expr.path);
    return value;
  }
  return expr.value;
}

function getByPath(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, part) => acc?.[part], obj);
}

export function applyOrder<T>(
  rows: T[],
  field: string | null,
  direction: "asc" | "desc"
): T[] {
  if (!field) {
    return rows;
  }

  return [...rows].sort((a, b) => {
    const aVal = getByPath(a, field);
    const bVal = getByPath(b, field);

    let cmp = 0;
    if (aVal < bVal) cmp = -1;
    if (aVal > bVal) cmp = 1;

    return direction === "asc" ? cmp : -cmp;
  });
}

export function applyLimit<T>(rows: T[], n: number | null): T[] {
  if (n === null) {
    return rows;
  }
  return rows.slice(0, n);
}

// ---------------------------------------------------------------------------
// Filter → SQL compilation (direct column references)
// ---------------------------------------------------------------------------

/** Safe column name pattern — reject anything that could cause SQL injection. */
const SAFE_COLUMN_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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
export function compileFilterToSQL(
  filter: FilterExpressionJSON,
  jsonColumns?: Set<string>
): { sql: string; params: unknown[] } | null {
  try {
    return compileFilterNode(filter, jsonColumns);
  } catch {
    return null;
  }
}

function compileFilterNode(
  node: FilterExpressionJSON,
  jsonColumns?: Set<string>
): { sql: string; params: unknown[] } {
  switch (node.op) {
    case "eq":
    case "neq":
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const sqlOps: Record<string, string> = {
        eq: "=", neq: "!=", lt: "<", lte: "<=", gt: ">", gte: ">=",
      };
      const left = compileSQLExpr(node.a, jsonColumns);
      const right = compileSQLExpr(node.b, jsonColumns);
      return {
        sql: `(${left.sql} ${sqlOps[node.op]} ${right.sql})`,
        params: [...left.params, ...right.params],
      };
    }
    case "and": {
      if (node.exprs.length === 0) return { sql: "1", params: [] };
      const parts = node.exprs.map((e) => compileFilterNode(e, jsonColumns));
      return {
        sql: `(${parts.map((p) => p.sql).join(" AND ")})`,
        params: parts.flatMap((p) => p.params),
      };
    }
    case "or": {
      if (node.exprs.length === 0) return { sql: "0", params: [] };
      const parts = node.exprs.map((e) => compileFilterNode(e, jsonColumns));
      return {
        sql: `(${parts.map((p) => p.sql).join(" OR ")})`,
        params: parts.flatMap((p) => p.params),
      };
    }
    case "not": {
      const inner = compileFilterNode(node.expr, jsonColumns);
      return { sql: `(NOT ${inner.sql})`, params: inner.params };
    }
    default:
      throw new Error("unsupported filter op");
  }
}

function compileSQLExpr(
  expr: ExprJSON,
  jsonColumns?: Set<string>
): { sql: string; params: unknown[] } {
  if (expr.op === "field") {
    if (expr.path.includes(".")) {
      // Nested path: "address.city" → json_extract("address", '$.city')
      const [column, ...rest] = expr.path.split(".");
      if (!SAFE_COLUMN_NAME.test(column)) {
        throw new Error("unsupported: unsafe column name");
      }
      if (!rest.every((p) => SAFE_COLUMN_NAME.test(p))) {
        throw new Error("unsupported: unsafe nested path segment");
      }
      if (!jsonColumns?.has(column)) {
        throw new Error("unsupported: nested path on non-JSON column");
      }
      return { sql: `json_extract("${column}", ?)`, params: ["$." + rest.join(".")] };
    }
    if (jsonColumns?.has(expr.path)) {
      // JSON column top-level access via json_extract
      if (!SAFE_COLUMN_NAME.test(expr.path)) {
        throw new Error("unsupported: unsafe column name");
      }
      return { sql: `json_extract("${expr.path}", '$')`, params: [] };
    }
    // Scalar column (existing behavior)
    if (!SAFE_COLUMN_NAME.test(expr.path)) {
      throw new Error("unsupported: unsafe column name");
    }
    return { sql: `"${expr.path}"`, params: [] };
  }
  // Boolean literal conversion for SQLite INTEGER storage
  if (typeof expr.value === "boolean") {
    return { sql: "?", params: [expr.value ? 1 : 0] };
  }
  // Array/object literals: wrap with json() to match json_extract output type
  if (typeof expr.value === "object" && expr.value !== null) {
    return { sql: "json(?)", params: [JSON.stringify(expr.value)] };
  }
  return { sql: "?", params: [expr.value] };
}

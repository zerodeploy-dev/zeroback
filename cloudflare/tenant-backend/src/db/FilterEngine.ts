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
// Filter → SQL compilation
// ---------------------------------------------------------------------------

/**
 * Compile a FilterExpressionJSON to a SQL WHERE clause fragment with
 * parameterized values. Returns null if the filter can't be compiled
 * (caller should fall back to JS evaluation).
 */
export function compileFilterToSQL(
  filter: FilterExpressionJSON,
  dataCol: string = "data"
): { sql: string; params: unknown[] } | null {
  try {
    return compileFilterNode(filter, dataCol);
  } catch {
    return null;
  }
}

function compileFilterNode(
  node: FilterExpressionJSON,
  dataCol: string
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
      const left = compileSQLExpr(node.a, dataCol);
      const right = compileSQLExpr(node.b, dataCol);
      return {
        sql: `(${left.sql} ${sqlOps[node.op]} ${right.sql})`,
        params: [...left.params, ...right.params],
      };
    }
    case "and": {
      if (node.exprs.length === 0) return { sql: "1", params: [] };
      const parts = node.exprs.map((e) => compileFilterNode(e, dataCol));
      return {
        sql: `(${parts.map((p) => p.sql).join(" AND ")})`,
        params: parts.flatMap((p) => p.params),
      };
    }
    case "or": {
      if (node.exprs.length === 0) return { sql: "0", params: [] };
      const parts = node.exprs.map((e) => compileFilterNode(e, dataCol));
      return {
        sql: `(${parts.map((p) => p.sql).join(" OR ")})`,
        params: parts.flatMap((p) => p.params),
      };
    }
    case "not": {
      const inner = compileFilterNode(node.expr, dataCol);
      return { sql: `(NOT ${inner.sql})`, params: inner.params };
    }
    default:
      throw new Error("unsupported filter op");
  }
}

function compileSQLExpr(
  expr: ExprJSON,
  dataCol: string
): { sql: string; params: unknown[] } {
  if (expr.op === "field") {
    return { sql: `json_extract(${dataCol}, ?)`, params: [`$.${expr.path}`] };
  }
  return { sql: "?", params: [expr.value] };
}

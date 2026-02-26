import type { FilterExpressionJSON, ExprJSON } from "../types.js";

type ExpressionOrValue = Expression | string | number | boolean | null;

function toExpr(v: ExpressionOrValue): Expression {
  if (v instanceof Expression) return v;
  return Expression.literal(v);
}

export class FilterBuilder<Doc> {
  field<K extends keyof Doc>(key: K): Expression {
    return new Expression(String(key));
  }

  eq(a: ExpressionOrValue, b: ExpressionOrValue): FilterExpression {
    return new FilterExpression({ op: "eq", a: toExpr(a).toJSON(), b: toExpr(b).toJSON() });
  }

  neq(a: ExpressionOrValue, b: ExpressionOrValue): FilterExpression {
    return new FilterExpression({ op: "neq", a: toExpr(a).toJSON(), b: toExpr(b).toJSON() });
  }

  lt(a: ExpressionOrValue, b: ExpressionOrValue): FilterExpression {
    return new FilterExpression({ op: "lt", a: toExpr(a).toJSON(), b: toExpr(b).toJSON() });
  }

  lte(a: ExpressionOrValue, b: ExpressionOrValue): FilterExpression {
    return new FilterExpression({ op: "lte", a: toExpr(a).toJSON(), b: toExpr(b).toJSON() });
  }

  gt(a: ExpressionOrValue, b: ExpressionOrValue): FilterExpression {
    return new FilterExpression({ op: "gt", a: toExpr(a).toJSON(), b: toExpr(b).toJSON() });
  }

  gte(a: ExpressionOrValue, b: ExpressionOrValue): FilterExpression {
    return new FilterExpression({ op: "gte", a: toExpr(a).toJSON(), b: toExpr(b).toJSON() });
  }

  and(...exprs: FilterExpression[]): FilterExpression {
    return new FilterExpression({ op: "and", exprs: exprs.map((e) => e.toJSON()) });
  }

  or(...exprs: FilterExpression[]): FilterExpression {
    return new FilterExpression({ op: "or", exprs: exprs.map((e) => e.toJSON()) });
  }

  not(expr: FilterExpression): FilterExpression {
    return new FilterExpression({ op: "not", expr: expr.toJSON() });
  }
}

export class Expression {
  private _isLiteral = false;
  private _value: unknown;

  constructor(private path: string) {}

  toJSON(): ExprJSON {
    if (this._isLiteral) {
      return { op: "literal", value: this._value };
    }
    return { op: "field", path: this.path };
  }

  static literal(value: unknown): Expression {
    const expr = new Expression("");
    expr._isLiteral = true;
    expr._value = value;
    return expr;
  }
}

export class FilterExpression {
  constructor(private json: FilterExpressionJSON) {}

  toJSON(): FilterExpressionJSON {
    return this.json;
  }
}

export function field<Doc, K extends keyof Doc>(key: K): Expression {
  return new Expression(String(key));
}

export function literal(value: unknown): Expression {
  return Expression.literal(value);
}

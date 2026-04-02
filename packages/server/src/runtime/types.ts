import type { ValidatorJSON } from "@zeroback/values"
import type { HttpActionHandler } from "@zeroback/server"

/** Cloudflare Durable Object SQLite API surface used by the runtime. */
export type SqlApi = {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
};

export type FunctionDef = {
  type: "query" | "mutation" | "action";
  isInternal: boolean;
  handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  argsValidator?: Record<string, { json: ValidatorJSON }>;
  returnsValidator?: { json: ValidatorJSON };
};

export interface HttpRouterLike {
  lookup(method: string, path: string): HttpActionHandler | null;
}

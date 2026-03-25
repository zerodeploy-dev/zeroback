/** Cloudflare Durable Object SQLite API surface used by the runtime. */
export type SqlApi = {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
};

/** Async SQL API for D1 and other async database backends. */
export type AsyncSqlApi = {
  exec(query: string, ...bindings: unknown[]): Promise<{ toArray(): Record<string, unknown>[] }>;
};

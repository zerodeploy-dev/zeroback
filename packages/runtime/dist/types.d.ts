/** Cloudflare Durable Object SQLite API surface used by the runtime. */
export type SqlApi = {
    exec(query: string, ...bindings: unknown[]): {
        toArray(): Record<string, unknown>[];
    };
};
//# sourceMappingURL=types.d.ts.map
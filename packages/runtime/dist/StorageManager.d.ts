import type { StorageOps } from "@zeroback/server";
import type { SqlApi } from "./types";
export declare class StorageManager {
    private sql;
    private ctx;
    private env;
    private uploadTokens;
    private baseUrl;
    constructor(sql: SqlApi, ctx: {
        id: {
            toString(): string;
        };
    }, env: {
        ZEROBACK_STORAGE?: R2Bucket;
    });
    setBaseUrl(url: string): void;
    getBaseUrl(): string | null;
    private requireR2;
    createStorageOps(): StorageOps;
    handleValidateUpload(url: URL): Response;
    handleStorageRecord(req: Request): Promise<Response>;
    handleStorageDelete(req: Request): Promise<Response>;
    /** Clear all storage metadata and R2 objects (used by dev reset). */
    clearAll(): void;
}
//# sourceMappingURL=StorageManager.d.ts.map
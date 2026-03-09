import type { TableColumnInfo } from "./SchemaMapper";
import type { SqlApi } from "../types";
export declare class DOSQLiteReader {
    private sql;
    private tableColumns;
    constructor(sql: SqlApi, tableColumns: Map<string, TableColumnInfo>);
    getDocument(table: string, documentId: string, asOfTs: number): Promise<{
        data: unknown;
        ts: number;
    } | null>;
    /** Batch-fetch multiple documents in a single SQL round-trip. */
    getDocuments(table: string, documentIds: string[], asOfTs: number): Map<string, {
        data: unknown;
        ts: number;
    }>;
}
//# sourceMappingURL=DOSQLiteReader.d.ts.map
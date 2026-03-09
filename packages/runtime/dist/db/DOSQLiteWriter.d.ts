import type { WriteSetEntry } from "@zeroback/server";
import type { TableColumnInfo } from "./SchemaMapper";
import type { SqlApi } from "../types";
export declare class DOSQLiteWriter {
    private sql;
    private tableColumns;
    constructor(sql: SqlApi, tableColumns: Map<string, TableColumnInfo>);
    commitWrites(writeSet: WriteSetEntry[], commitTs: number): Promise<void>;
}
//# sourceMappingURL=DOSQLiteWriter.d.ts.map
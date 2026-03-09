import { docToSQLParams } from "./SchemaMapper";
import { sqlChunks, sqlRowChunks, sqlPlaceholders } from "./sql-utils";
export class DOSQLiteWriter {
    sql;
    tableColumns;
    constructor(sql, tableColumns) {
        this.sql = sql;
        this.tableColumns = tableColumns;
    }
    async commitWrites(writeSet, commitTs) {
        if (writeSet.length === 0)
            return;
        // Group by table
        const deletesByTable = new Map();
        const upsertsByTable = new Map();
        for (const entry of writeSet) {
            if (entry.data === null) {
                let ids = deletesByTable.get(entry.table);
                if (!ids) {
                    ids = [];
                    deletesByTable.set(entry.table, ids);
                }
                ids.push(entry.documentId);
            }
            else {
                let entries = upsertsByTable.get(entry.table);
                if (!entries) {
                    entries = [];
                    upsertsByTable.set(entry.table, entries);
                }
                entries.push({ doc: entry.data, id: entry.documentId });
            }
        }
        // 1. Batch deletes per table
        for (const [table, ids] of deletesByTable) {
            for (const chunk of sqlChunks(ids)) {
                this.sql.exec(`DELETE FROM "${table}" WHERE _id IN (${sqlPlaceholders(chunk.length)})`, ...chunk);
            }
        }
        // 2. Batch upserts per table
        for (const [table, entries] of upsertsByTable) {
            const info = this.tableColumns.get(table);
            if (!info)
                continue;
            // Column names: _id, _ts, ...userFields
            const colNames = ["_id", "_ts", ...info.orderedFieldNames.map((f) => `"${f}"`)];
            const colList = colNames.join(", ");
            const rowPlaceholder = `(${sqlPlaceholders(colNames.length)})`;
            for (const chunk of sqlRowChunks(entries, colNames.length)) {
                const values = chunk.map(() => rowPlaceholder).join(", ");
                const params = chunk.flatMap((e) => docToSQLParams(e.doc, info, commitTs));
                this.sql.exec(`INSERT OR REPLACE INTO "${table}" (${colList}) VALUES ${values}`, ...params);
            }
        }
    }
}
//# sourceMappingURL=DOSQLiteWriter.js.map
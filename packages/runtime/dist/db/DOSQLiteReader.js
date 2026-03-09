import { sqlRowToDoc } from "./SchemaMapper";
import { sqlChunks, sqlPlaceholders } from "./sql-utils";
export class DOSQLiteReader {
    sql;
    tableColumns;
    constructor(sql, tableColumns) {
        this.sql = sql;
        this.tableColumns = tableColumns;
    }
    async getDocument(table, documentId, asOfTs) {
        const info = this.tableColumns.get(table);
        if (!info)
            return null;
        const results = this.sql.exec(`SELECT * FROM "${table}" WHERE _id = ? AND _ts <= ?`, documentId, asOfTs).toArray();
        const row = results[0];
        if (!row)
            return null;
        return {
            data: sqlRowToDoc(row, info),
            ts: row._ts,
        };
    }
    /** Batch-fetch multiple documents in a single SQL round-trip. */
    getDocuments(table, documentIds, asOfTs) {
        const out = new Map();
        if (documentIds.length === 0)
            return out;
        const info = this.tableColumns.get(table);
        if (!info)
            return out;
        for (const chunk of sqlChunks(documentIds, 1)) {
            const results = this.sql.exec(`SELECT * FROM "${table}" WHERE _ts <= ? AND _id IN (${sqlPlaceholders(chunk.length)})`, asOfTs, ...chunk).toArray();
            for (const row of results) {
                const id = row._id;
                out.set(id, {
                    data: sqlRowToDoc(row, info),
                    ts: row._ts,
                });
            }
        }
        return out;
    }
}
//# sourceMappingURL=DOSQLiteReader.js.map
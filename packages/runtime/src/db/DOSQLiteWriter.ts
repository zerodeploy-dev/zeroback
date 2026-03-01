import type { WriteSetEntry } from "@zeroback/server";
import type { TableColumnInfo } from "./SchemaMapper";
import { docToSQLParams } from "./SchemaMapper";
import { MAX_PARAMS } from "../constants";
import type { SqlApi } from "../types";

export class DOSQLiteWriter {
  private sql: SqlApi;
  private tableColumns: Map<string, TableColumnInfo>;

  constructor(sql: SqlApi, tableColumns: Map<string, TableColumnInfo>) {
    this.sql = sql;
    this.tableColumns = tableColumns;
  }

  async commitWrites(writeSet: WriteSetEntry[], commitTs: number): Promise<void> {
    if (writeSet.length === 0) return;

    // Group by table
    const deletesByTable = new Map<string, string[]>();
    const upsertsByTable = new Map<string, { doc: Record<string, unknown>; id: string }[]>();

    for (const entry of writeSet) {
      if (entry.data === null) {
        let ids = deletesByTable.get(entry.table);
        if (!ids) { ids = []; deletesByTable.set(entry.table, ids); }
        ids.push(entry.documentId);
      } else {
        let entries = upsertsByTable.get(entry.table);
        if (!entries) { entries = []; upsertsByTable.set(entry.table, entries); }
        entries.push({ doc: entry.data as Record<string, unknown>, id: entry.documentId });
      }
    }

    // 1. Batch deletes per table
    for (const [table, ids] of deletesByTable) {
      const chunkSize = MAX_PARAMS;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => "?").join(", ");
        this.sql.exec(
          `DELETE FROM "${table}" WHERE _id IN (${placeholders})`,
          ...chunk
        );
      }
    }

    // 2. Batch upserts per table
    for (const [table, entries] of upsertsByTable) {
      const info = this.tableColumns.get(table);
      if (!info) continue;

      // Column names: _id, _ts, ...userFields
      const colNames = ["_id", "_ts", ...info.orderedFieldNames.map((f) => `"${f}"`)];
      const colList = colNames.join(", ");
      const numColumns = colNames.length;
      const rowPlaceholder = `(${colNames.map(() => "?").join(", ")})`;
      const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / numColumns));

      for (let i = 0; i < entries.length; i += chunkSize) {
        const chunk = entries.slice(i, i + chunkSize);
        const values = chunk.map(() => rowPlaceholder).join(", ");
        const params = chunk.flatMap((e) => docToSQLParams(e.doc, info, commitTs));
        this.sql.exec(
          `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES ${values}`,
          ...params
        );
      }
    }
  }
}

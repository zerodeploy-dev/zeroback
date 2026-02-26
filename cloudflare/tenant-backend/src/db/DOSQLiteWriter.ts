export interface WriteSetEntry {
  table: string;
  documentId: string;
  data: unknown | null;
}

/** Max bound parameters per SQL statement on Cloudflare DO SQLite. */
const MAX_PARAMS = 100;

export class DOSQLiteWriter {
  private sql: any;

  constructor(sql: any) {
    this.sql = sql;
  }

  async commitWrites(writeSet: WriteSetEntry[], commitTs: number): Promise<void> {
    if (writeSet.length === 0) return;

    const now = Date.now();

    // Pre-serialize data once — reuse for both transaction_log and document_index
    const serialized = writeSet.map((e) => ({
      ...e,
      dataJSON: JSON.stringify(e.data),
    }));

    // 1. Batch insert into transaction_log (5 params per row)
    const logColCount = 5;
    const logChunkSize = Math.floor(MAX_PARAMS / logColCount);
    const logRow = "(?, ?, ?, ?, ?)";

    for (let i = 0; i < serialized.length; i += logChunkSize) {
      const chunk = serialized.slice(i, i + logChunkSize);
      const values = chunk.map(() => logRow).join(", ");
      const params = chunk.flatMap((e) => [
        commitTs, e.table, e.documentId, e.dataJSON, now,
      ]);
      this.sql.exec(
        `INSERT INTO transaction_log (ts, table_name, document_id, data, inserted_at) VALUES ${values}`,
        ...params
      );
    }

    // 2. Separate deletes and upserts, group by table
    const deletesByTable = new Map<string, string[]>();
    const upsertsByTable = new Map<string, typeof serialized>();

    for (const entry of serialized) {
      if (entry.data === null) {
        let ids = deletesByTable.get(entry.table);
        if (!ids) { ids = []; deletesByTable.set(entry.table, ids); }
        ids.push(entry.documentId);
      } else {
        let entries = upsertsByTable.get(entry.table);
        if (!entries) { entries = []; upsertsByTable.set(entry.table, entries); }
        entries.push(entry);
      }
    }

    // 3. Batch deletes per table (1 + N params: table + doc IDs)
    for (const [table, ids] of deletesByTable) {
      const chunkSize = MAX_PARAMS - 1; // 1 param for table_name
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => "?").join(", ");
        this.sql.exec(
          `DELETE FROM document_index WHERE table_name = ? AND document_id IN (${placeholders})`,
          table, ...chunk
        );
      }
    }

    // 4. Batch upserts per table (4 params per row)
    const upsertColCount = 4;
    const upsertChunkSize = Math.floor(MAX_PARAMS / upsertColCount);
    const rowPlaceholder = "(?, ?, ?, ?)";

    for (const [_table, entries] of upsertsByTable) {
      for (let i = 0; i < entries.length; i += upsertChunkSize) {
        const chunk = entries.slice(i, i + upsertChunkSize);
        const values = chunk.map(() => rowPlaceholder).join(", ");
        const params = chunk.flatMap((e) => [
          e.table, e.documentId, commitTs, e.dataJSON,
        ]);
        this.sql.exec(
          `INSERT OR REPLACE INTO document_index (table_name, document_id, ts, data) VALUES ${values}`,
          ...params
        );
      }
    }
  }

  /** Delete transaction_log entries older than `keepTs`. */
  pruneTransactionLog(keepTs: number): void {
    this.sql.exec(`DELETE FROM transaction_log WHERE ts < ?`, keepTs);
  }
}

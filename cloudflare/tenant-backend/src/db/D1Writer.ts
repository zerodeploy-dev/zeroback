import type { D1Database } from "@cloudflare/workers-types";

export interface WriteSetEntry {
  table: string;
  documentId: string;
  data: unknown | null;
}

export class D1Writer {
  constructor(private db: D1Database) {}

  async commitWrites(writeSet: WriteSetEntry[], commitTs: number): Promise<void> {
    const statements: D1PreparedStatement[] = [];

    for (const entry of writeSet) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO transaction_log (ts, table_name, document_id, data, inserted_at) VALUES (?, ?, ?, ?, ?)`
          )
          .bind(commitTs, entry.table, entry.documentId, JSON.stringify(entry.data), Date.now())
      );

      if (entry.data === null) {
        statements.push(
          this.db
            .prepare(`DELETE FROM document_index WHERE table_name = ? AND document_id = ?`)
            .bind(entry.table, entry.documentId)
        );
      } else {
        statements.push(
          this.db
            .prepare(
              `INSERT OR REPLACE INTO document_index (table_name, document_id, ts, data) VALUES (?, ?, ?, ?)`
            )
            .bind(entry.table, entry.documentId, commitTs, JSON.stringify(entry.data))
        );
      }
    }

    await this.db.batch(statements);
  }
}

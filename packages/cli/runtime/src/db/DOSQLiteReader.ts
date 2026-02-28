import type { TableColumnInfo } from "./SchemaMapper";
import { sqlRowToDoc } from "./SchemaMapper";

/** Max bound parameters per SQL statement on Cloudflare DO SQLite. */
const MAX_PARAMS = 100;

export class DOSQLiteReader {
  private sql: any;
  private tableColumns: Map<string, TableColumnInfo>;

  constructor(sql: any, tableColumns: Map<string, TableColumnInfo>) {
    this.sql = sql;
    this.tableColumns = tableColumns;
  }

  async getDocument(
    table: string,
    documentId: string,
    asOfTs: number
  ): Promise<{ data: unknown; ts: number } | null> {
    const info = this.tableColumns.get(table);
    if (!info) return null;

    const results = this.sql.exec(
      `SELECT * FROM "${table}" WHERE _id = ? AND _ts <= ?`,
      documentId, asOfTs
    ).toArray() as Record<string, unknown>[];

    const row = results[0];
    if (!row) return null;

    return {
      data: sqlRowToDoc(row, info),
      ts: row._ts as number,
    };
  }

  /** Batch-fetch multiple documents in a single SQL round-trip. */
  getDocuments(
    table: string,
    documentIds: string[],
    asOfTs: number
  ): Map<string, { data: unknown; ts: number }> {
    const out = new Map<string, { data: unknown; ts: number }>();
    if (documentIds.length === 0) return out;

    const info = this.tableColumns.get(table);
    if (!info) return out;

    // Chunk to stay under 100 param limit (1 param for _ts + N ids)
    const chunkSize = MAX_PARAMS - 1;
    for (let i = 0; i < documentIds.length; i += chunkSize) {
      const chunk = documentIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(", ");
      const results = this.sql.exec(
        `SELECT * FROM "${table}" WHERE _ts <= ? AND _id IN (${placeholders})`,
        asOfTs, ...chunk
      ).toArray() as Record<string, unknown>[];

      for (const row of results) {
        const id = row._id as string;
        out.set(id, {
          data: sqlRowToDoc(row, info),
          ts: row._ts as number,
        });
      }
    }

    return out;
  }
}

export interface DocumentRow {
  table_name: string;
  document_id: string;
  ts: number;
  data: string;
}

export class DOSQLiteReader {
  private sql: any;

  constructor(sql: any) {
    this.sql = sql;
  }

  async getDocument(
    table: string,
    documentId: string,
    asOfTs: number
  ): Promise<{ data: unknown; ts: number } | null> {
    // PK is (table_name, document_id) — at most one row per doc
    const results = this.sql.exec(
      `SELECT ts, data FROM document_index
       WHERE table_name = ? AND document_id = ? AND ts <= ?`,
      table, documentId, asOfTs
    ).toArray() as { ts: number; data: string }[];

    const result = results[0];

    if (!result || !result.data) {
      return null;
    }

    return {
      data: JSON.parse(result.data),
      ts: result.ts,
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

    // Chunk to stay under 100 param limit (2 fixed params + N ids)
    const chunkSize = 98; // 100 - 2 (table + asOfTs)
    for (let i = 0; i < documentIds.length; i += chunkSize) {
      const chunk = documentIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(", ");
      const results = this.sql.exec(
        `SELECT document_id, ts, data FROM document_index
         WHERE table_name = ? AND ts <= ? AND document_id IN (${placeholders})`,
        table, asOfTs, ...chunk
      ).toArray() as { document_id: string; ts: number; data: string }[];

      for (const r of results) {
        if (r.data) {
          out.set(r.document_id, { data: JSON.parse(r.data), ts: r.ts });
        }
      }
    }

    return out;
  }
}

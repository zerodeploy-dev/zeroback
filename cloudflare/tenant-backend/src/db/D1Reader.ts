import type { D1Database } from "@cloudflare/workers-types";

export interface DocumentRow {
  table_name: string;
  document_id: string;
  ts: number;
  data: string;
}

export class D1Reader {
  constructor(private db: D1Database) {}

  async getDocument(
    table: string,
    documentId: string,
    asOfTs: number
  ): Promise<{ data: unknown; ts: number } | null> {
    const result = await this.db
      .prepare(
        `SELECT ts, data FROM document_index 
         WHERE table_name = ? AND document_id = ? AND ts <= ? 
         ORDER BY ts DESC LIMIT 1`
      )
      .bind(table, documentId, asOfTs)
      .first<{ ts: number; data: string }>();

    if (!result || !result.data) {
      return null;
    }

    return {
      data: JSON.parse(result.data),
      ts: result.ts,
    };
  }

  async getDocumentsForTable(
    table: string,
    asOfTs: number
  ): Promise<{ documentId: string; data: unknown; ts: number }[]> {
    const result = await this.db
      .prepare(
        `SELECT document_id, ts, data FROM document_index 
         WHERE table_name = ? AND ts <= ? 
         ORDER BY ts DESC`
      )
      .bind(table, asOfTs)
      .all<{ document_id: string; ts: number; data: string }>();

    const docsMap = new Map<string, { documentId: string; data: unknown; ts: number }>();

    for (const row of result.results ?? []) {
      if (!docsMap.has(row.document_id)) {
        docsMap.set(row.document_id, {
          documentId: row.document_id,
          data: row.data ? JSON.parse(row.data) : null,
          ts: row.ts,
        });
      }
    }

    return Array.from(docsMap.values());
  }
}

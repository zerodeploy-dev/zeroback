import type { TableColumnInfo } from "./SchemaMapper"
import { sqlRowToDoc } from "./SchemaMapper"
import { sqlChunks, sqlPlaceholders } from "./sql-utils"
import type { AsyncSqlApi } from "../types"

export class D1Reader {
  private sql: AsyncSqlApi
  private tableColumns: Map<string, TableColumnInfo>

  constructor(sql: AsyncSqlApi, tableColumns: Map<string, TableColumnInfo>) {
    this.sql = sql
    this.tableColumns = tableColumns
  }

  async getDocument(
    table: string,
    documentId: string,
    asOfTs: number
  ): Promise<{ data: unknown; ts: number } | null> {
    const info = this.tableColumns.get(table)
    if (!info) return null

    const results = (await this.sql.exec(
      `SELECT * FROM "${table}" WHERE _id = ? AND _ts <= ?`,
      documentId, asOfTs
    )).toArray() as Record<string, unknown>[]

    const row = results[0]
    if (!row) return null

    return {
      data: sqlRowToDoc(row, info),
      ts: row._ts as number,
    }
  }

  /** Batch-fetch multiple documents in a single SQL round-trip. */
  async getDocuments(
    table: string,
    documentIds: string[],
    asOfTs: number
  ): Promise<Map<string, { data: unknown; ts: number }>> {
    const out = new Map<string, { data: unknown; ts: number }>()
    if (documentIds.length === 0) return out

    const info = this.tableColumns.get(table)
    if (!info) return out

    for (const chunk of sqlChunks(documentIds, 1)) {
      const results = (await this.sql.exec(
        `SELECT * FROM "${table}" WHERE _ts <= ? AND _id IN (${sqlPlaceholders(chunk.length)})`,
        asOfTs, ...chunk
      )).toArray() as Record<string, unknown>[]

      for (const row of results) {
        const id = row._id as string
        out.set(id, {
          data: sqlRowToDoc(row, info),
          ts: row._ts as number,
        })
      }
    }

    return out
  }
}

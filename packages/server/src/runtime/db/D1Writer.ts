import type { WriteSetEntry } from "@zeroback/server"
import type { TableColumnInfo } from "./SchemaMapper"
import { docToSQLParams } from "./SchemaMapper"
import { sqlRowChunks, sqlPlaceholders } from "./sql-utils"
import type { D1Database, D1PreparedStatement } from "./D1Adapter"

/**
 * D1 writer that collects all writes and commits them atomically via db.batch().
 * Unlike DOSQLiteWriter which executes SQL synchronously, this collects prepared
 * statements and submits them as a single atomic batch.
 */
export class D1Writer {
  private db: D1Database
  private tableColumns: Map<string, TableColumnInfo>

  constructor(db: D1Database, tableColumns: Map<string, TableColumnInfo>) {
    this.db = db
    this.tableColumns = tableColumns
  }

  async commitWrites(writeSet: WriteSetEntry[], commitTs: number): Promise<void> {
    if (writeSet.length === 0) return

    const statements: D1PreparedStatement[] = []

    // Group by table
    const deletesByTable = new Map<string, string[]>()
    const upsertsByTable = new Map<string, { doc: Record<string, unknown>; id: string }[]>()

    for (const entry of writeSet) {
      if (entry.data === null) {
        let ids = deletesByTable.get(entry.table)
        if (!ids) { ids = []; deletesByTable.set(entry.table, ids) }
        ids.push(entry.documentId)
      } else {
        let entries = upsertsByTable.get(entry.table)
        if (!entries) { entries = []; upsertsByTable.set(entry.table, entries) }
        entries.push({ doc: entry.data as Record<string, unknown>, id: entry.documentId })
      }
    }

    // 1. Batch deletes per table
    for (const [table, ids] of deletesByTable) {
      // D1 has a 100-parameter limit per statement, so chunk if needed
      const chunkSize = 100
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize)
        statements.push(
          this.db.prepare(
            `DELETE FROM "${table}" WHERE _id IN (${sqlPlaceholders(chunk.length)})`
          ).bind(...chunk)
        )
      }
    }

    // 2. Batch upserts per table
    for (const [table, entries] of upsertsByTable) {
      const info = this.tableColumns.get(table)
      if (!info) continue

      const colNames = ["_id", "_ts", ...info.orderedFieldNames.map((f) => `"${f}"`)]
      const colList = colNames.join(", ")
      const rowPlaceholder = `(${sqlPlaceholders(colNames.length)})`

      for (const chunk of sqlRowChunks(entries, colNames.length)) {
        const values = chunk.map(() => rowPlaceholder).join(", ")
        const params = chunk.flatMap((e) => docToSQLParams(e.doc, info, commitTs))
        statements.push(
          this.db.prepare(
            `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES ${values}`
          ).bind(...params)
        )
      }
    }

    // Execute all statements as an atomic transaction
    if (statements.length > 0) {
      await this.db.batch(statements)
    }
  }
}

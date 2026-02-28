import type { D1Database } from "@cloudflare/workers-types";
import type { ReadSetEntry } from "@zeroback/server";

export async function checkConflicts(
  db: D1Database,
  readSet: ReadSetEntry[],
  beginTs: number
): Promise<boolean> {
  if (readSet.length === 0) {
    return false;
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const entry of readSet) {
    conditions.push(`(table_name = ? AND document_id = ? AND ts > ?)`);
    params.push(entry.table, entry.documentId, beginTs);
  }

  const query = `
    SELECT COUNT(*) as count FROM document_index
    WHERE ${conditions.join(" OR ")}
  `;

  const result = await db.prepare(query).bind(...params).first<{ count: number }>();

  return (result?.count ?? 0) > 0;
}

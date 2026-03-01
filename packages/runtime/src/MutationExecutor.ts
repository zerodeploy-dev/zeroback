import type { ReadSetEntry, FilterExpressionJSON } from "@zeroback/server";
import type { TransactionStore } from "./transaction/TransactionStore";
import type { QueryDescriptor } from "./transaction/TransactionStore";
import type { SubscriptionManager } from "./subscriptions/SubscriptionManager";
import type { DOSQLiteReader } from "./db/DOSQLiteReader";
import type { DOSQLiteWriter } from "./db/DOSQLiteWriter";
import { sqlChunks, sqlPlaceholders } from "./db/sql-utils";
import type { SqlApi } from "./types";

export type InvokeResult = {
  result: unknown;
  readSet: ReadSetEntry[];
  queryDescriptors: QueryDescriptor[];
};

export type MutationDeps = {
  transactions: TransactionStore;
  subscriptions: SubscriptionManager;
  reader: DOSQLiteReader;
  writer: DOSQLiteWriter;
  sql: SqlApi;
  getLatestTs: () => number;
  setLatestTs: (ts: number) => void;
  saveLatestTs: () => Promise<void>;
  invokeFunction: (fnName: string, args: unknown, txId: string) => Promise<InvokeResult>;
};

const MAX_OCC_RETRIES = 5;

function occBackoff(attempt: number): Promise<void> {
  const baseMs = 10;
  const capMs = 500;
  const delay = Math.random() * Math.min(baseMs * 2 ** attempt, capMs);
  return new Promise((r) => setTimeout(r, delay));
}

/**
 * Execute a mutation with full OCC retry, conflict detection, commit, and subscription invalidation.
 * Used by both WebSocket-initiated mutations and action-initiated runMutation.
 */
export async function executeMutation(
  deps: MutationDeps,
  fnName: string,
  args: unknown,
): Promise<unknown> {
  for (let attempt = 0; attempt <= MAX_OCC_RETRIES; attempt++) {
    const txId = crypto.randomUUID();
    deps.transactions.begin(txId, deps.getLatestTs(), "mutation");

    try {
      const result = await deps.invokeFunction(fnName, args, txId);

      const mutationTx = deps.transactions.get(txId);
      const writeSet = mutationTx ? [...mutationTx.writeSet] : [];
      const readSet = mutationTx ? [...mutationTx.readSet] : [];

      // OCC: check for conflicts before committing
      if (readSet.length > 0) {
        const hasConflicts = checkConflicts(deps.sql, readSet, mutationTx!.beginTs);
        if (hasConflicts) {
          deps.transactions.remove(txId);
          if (attempt < MAX_OCC_RETRIES) {
            await occBackoff(attempt);
            continue;
          }
          throw new Error("Transaction conflict — max retries exceeded");
        }
      }

      // 1. Enrich deletes with old data (before commit removes them)
      const enrichedWriteSet: { table: string; documentId: string; data: unknown | null; oldData?: unknown }[] = [];
      for (const entry of writeSet) {
        if (entry.data === null) {
          const old = await deps.reader.getDocument(entry.table, entry.documentId, deps.getLatestTs());
          enrichedWriteSet.push({ ...entry, oldData: old?.data ?? undefined });
        } else {
          enrichedWriteSet.push(entry);
        }
      }

      // 2. Commit writes
      if (writeSet.length > 0) {
        const commitTs = deps.getLatestTs() + 1;
        deps.setLatestTs(commitTs);
        await deps.saveLatestTs();
        await deps.writer.commitWrites(writeSet, commitTs);
      }

      deps.transactions.remove(txId);

      // 3. Invalidate affected subscriptions
      if (writeSet.length > 0) {
        await deps.subscriptions.invalidate(enrichedWriteSet, async (fn, a) => {
          const subTxId = crypto.randomUUID();
          deps.transactions.begin(subTxId, deps.getLatestTs(), "query");
          try {
            return await deps.invokeFunction(fn, a, subTxId);
          } finally {
            deps.transactions.remove(subTxId);
          }
        });
      }

      return result.result;
    } catch (e) {
      deps.transactions.remove(txId);
      throw e;
    }
  }
}

/** Check if any document in the read set was modified after beginTs. */
function checkConflicts(
  sql: SqlApi,
  readSet: { table: string; documentId: string; ts: number }[],
  beginTs: number
): boolean {
  if (readSet.length === 0) return false;

  // Group reads by table
  const byTable = new Map<string, string[]>();
  for (const entry of readSet) {
    let ids = byTable.get(entry.table);
    if (!ids) { ids = []; byTable.set(entry.table, ids); }
    ids.push(entry.documentId);
  }

  for (const [table, ids] of byTable) {
    for (const chunk of sqlChunks(ids, 1)) {
      const results = sql.exec(
        `SELECT 1 FROM "${table}" WHERE _ts > ? AND _id IN (${sqlPlaceholders(chunk.length)}) LIMIT 1`,
        beginTs, ...chunk
      ).toArray();
      if (results.length > 0) return true;
    }
  }

  return false;
}

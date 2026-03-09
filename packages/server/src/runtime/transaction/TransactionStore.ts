import type { ReadSetEntry, WriteSetEntry, FilterExpressionJSON } from "../../types.js";

export type TransactionMode = "query" | "mutation";

export interface QueryDescriptor {
  table: string;
  filter: FilterExpressionJSON | null;
}

export interface TransactionState {
  txId: string;
  beginTs: number;
  readSet: ReadSetEntry[];
  writeSet: WriteSetEntry[];
  queryDescriptors: QueryDescriptor[];
  mode: TransactionMode;
  committed: boolean;
  aborted: boolean;
}

export class TransactionStore {
  private transactions = new Map<string, TransactionState>();

  begin(txId: string, beginTs: number, mode: TransactionMode): TransactionState {
    const tx: TransactionState = {
      txId,
      beginTs,
      readSet: [],
      writeSet: [],
      queryDescriptors: [],
      mode,
      committed: false,
      aborted: false,
    };
    this.transactions.set(txId, tx);
    return tx;
  }

  get(txId: string): TransactionState | undefined {
    return this.transactions.get(txId);
  }

  addRead(txId: string, entry: ReadSetEntry): void {
    const tx = this.transactions.get(txId);
    if (!tx) return;

    const exists = tx.readSet.some(
      (r) => r.table === entry.table && r.documentId === entry.documentId
    );
    if (!exists) {
      tx.readSet.push(entry);
    }
  }

  addQueryDescriptor(txId: string, descriptor: QueryDescriptor): void {
    const tx = this.transactions.get(txId);
    if (!tx) return;
    tx.queryDescriptors.push(descriptor);
  }

  addWrite(txId: string, entry: WriteSetEntry): void {
    const tx = this.transactions.get(txId);
    if (!tx) return;

    const idx = tx.writeSet.findIndex(
      (w) => w.table === entry.table && w.documentId === entry.documentId
    );
    if (idx >= 0) {
      tx.writeSet[idx] = entry;
    } else {
      tx.writeSet.push(entry);
    }
  }

  commit(txId: string): void {
    const tx = this.transactions.get(txId);
    if (tx) {
      tx.committed = true;
    }
  }

  abort(txId: string): void {
    const tx = this.transactions.get(txId);
    if (tx) {
      tx.aborted = true;
    }
  }

  remove(txId: string): void {
    this.transactions.delete(txId);
  }
}

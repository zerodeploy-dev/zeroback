export class TransactionStore {
    transactions = new Map();
    begin(txId, beginTs, mode) {
        const tx = {
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
    get(txId) {
        return this.transactions.get(txId);
    }
    addRead(txId, entry) {
        const tx = this.transactions.get(txId);
        if (!tx)
            return;
        const exists = tx.readSet.some((r) => r.table === entry.table && r.documentId === entry.documentId);
        if (!exists) {
            tx.readSet.push(entry);
        }
    }
    addQueryDescriptor(txId, descriptor) {
        const tx = this.transactions.get(txId);
        if (!tx)
            return;
        tx.queryDescriptors.push(descriptor);
    }
    addWrite(txId, entry) {
        const tx = this.transactions.get(txId);
        if (!tx)
            return;
        const idx = tx.writeSet.findIndex((w) => w.table === entry.table && w.documentId === entry.documentId);
        if (idx >= 0) {
            tx.writeSet[idx] = entry;
        }
        else {
            tx.writeSet.push(entry);
        }
    }
    commit(txId) {
        const tx = this.transactions.get(txId);
        if (tx) {
            tx.committed = true;
        }
    }
    abort(txId) {
        const tx = this.transactions.get(txId);
        if (tx) {
            tx.aborted = true;
        }
    }
    remove(txId) {
        this.transactions.delete(txId);
    }
}
//# sourceMappingURL=TransactionStore.js.map
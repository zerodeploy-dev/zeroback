import type { ReadSetEntry, WriteSetEntry, FilterExpressionJSON } from "@zeroback/server";
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
export declare class TransactionStore {
    private transactions;
    begin(txId: string, beginTs: number, mode: TransactionMode): TransactionState;
    get(txId: string): TransactionState | undefined;
    addRead(txId: string, entry: ReadSetEntry): void;
    addQueryDescriptor(txId: string, descriptor: QueryDescriptor): void;
    addWrite(txId: string, entry: WriteSetEntry): void;
    commit(txId: string): void;
    abort(txId: string): void;
    remove(txId: string): void;
}
//# sourceMappingURL=TransactionStore.d.ts.map
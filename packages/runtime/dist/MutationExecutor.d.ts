import type { ReadSetEntry } from "@zeroback/server";
import type { TransactionStore } from "./transaction/TransactionStore";
import type { QueryDescriptor } from "./transaction/TransactionStore";
import type { SubscriptionManager } from "./subscriptions/SubscriptionManager";
import type { DOSQLiteReader } from "./db/DOSQLiteReader";
import type { DOSQLiteWriter } from "./db/DOSQLiteWriter";
import type { SqlApi } from "./types";
export type InvokeResult = {
    result: unknown;
    readSet: ReadSetEntry[];
    queryDescriptors: QueryDescriptor[];
};
export type MutationLock = <T>(fn: () => Promise<T>) => Promise<T>;
export declare function createMutationLock(): MutationLock;
export type MutationDeps = {
    transactions: TransactionStore;
    subscriptions: SubscriptionManager;
    reader: DOSQLiteReader;
    writer: DOSQLiteWriter;
    sql: SqlApi;
    lock: MutationLock;
    getLatestTs: () => number;
    setLatestTs: (ts: number) => void;
    saveLatestTs: () => Promise<void>;
    invokeFunction: (fnName: string, args: unknown, txId: string) => Promise<InvokeResult>;
};
/**
 * Execute a mutation with full OCC retry, conflict detection, commit, and subscription invalidation.
 * Used by both WebSocket-initiated mutations and action-initiated runMutation.
 */
export declare function executeMutation(deps: MutationDeps, fnName: string, args: unknown): Promise<unknown>;
//# sourceMappingURL=MutationExecutor.d.ts.map
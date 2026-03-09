import type { ReadSetEntry } from "@zeroback/server";
import type { QueryDescriptor } from "../transaction/TransactionStore";
export interface Subscription {
    id: string;
    connectionId: string;
    ws: WebSocket;
    fnName: string;
    args: unknown;
    readSet: ReadSetEntry[];
    queryDescriptors: QueryDescriptor[];
    /** Pre-serialized JSON of the last result (for fast comparison + reuse in sends). */
    lastResultJSON: string;
}
export declare class SubscriptionManager {
    private subs;
    /** Table → set of subscription IDs that touch that table */
    private tableIndex;
    subscribe(sub: Subscription): void;
    get(id: string): Subscription | undefined;
    remove(id: string): void;
    clearAll(): void;
    removeAll(ws: WebSocket): void;
    invalidate(writeSet: {
        table: string;
        documentId: string;
        data: unknown | null;
        oldData?: unknown;
    }[], invokeFunction: (fnName: string, args: unknown) => Promise<{
        result: unknown;
        readSet: ReadSetEntry[];
        queryDescriptors: QueryDescriptor[];
    }>): Promise<void>;
    invalidateAll(invokeFunction: (fnName: string, args: unknown) => Promise<{
        result: unknown;
        readSet: ReadSetEntry[];
        queryDescriptors: QueryDescriptor[];
    }>): Promise<void>;
    /**
     * Shared invalidation logic: group subscriptions by (fnName, args),
     * re-execute each unique query in parallel, and flush WS sends.
     * When alwaysSend is false, only sends when the result has changed.
     */
    private rerunAndFlush;
    getAll(): Subscription[];
    private indexSubscription;
    private deindexSubscription;
}
//# sourceMappingURL=SubscriptionManager.d.ts.map
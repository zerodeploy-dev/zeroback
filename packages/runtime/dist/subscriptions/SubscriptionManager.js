import { evaluateFilter } from "../db/FilterEngine";
export class SubscriptionManager {
    subs = new Map();
    /** Table → set of subscription IDs that touch that table */
    tableIndex = new Map();
    subscribe(sub) {
        this.subs.set(sub.id, sub);
        this.indexSubscription(sub);
    }
    get(id) {
        return this.subs.get(id);
    }
    remove(id) {
        const sub = this.subs.get(id);
        if (sub)
            this.deindexSubscription(sub);
        this.subs.delete(id);
    }
    clearAll() {
        this.subs.clear();
        this.tableIndex.clear();
    }
    removeAll(ws) {
        for (const [id, sub] of this.subs.entries()) {
            if (sub.ws === ws) {
                this.deindexSubscription(sub);
                this.subs.delete(id);
            }
        }
    }
    async invalidate(writeSet, invokeFunction) {
        // 1. Use table index to find candidate subscriptions (fast)
        const candidateIds = new Set();
        const writtenTables = new Set();
        for (const w of writeSet) {
            writtenTables.add(w.table);
        }
        for (const table of writtenTables) {
            const ids = this.tableIndex.get(table);
            if (ids) {
                for (const id of ids)
                    candidateIds.add(id);
            }
        }
        // 2. Filter candidates by full overlap check
        const affected = [];
        for (const id of candidateIds) {
            const sub = this.subs.get(id);
            if (sub && overlaps(sub.readSet, sub.queryDescriptors, writeSet)) {
                affected.push(sub);
            }
        }
        if (affected.length === 0)
            return;
        await this.rerunAndFlush(affected, invokeFunction, false);
    }
    async invalidateAll(invokeFunction) {
        await this.rerunAndFlush(this.subs.values(), invokeFunction, true);
    }
    /**
     * Shared invalidation logic: group subscriptions by (fnName, args),
     * re-execute each unique query in parallel, and flush WS sends.
     * When alwaysSend is false, only sends when the result has changed.
     */
    async rerunAndFlush(subscriptions, invokeFunction, alwaysSend) {
        const groups = new Map();
        for (const sub of subscriptions) {
            const key = sub.fnName + "\0" + stableStringify(sub.args);
            let group = groups.get(key);
            if (!group) {
                group = [];
                groups.set(key, group);
            }
            group.push(sub);
        }
        const pendingSends = [];
        const executions = Array.from(groups.entries()).map(async ([_key, subs]) => {
            const representative = subs[0];
            try {
                const newResult = await invokeFunction(representative.fnName, representative.args);
                const newResultJSON = JSON.stringify(newResult.result);
                for (const sub of subs) {
                    this.deindexSubscription(sub);
                    sub.readSet = newResult.readSet;
                    sub.queryDescriptors = newResult.queryDescriptors;
                    this.indexSubscription(sub);
                    if (alwaysSend || newResultJSON !== sub.lastResultJSON) {
                        sub.lastResultJSON = newResultJSON;
                        pendingSends.push({ ws: sub.ws, id: sub.id, resultJSON: newResultJSON });
                    }
                }
            }
            catch (e) {
                console.error("Failed to re-run subscription:", e);
            }
        });
        await Promise.allSettled(executions);
        flushSends(pendingSends);
    }
    getAll() {
        return Array.from(this.subs.values());
    }
    // -- Table index maintenance --
    indexSubscription(sub) {
        const tables = tablesForSubscription(sub);
        for (const table of tables) {
            let set = this.tableIndex.get(table);
            if (!set) {
                set = new Set();
                this.tableIndex.set(table, set);
            }
            set.add(sub.id);
        }
    }
    deindexSubscription(sub) {
        const tables = tablesForSubscription(sub);
        for (const table of tables) {
            const set = this.tableIndex.get(table);
            if (set) {
                set.delete(sub.id);
                if (set.size === 0)
                    this.tableIndex.delete(table);
            }
        }
    }
}
/** Collect all table names a subscription touches (from readSet + queryDescriptors). */
function tablesForSubscription(sub) {
    const tables = new Set();
    for (const r of sub.readSet)
        tables.add(r.table);
    for (const qd of sub.queryDescriptors)
        tables.add(qd.table);
    return tables;
}
function overlaps(readSet, queryDescriptors, writeSet) {
    const readDocIds = new Set(readSet.map((r) => `${r.table}:${r.documentId}`));
    for (const write of writeSet) {
        if (readDocIds.has(`${write.table}:${write.documentId}`)) {
            return true;
        }
        for (const qd of queryDescriptors) {
            if (qd.table !== write.table)
                continue;
            if (qd.filter === null)
                return true;
            if (write.data === null) {
                if (write.oldData != null) {
                    if (evaluateFilter(write.oldData, qd.filter))
                        return true;
                }
                else {
                    return true;
                }
                continue;
            }
            if (evaluateFilter(write.data, qd.filter))
                return true;
        }
    }
    return false;
}
/**
 * Group pending sends by WebSocket and emit one frame per connection.
 * Single update → regular "update" message.
 * Multiple updates → batched "updates" message (one WS frame).
 */
function flushSends(sends) {
    if (sends.length === 0)
        return;
    const byWs = new Map();
    for (const s of sends) {
        let list = byWs.get(s.ws);
        if (!list) {
            list = [];
            byWs.set(s.ws, list);
        }
        list.push(s);
    }
    for (const [ws, items] of byWs) {
        if (items.length === 1) {
            ws.send(`{"type":"update","id":${JSON.stringify(items[0].id)},"result":${items[0].resultJSON}}`);
        }
        else {
            const itemsJSON = items
                .map((i) => `{"id":${JSON.stringify(i.id)},"result":${i.resultJSON}}`)
                .join(",");
            ws.send(`{"type":"updates","items":[${itemsJSON}]}`);
        }
    }
}
/** Deterministic JSON stringify for use as Map key. */
function stableStringify(value) {
    if (value === null || value === undefined)
        return String(value);
    if (typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return "[" + value.map(stableStringify).join(",") + "]";
    }
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}
//# sourceMappingURL=SubscriptionManager.js.map
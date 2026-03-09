import { describe, it, expect, vi } from "vitest";
import { SubscriptionManager } from "./SubscriptionManager";
function makeWs() {
    const sent = [];
    return {
        sent,
        send: vi.fn((msg) => sent.push(msg)),
        close: vi.fn(),
    };
}
function makeSub(overrides = {}) {
    return {
        id: "sub-1",
        connectionId: "conn-1",
        ws: makeWs(),
        fnName: "api:tasks:list",
        args: {},
        readSet: [],
        queryDescriptors: [],
        lastResultJSON: "[]",
        ...overrides,
    };
}
describe("SubscriptionManager", () => {
    describe("subscribe() and get()", () => {
        it("stores and retrieves subscription", () => {
            const sm = new SubscriptionManager();
            const sub = makeSub();
            sm.subscribe(sub);
            expect(sm.get("sub-1")).toBe(sub);
        });
    });
    describe("remove()", () => {
        it("removes subscription", () => {
            const sm = new SubscriptionManager();
            sm.subscribe(makeSub());
            sm.remove("sub-1");
            expect(sm.get("sub-1")).toBeUndefined();
        });
        it("no-ops for unknown id", () => {
            const sm = new SubscriptionManager();
            sm.remove("unknown"); // no error
        });
    });
    describe("clearAll()", () => {
        it("removes all subscriptions", () => {
            const sm = new SubscriptionManager();
            sm.subscribe(makeSub({ id: "a" }));
            sm.subscribe(makeSub({ id: "b" }));
            sm.clearAll();
            expect(sm.getAll()).toHaveLength(0);
        });
    });
    describe("removeAll(ws)", () => {
        it("removes all subscriptions for a specific WebSocket", () => {
            const sm = new SubscriptionManager();
            const ws1 = makeWs();
            const ws2 = makeWs();
            sm.subscribe(makeSub({ id: "a", ws: ws1 }));
            sm.subscribe(makeSub({ id: "b", ws: ws1 }));
            sm.subscribe(makeSub({ id: "c", ws: ws2 }));
            sm.removeAll(ws1);
            expect(sm.getAll()).toHaveLength(1);
            expect(sm.get("c")).toBeDefined();
        });
    });
    describe("getAll()", () => {
        it("returns all subscriptions", () => {
            const sm = new SubscriptionManager();
            sm.subscribe(makeSub({ id: "a" }));
            sm.subscribe(makeSub({ id: "b" }));
            expect(sm.getAll()).toHaveLength(2);
        });
        it("returns empty array when none", () => {
            expect(new SubscriptionManager().getAll()).toEqual([]);
        });
    });
    describe("invalidate()", () => {
        it("re-runs affected subscriptions and sends updates", async () => {
            const sm = new SubscriptionManager();
            const ws = makeWs();
            sm.subscribe(makeSub({
                id: "sub-1",
                ws,
                fnName: "api:tasks:list",
                readSet: [{ table: "tasks", documentId: "tasks:1", ts: 10 }],
                queryDescriptors: [],
                lastResultJSON: "[1]",
            }));
            const invokeFunction = vi.fn().mockResolvedValue({
                result: [1, 2],
                readSet: [{ table: "tasks", documentId: "tasks:1", ts: 20 }],
                queryDescriptors: [],
            });
            await sm.invalidate([{ table: "tasks", documentId: "tasks:1", data: { _id: "tasks:1" } }], invokeFunction);
            expect(invokeFunction).toHaveBeenCalledWith("api:tasks:list", {});
            expect(ws.sent).toHaveLength(1);
            const msg = JSON.parse(ws.sent[0]);
            expect(msg.type).toBe("update");
            expect(msg.result).toEqual([1, 2]);
        });
        it("skips unaffected subscriptions", async () => {
            const sm = new SubscriptionManager();
            const ws = makeWs();
            sm.subscribe(makeSub({
                id: "sub-1",
                ws,
                readSet: [{ table: "users", documentId: "users:1", ts: 10 }],
                queryDescriptors: [],
            }));
            const invokeFunction = vi.fn();
            await sm.invalidate([{ table: "tasks", documentId: "tasks:1", data: { _id: "tasks:1" } }], invokeFunction);
            expect(invokeFunction).not.toHaveBeenCalled();
        });
        it("does not send when result is unchanged", async () => {
            const sm = new SubscriptionManager();
            const ws = makeWs();
            sm.subscribe(makeSub({
                id: "sub-1",
                ws,
                readSet: [{ table: "tasks", documentId: "tasks:1", ts: 10 }],
                lastResultJSON: "[1]",
            }));
            const invokeFunction = vi.fn().mockResolvedValue({
                result: [1], // same as lastResultJSON
                readSet: [{ table: "tasks", documentId: "tasks:1", ts: 20 }],
                queryDescriptors: [],
            });
            await sm.invalidate([{ table: "tasks", documentId: "tasks:1", data: { _id: "tasks:1" } }], invokeFunction);
            expect(ws.sent).toHaveLength(0);
        });
        it("matches via query descriptors (null filter matches all)", async () => {
            const sm = new SubscriptionManager();
            const ws = makeWs();
            sm.subscribe(makeSub({
                id: "sub-1",
                ws,
                readSet: [],
                queryDescriptors: [{ table: "tasks", filter: null }],
                lastResultJSON: "[]",
            }));
            const invokeFunction = vi.fn().mockResolvedValue({
                result: [{ _id: "tasks:new" }],
                readSet: [],
                queryDescriptors: [{ table: "tasks", filter: null }],
            });
            await sm.invalidate([{ table: "tasks", documentId: "tasks:new", data: { _id: "tasks:new" } }], invokeFunction);
            expect(invokeFunction).toHaveBeenCalled();
        });
        it("matches via query descriptors with filter", async () => {
            const sm = new SubscriptionManager();
            const ws = makeWs();
            sm.subscribe(makeSub({
                id: "sub-1",
                ws,
                readSet: [],
                queryDescriptors: [{ table: "tasks", filter: {
                            op: "eq",
                            a: { op: "field", path: "status" },
                            b: { op: "literal", value: "active" },
                        } }],
                lastResultJSON: "[]",
            }));
            const invokeFunction = vi.fn().mockResolvedValue({
                result: [],
                readSet: [],
                queryDescriptors: [],
            });
            // Matching data
            await sm.invalidate([{ table: "tasks", documentId: "tasks:1", data: { status: "active" } }], invokeFunction);
            expect(invokeFunction).toHaveBeenCalled();
        });
        it("batches multiple updates per WebSocket", async () => {
            const sm = new SubscriptionManager();
            const ws = makeWs();
            sm.subscribe(makeSub({
                id: "sub-1",
                ws,
                fnName: "fn1",
                readSet: [{ table: "tasks", documentId: "tasks:1", ts: 10 }],
                lastResultJSON: '"a"',
            }));
            sm.subscribe(makeSub({
                id: "sub-2",
                ws,
                fnName: "fn2",
                readSet: [{ table: "tasks", documentId: "tasks:1", ts: 10 }],
                lastResultJSON: '"b"',
            }));
            const invokeFunction = vi.fn()
                .mockResolvedValueOnce({ result: "a2", readSet: [], queryDescriptors: [] })
                .mockResolvedValueOnce({ result: "b2", readSet: [], queryDescriptors: [] });
            await sm.invalidate([{ table: "tasks", documentId: "tasks:1", data: {} }], invokeFunction);
            // Should send a single batched "updates" message
            expect(ws.sent).toHaveLength(1);
            const msg = JSON.parse(ws.sent[0]);
            expect(msg.type).toBe("updates");
            expect(msg.items).toHaveLength(2);
        });
    });
    describe("invalidateAll()", () => {
        it("re-runs all subscriptions regardless of overlap", async () => {
            const sm = new SubscriptionManager();
            const ws = makeWs();
            sm.subscribe(makeSub({ id: "sub-1", ws, fnName: "fn1", lastResultJSON: '"old"' }));
            sm.subscribe(makeSub({ id: "sub-2", ws, fnName: "fn2", lastResultJSON: '"old"' }));
            const invokeFunction = vi.fn().mockResolvedValue({
                result: "new",
                readSet: [],
                queryDescriptors: [],
            });
            await sm.invalidateAll(invokeFunction);
            // Both should be re-run (grouped by fnName+args)
            expect(invokeFunction).toHaveBeenCalledTimes(2);
            expect(ws.sent.length).toBeGreaterThanOrEqual(1);
        });
        it("always sends even when result unchanged", async () => {
            const sm = new SubscriptionManager();
            const ws = makeWs();
            sm.subscribe(makeSub({ id: "sub-1", ws, lastResultJSON: '"same"' }));
            const invokeFunction = vi.fn().mockResolvedValue({
                result: "same",
                readSet: [],
                queryDescriptors: [],
            });
            await sm.invalidateAll(invokeFunction);
            expect(ws.sent).toHaveLength(1);
        });
    });
    describe("table index", () => {
        it("uses table index for fast lookup", async () => {
            const sm = new SubscriptionManager();
            // Subscribe to tasks table
            sm.subscribe(makeSub({
                id: "sub-tasks",
                readSet: [{ table: "tasks", documentId: "tasks:1", ts: 10 }],
            }));
            // Subscribe to users table
            sm.subscribe(makeSub({
                id: "sub-users",
                readSet: [{ table: "users", documentId: "users:1", ts: 10 }],
            }));
            const invokeFunction = vi.fn().mockResolvedValue({
                result: [],
                readSet: [],
                queryDescriptors: [],
            });
            // Write to tasks only
            await sm.invalidate([{ table: "tasks", documentId: "tasks:1", data: {} }], invokeFunction);
            // Only the tasks subscription should be re-run
            expect(invokeFunction).toHaveBeenCalledTimes(1);
        });
        it("handles delete with oldData for filter matching", async () => {
            const sm = new SubscriptionManager();
            const ws = makeWs();
            sm.subscribe(makeSub({
                id: "sub-1",
                ws,
                readSet: [],
                queryDescriptors: [{ table: "tasks", filter: {
                            op: "eq",
                            a: { op: "field", path: "status" },
                            b: { op: "literal", value: "active" },
                        } }],
                lastResultJSON: "[]",
            }));
            const invokeFunction = vi.fn().mockResolvedValue({
                result: [],
                readSet: [],
                queryDescriptors: [],
            });
            // Delete with oldData that matches the filter
            await sm.invalidate([{ table: "tasks", documentId: "tasks:1", data: null, oldData: { status: "active" } }], invokeFunction);
            expect(invokeFunction).toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=SubscriptionManager.test.js.map
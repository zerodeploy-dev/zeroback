import { describe, it, expect, vi } from "vitest";
import { QueryStore } from "./QueryStore";
import type { LocalStore } from "./QueryStore";

describe("QueryStore", () => {
  // ---------- makeKey ----------
  describe("makeKey", () => {
    it("creates a stable key from fnName and args", () => {
      expect(QueryStore.makeKey("messages:list", { channel: "general" }))
        .toBe('messages:list|{"channel":"general"}');
    });
    it("handles undefined args", () => {
      expect(QueryStore.makeKey("messages:list", undefined))
        .toBe("messages:list|{}");
    });
    it("handles empty args", () => {
      expect(QueryStore.makeKey("messages:list", {}))
        .toBe("messages:list|{}");
    });
  });

  // ---------- base cache ----------
  describe("base cache (server results)", () => {
    it("stores and retrieves a server result", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("messages:list", { channel: "general" });
      store.setServerResult(key, [{ _id: "1", body: "hi" }]);
      expect(store.getResult(key)).toEqual([{ _id: "1", body: "hi" }]);
    });

    it("returns undefined for unknown key", () => {
      const store = new QueryStore();
      expect(store.getResult("unknown|{}")).toBeUndefined();
    });

    it("notifies listener when result changes", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("messages:list", {});
      const listener = vi.fn();
      store.subscribe(key, listener);

      store.setServerResult(key, [1, 2, 3]);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify when result is deeply equal", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("messages:list", {});
      const listener = vi.fn();

      store.setServerResult(key, [1, 2, 3]);
      store.subscribe(key, listener);

      // Set same value again
      store.setServerResult(key, [1, 2, 3]);
      expect(listener).toHaveBeenCalledTimes(0);
    });

    it("does not notify listeners for a different key", () => {
      const store = new QueryStore();
      const keyA = QueryStore.makeKey("a:fn", {});
      const keyB = QueryStore.makeKey("b:fn", {});
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      store.subscribe(keyA, listenerA);
      store.subscribe(keyB, listenerB);

      store.setServerResult(keyA, "hello");
      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(0);
    });
  });

  // ---------- unsubscribe ----------
  describe("unsubscribe", () => {
    it("stops receiving notifications after unsubscribe", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("fn", {});
      const listener = vi.fn();

      const unsub = store.subscribe(key, listener);
      store.setServerResult(key, "v1");
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      store.setServerResult(key, "v2");
      expect(listener).toHaveBeenCalledTimes(1); // no new call
    });
  });

  // ---------- optimistic layers ----------
  describe("optimistic layers", () => {
    it("applies an optimistic update on top of base", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("messages:list", { channel: "general" });
      store.setServerResult(key, [{ _id: "1", body: "hello" }]);

      store.addLayer("mut-1", (local: LocalStore) => {
        const current = local.getQuery("messages:list", { channel: "general" }) as any[];
        local.setQuery("messages:list", { channel: "general" }, [
          ...current,
          { _id: "temp", body: "optimistic" },
        ]);
      });

      const result = store.getResult(key) as any[];
      expect(result).toHaveLength(2);
      expect(result[1].body).toBe("optimistic");
    });

    it("removes optimistic layer and reverts to base", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("messages:list", { channel: "general" });
      store.setServerResult(key, [{ _id: "1", body: "hello" }]);

      store.addLayer("mut-1", (local: LocalStore) => {
        local.setQuery("messages:list", { channel: "general" }, [
          { _id: "1", body: "hello" },
          { _id: "temp", body: "optimistic" },
        ]);
      });

      expect((store.getResult(key) as any[]).length).toBe(2);

      store.removeLayer("mut-1");
      expect((store.getResult(key) as any[]).length).toBe(1);
    });

    it("notifies on layer add and remove", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("messages:list", {});
      const listener = vi.fn();

      store.setServerResult(key, ["original"]);
      store.subscribe(key, listener);

      store.addLayer("mut-1", (local) => {
        local.setQuery("messages:list", {}, ["optimistic"]);
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(store.getResult(key)).toEqual(["optimistic"]);

      store.removeLayer("mut-1");
      expect(listener).toHaveBeenCalledTimes(2);
      expect(store.getResult(key)).toEqual(["original"]);
    });

    it("stacks multiple layers in order", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("counter", {});
      store.setServerResult(key, 0);

      store.addLayer("mut-1", (local) => {
        const val = local.getQuery("counter", {}) as number;
        local.setQuery("counter", {}, val + 1);
      });
      expect(store.getResult(key)).toBe(1);

      store.addLayer("mut-2", (local) => {
        const val = local.getQuery("counter", {}) as number;
        local.setQuery("counter", {}, val + 1);
      });
      expect(store.getResult(key)).toBe(2);

      // Remove first layer — second layer still reads from base (0), adds 1
      store.removeLayer("mut-1");
      // After removing mut-1, only mut-2 remains. mut-2 was computed when added
      // and its changes map has the value 2. After recompute with only mut-2's
      // stored change, the result is whatever mut-2 stored (2).
      // But wait — layers store snapshot changes, not functions. So mut-2 stored 2.
      // After removing mut-1, base is 0, mut-2 change is 2, result = 2.
      expect(store.getResult(key)).toBe(2);

      store.removeLayer("mut-2");
      expect(store.getResult(key)).toBe(0);
    });

    it("does not add layer when updateFn makes no changes", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("fn", {});
      const listener = vi.fn();
      store.setServerResult(key, "value");
      store.subscribe(key, listener);

      store.addLayer("mut-1", () => {
        // no-op — doesn't call setQuery
      });

      expect(listener).toHaveBeenCalledTimes(0);
    });

    it("only notifies affected keys", () => {
      const store = new QueryStore();
      const keyA = QueryStore.makeKey("a", {});
      const keyB = QueryStore.makeKey("b", {});
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      store.setServerResult(keyA, "a-val");
      store.setServerResult(keyB, "b-val");
      store.subscribe(keyA, listenerA);
      store.subscribe(keyB, listenerB);

      store.addLayer("mut-1", (local) => {
        local.setQuery("a", {}, "a-optimistic");
      });

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(0);
    });

    it("accepts FunctionReference-like objects in getQuery/setQuery", () => {
      const store = new QueryStore();
      const ref = { _name: "messages:list" };
      const key = QueryStore.makeKey("messages:list", { ch: "gen" });
      store.setServerResult(key, ["msg1"]);

      store.addLayer("mut-1", (local) => {
        const current = local.getQuery(ref, { ch: "gen" }) as string[];
        local.setQuery(ref, { ch: "gen" }, [...current, "msg2"]);
      });

      expect(store.getResult(key)).toEqual(["msg1", "msg2"]);
    });
  });

  // ---------- server update after optimistic ----------
  describe("server update with active optimistic layer", () => {
    it("server result updates base but layer still applies", () => {
      const store = new QueryStore();
      const key = QueryStore.makeKey("messages:list", {});
      store.setServerResult(key, ["a"]);

      store.addLayer("mut-1", (local) => {
        const current = local.getQuery("messages:list", {}) as string[];
        local.setQuery("messages:list", {}, [...current, "optimistic"]);
      });

      expect(store.getResult(key)).toEqual(["a", "optimistic"]);

      // Server confirms — base changes, but layer change (["a", "optimistic"]) is still stored
      store.setServerResult(key, ["a", "b"]);
      // Layer stored ["a", "optimistic"] as a snapshot, so it overrides the new base
      expect(store.getResult(key)).toEqual(["a", "optimistic"]);

      // Once layer is removed, we see the real server state
      store.removeLayer("mut-1");
      expect(store.getResult(key)).toEqual(["a", "b"]);
    });
  });
});

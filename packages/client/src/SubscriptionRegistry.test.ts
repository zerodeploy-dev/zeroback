import { describe, it, expect, vi } from "vitest"
import { SubscriptionRegistry } from "./SubscriptionRegistry"

describe("SubscriptionRegistry", () => {
  // ---------- add() ----------
  describe("add()", () => {
    it("returns a unique string id", () => {
      const reg = new SubscriptionRegistry()
      const id1 = reg.add("fn1", {}, () => {})
      const id2 = reg.add("fn2", {}, () => {})
      expect(typeof id1).toBe("string")
      expect(id1).not.toBe(id2)
    })

    it("stores the entry with correct fields", () => {
      const reg = new SubscriptionRegistry()
      const cb = vi.fn()
      const id = reg.add("tasks:list", { status: "active" }, cb)

      const entry = reg.get(id)
      expect(entry).toBeDefined()
      expect(entry!.id).toBe(id)
      expect(entry!.fnName).toBe("tasks:list")
      expect(entry!.args).toEqual({ status: "active" })
      expect(entry!.callback).toBe(cb)
    })
  })

  // ---------- get() ----------
  describe("get()", () => {
    it("retrieves entry by id", () => {
      const reg = new SubscriptionRegistry()
      const id = reg.add("fn", "args", () => {})
      expect(reg.get(id)).toBeDefined()
    })

    it("returns undefined for unknown id", () => {
      const reg = new SubscriptionRegistry()
      expect(reg.get("nonexistent")).toBeUndefined()
    })
  })

  // ---------- remove() ----------
  describe("remove()", () => {
    it("removes the entry", () => {
      const reg = new SubscriptionRegistry()
      const id = reg.add("fn", {}, () => {})
      reg.remove(id)
      expect(reg.get(id)).toBeUndefined()
    })

    it("is a no-op for unknown id", () => {
      const reg = new SubscriptionRegistry()
      // Should not throw
      reg.remove("nonexistent")
    })
  })

  // ---------- notify() ----------
  describe("notify()", () => {
    it("calls the callback with data", () => {
      const reg = new SubscriptionRegistry()
      const cb = vi.fn()
      const id = reg.add("fn", {}, cb)

      reg.notify(id, { result: 42 })
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith({ result: 42 })
    })

    it("is a no-op for unknown id", () => {
      const reg = new SubscriptionRegistry()
      // Should not throw
      reg.notify("nonexistent", "data")
    })
  })

  // ---------- getAll() ----------
  describe("getAll()", () => {
    it("returns all entries", () => {
      const reg = new SubscriptionRegistry()
      reg.add("fn1", {}, () => {})
      reg.add("fn2", {}, () => {})
      reg.add("fn3", {}, () => {})

      const all = reg.getAll()
      expect(all).toHaveLength(3)
      expect(all.map((e) => e.fnName).sort()).toEqual(["fn1", "fn2", "fn3"])
    })

    it("returns empty array when no entries", () => {
      const reg = new SubscriptionRegistry()
      expect(reg.getAll()).toEqual([])
    })

    it("excludes removed entries", () => {
      const reg = new SubscriptionRegistry()
      const id1 = reg.add("fn1", {}, () => {})
      reg.add("fn2", {}, () => {})
      reg.remove(id1)

      const all = reg.getAll()
      expect(all).toHaveLength(1)
      expect(all[0].fnName).toBe("fn2")
    })
  })
})

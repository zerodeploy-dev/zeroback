import { describe, it, expect } from "vitest"
import { TransactionStore } from "./TransactionStore"

describe("TransactionStore", () => {
  describe("begin()", () => {
    it("creates a transaction with initial state", () => {
      const store = new TransactionStore()
      const tx = store.begin("tx-1", 100, "mutation")

      expect(tx.txId).toBe("tx-1")
      expect(tx.beginTs).toBe(100)
      expect(tx.mode).toBe("mutation")
      expect(tx.readSet).toEqual([])
      expect(tx.writeSet).toEqual([])
      expect(tx.queryDescriptors).toEqual([])
      expect(tx.committed).toBe(false)
      expect(tx.aborted).toBe(false)
    })

    it("supports query mode", () => {
      const store = new TransactionStore()
      const tx = store.begin("tx-q", 50, "query")
      expect(tx.mode).toBe("query")
    })
  })

  describe("get()", () => {
    it("retrieves existing transaction", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "mutation")
      expect(store.get("tx-1")).toBeDefined()
      expect(store.get("tx-1")!.txId).toBe("tx-1")
    })

    it("returns undefined for unknown transaction", () => {
      const store = new TransactionStore()
      expect(store.get("unknown")).toBeUndefined()
    })
  })

  describe("addRead()", () => {
    it("adds a read entry", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "query")
      store.addRead("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 99 })

      expect(store.get("tx-1")!.readSet).toEqual([
        { table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 99 },
      ])
    })

    it("deduplicates by table + documentId", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "query")
      store.addRead("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 99 })
      store.addRead("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 99 })

      expect(store.get("tx-1")!.readSet).toHaveLength(1)
    })

    it("allows different documents", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "query")
      store.addRead("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 99 })
      store.addRead("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000002", ts: 99 })

      expect(store.get("tx-1")!.readSet).toHaveLength(2)
    })

    it("no-ops for unknown transaction", () => {
      const store = new TransactionStore()
      store.addRead("unknown", { table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 99 })
      // No error thrown
    })
  })

  describe("addWrite()", () => {
    it("adds a write entry", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "mutation")
      store.addWrite("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000001", data: { title: "A" } })

      expect(store.get("tx-1")!.writeSet).toHaveLength(1)
      expect(store.get("tx-1")!.writeSet[0].data).toEqual({ title: "A" })
    })

    it("replaces existing write for same document", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "mutation")
      store.addWrite("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000001", data: { title: "A" } })
      store.addWrite("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000001", data: { title: "B" } })

      expect(store.get("tx-1")!.writeSet).toHaveLength(1)
      expect(store.get("tx-1")!.writeSet[0].data).toEqual({ title: "B" })
    })

    it("allows different documents", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "mutation")
      store.addWrite("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000001", data: { title: "A" } })
      store.addWrite("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000002", data: { title: "B" } })

      expect(store.get("tx-1")!.writeSet).toHaveLength(2)
    })

    it("supports null data (deletes)", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "mutation")
      store.addWrite("tx-1", { table: "tasks", documentId: "tasks_0000000000000000000000001", data: null })

      expect(store.get("tx-1")!.writeSet[0].data).toBeNull()
    })

    it("no-ops for unknown transaction", () => {
      const store = new TransactionStore()
      store.addWrite("unknown", { table: "tasks", documentId: "tasks_0000000000000000000000001", data: {} })
    })
  })

  describe("addQueryDescriptor()", () => {
    it("adds query descriptors", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "query")
      store.addQueryDescriptor("tx-1", { table: "tasks", filter: null })

      expect(store.get("tx-1")!.queryDescriptors).toEqual([
        { table: "tasks", filter: null },
      ])
    })

    it("does not deduplicate", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "query")
      store.addQueryDescriptor("tx-1", { table: "tasks", filter: null })
      store.addQueryDescriptor("tx-1", { table: "tasks", filter: null })

      expect(store.get("tx-1")!.queryDescriptors).toHaveLength(2)
    })

    it("no-ops for unknown transaction", () => {
      const store = new TransactionStore()
      store.addQueryDescriptor("unknown", { table: "tasks", filter: null })
    })
  })

  describe("commit()", () => {
    it("sets committed flag", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "mutation")
      store.commit("tx-1")
      expect(store.get("tx-1")!.committed).toBe(true)
    })

    it("no-ops for unknown transaction", () => {
      const store = new TransactionStore()
      store.commit("unknown") // no error
    })
  })

  describe("abort()", () => {
    it("sets aborted flag", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "mutation")
      store.abort("tx-1")
      expect(store.get("tx-1")!.aborted).toBe(true)
    })

    it("no-ops for unknown transaction", () => {
      const store = new TransactionStore()
      store.abort("unknown")
    })
  })

  describe("remove()", () => {
    it("removes transaction", () => {
      const store = new TransactionStore()
      store.begin("tx-1", 100, "mutation")
      store.remove("tx-1")
      expect(store.get("tx-1")).toBeUndefined()
    })

    it("no-ops for unknown transaction", () => {
      const store = new TransactionStore()
      store.remove("unknown")
    })
  })
})

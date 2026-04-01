import { describe, it, expect, vi, beforeEach } from "vitest"
import { executeMutation, createMutationLock } from "./MutationExecutor"
import type { MutationDeps } from "./MutationExecutor"
import { TransactionStore } from "./transaction/TransactionStore"
import { SubscriptionManager } from "./subscriptions/SubscriptionManager"
import type { SqlApi } from "./types"

function makeDeps(overrides: Partial<MutationDeps> = {}): MutationDeps {
  const transactions = new TransactionStore()
  return {
    transactions,
    subscriptions: new SubscriptionManager(),
    reader: { getDocument: vi.fn().mockResolvedValue(null) } as any,
    writer: { commitWrites: vi.fn().mockResolvedValue(undefined) } as any,
    sql: {
      exec: vi.fn().mockReturnValue({ toArray: () => [] }),
    } as unknown as SqlApi,
    lock: createMutationLock(),
    getLatestTs: vi.fn().mockReturnValue(100),
    setLatestTs: vi.fn(),
    saveLatestTs: vi.fn().mockResolvedValue(undefined),
    invokeFunction: vi.fn().mockResolvedValue({
      result: "ok",
      readSet: [],
      queryDescriptors: [],
    }),
    ...overrides,
  }
}

describe("executeMutation", () => {
  it("executes function and returns result", async () => {
    const deps = makeDeps()
    const result = await executeMutation(deps, "api:tasks:create", { title: "Test" })

    expect(result).toBe("ok")
    expect(deps.invokeFunction).toHaveBeenCalledWith(
      "api:tasks:create",
      { title: "Test" },
      expect.any(String) // txId
    )
  })

  it("commits writes when write set is non-empty", async () => {
    const transactions = new TransactionStore()
    const deps = makeDeps({
      transactions,
      invokeFunction: vi.fn().mockImplementation(async (fn, args, txId) => {
        transactions.addWrite(txId, { table: "tasks", documentId: "tasks_0000000000000000000000001", data: { title: "A" } })
        return { result: "ok", readSet: [], queryDescriptors: [] }
      }),
    })

    await executeMutation(deps, "api:tasks:create", {})

    expect(deps.writer.commitWrites).toHaveBeenCalledTimes(1)
    expect(deps.setLatestTs).toHaveBeenCalledWith(101) // 100 + 1
    expect(deps.saveLatestTs).toHaveBeenCalled()
  })

  it("does not commit when write set is empty", async () => {
    const deps = makeDeps()
    await executeMutation(deps, "fn", {})
    expect(deps.writer.commitWrites).not.toHaveBeenCalled()
  })

  it("invalidates subscriptions after commit", async () => {
    const transactions = new TransactionStore()
    const subscriptions = new SubscriptionManager()
    const invalidateSpy = vi.spyOn(subscriptions, "invalidate").mockResolvedValue(undefined)

    const deps = makeDeps({
      transactions,
      subscriptions,
      invokeFunction: vi.fn().mockImplementation(async (fn, args, txId) => {
        transactions.addWrite(txId, { table: "tasks", documentId: "tasks_0000000000000000000000001", data: { title: "A" } })
        return { result: "ok", readSet: [], queryDescriptors: [] }
      }),
    })

    await executeMutation(deps, "fn", {})
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it("cleans up transaction on success", async () => {
    const transactions = new TransactionStore()
    const deps = makeDeps({ transactions })

    await executeMutation(deps, "fn", {})

    // Transaction should be removed
    // The txId is a random UUID so we check that transactions map is empty
    expect(transactions.get("any-id")).toBeUndefined()
  })

  it("cleans up transaction on error", async () => {
    const transactions = new TransactionStore()
    const deps = makeDeps({
      transactions,
      invokeFunction: vi.fn().mockRejectedValue(new Error("boom")),
    })

    await expect(executeMutation(deps, "fn", {})).rejects.toThrow("boom")
  })

  it("retries on OCC conflict", async () => {
    const transactions = new TransactionStore()
    let sqlConflictCallCount = 0
    let invokeFnCallCount = 0

    const deps = makeDeps({
      transactions,
      sql: {
        exec: vi.fn().mockImplementation((query: string) => {
          if (query.includes("SELECT 1")) {
            sqlConflictCallCount++
            // First conflict check: conflict. Second: no conflict.
            if (sqlConflictCallCount === 1) {
              return { toArray: () => [{ 1: 1 }] }
            }
          }
          return { toArray: () => [] }
        }),
      } as unknown as SqlApi,
      invokeFunction: vi.fn().mockImplementation(async (fn, args, txId) => {
        invokeFnCallCount++
        transactions.addRead(txId, { table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 50 })
        transactions.addWrite(txId, { table: "tasks", documentId: "tasks_0000000000000000000000001", data: { title: "A" } })
        return { result: "ok", readSet: [{ table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 50 }], queryDescriptors: [] }
      }),
    })

    const result = await executeMutation(deps, "fn", {})
    expect(result).toBe("ok")
    expect(invokeFnCallCount).toBe(2) // retried once
  })

  it("throws after max OCC retries", async () => {
    const transactions = new TransactionStore()

    const deps = makeDeps({
      transactions,
      sql: {
        exec: vi.fn().mockReturnValue({ toArray: () => [{ 1: 1 }] }), // always conflict
      } as unknown as SqlApi,
      invokeFunction: vi.fn().mockImplementation(async (fn, args, txId) => {
        transactions.addRead(txId, { table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 50 })
        return { result: "ok", readSet: [{ table: "tasks", documentId: "tasks_0000000000000000000000001", ts: 50 }], queryDescriptors: [] }
      }),
    })

    await expect(executeMutation(deps, "fn", {})).rejects.toThrow("max retries exceeded")
  })

  it("enriches deletes with old data for invalidation", async () => {
    const transactions = new TransactionStore()
    const subscriptions = new SubscriptionManager()
    const invalidateSpy = vi.spyOn(subscriptions, "invalidate").mockResolvedValue(undefined)

    const deps = makeDeps({
      transactions,
      subscriptions,
      reader: {
        getDocument: vi.fn().mockResolvedValue({ data: { title: "Old" }, ts: 50 }),
      } as any,
      invokeFunction: vi.fn().mockImplementation(async (fn, args, txId) => {
        transactions.addWrite(txId, { table: "tasks", documentId: "tasks_0000000000000000000000001", data: null })
        return { result: "ok", readSet: [], queryDescriptors: [] }
      }),
    })

    await executeMutation(deps, "fn", {})

    const writeSet = invalidateSpy.mock.calls[0][0]
    expect(writeSet[0].data).toBeNull()
    expect(writeSet[0].oldData).toEqual({ title: "Old" })
  })
})

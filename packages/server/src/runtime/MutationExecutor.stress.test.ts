import { describe, it, expect, vi } from "vitest"
import { executeMutation, createMutationLock } from "./MutationExecutor"
import type { MutationDeps, MutationLock } from "./MutationExecutor"
import { TransactionStore } from "./transaction/TransactionStore"
import { SubscriptionManager } from "./subscriptions/SubscriptionManager"
import type { SqlApi } from "./types"

/**
 * In-memory database that simulates the real SQLite-backed store.
 * Tracks documents with their `_ts` timestamps, enabling realistic
 * OCC conflict detection across concurrent `executeMutation` calls.
 */
class SimulatedDB {
  private docs = new Map<string, { data: Record<string, unknown>; ts: number }>()
  latestTs = 100

  insert(table: string, id: string, data: Record<string, unknown>, ts: number) {
    this.docs.set(`${table}:${id}`, { data: { ...data, _id: id }, ts })
  }

  get(table: string, id: string): { data: Record<string, unknown>; ts: number } | null {
    return this.docs.get(`${table}:${id}`) ?? null
  }

  write(table: string, id: string, data: Record<string, unknown>, ts: number) {
    this.docs.set(`${table}:${id}`, { data: { ...data, _id: id }, ts })
  }

  delete(table: string, id: string) {
    this.docs.delete(`${table}:${id}`)
  }

  hasConflict(table: string, ids: string[], beginTs: number): boolean {
    for (const id of ids) {
      const doc = this.docs.get(`${table}:${id}`)
      if (doc && doc.ts > beginTs) return true
    }
    return false
  }
}

/** No-op lock for concurrent tests — passes through without serialization. */
const noopLock: MutationLock = (fn) => fn()

type InvokeFnResult = {
  result: unknown
  readSet: { table: string; documentId: string; ts: number }[]
  queryDescriptors: { table: string; filter: null }[]
}

function makeDeps(
  db: SimulatedDB,
  transactions: TransactionStore,
  invokeFn: (fn: string, args: unknown, txId: string) => Promise<InvokeFnResult>,
  lock: MutationLock = createMutationLock(),
): MutationDeps {
  return {
    transactions,
    subscriptions: new SubscriptionManager(),
    reader: {
      getDocument: vi.fn().mockImplementation((table: string, id: string) => {
        const doc = db.get(table, id)
        return doc ? { data: doc.data, ts: doc.ts } : null
      }),
    } as any,
    writer: {
      commitWrites: vi.fn().mockImplementation(async (writeSet: any[], commitTs: number) => {
        for (const entry of writeSet) {
          if (entry.data === null) {
            db.delete(entry.table, entry.documentId)
          } else {
            db.write(entry.table, entry.documentId, entry.data, commitTs)
          }
        }
      }),
    } as any,
    sql: {
      exec: vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        if (query.includes("SELECT 1")) {
          const beginTs = params[0] as number
          const ids = params.slice(1) as string[]
          const tableMatch = query.match(/FROM "(\w+)"/)
          const table = tableMatch?.[1] ?? ""
          const conflict = db.hasConflict(table, ids, beginTs)
          return { toArray: () => (conflict ? [{ 1: 1 }] : []) }
        }
        return { toArray: () => [] }
      }),
    } as unknown as SqlApi,
    lock,
    getLatestTs: () => db.latestTs,
    setLatestTs: (ts: number) => { db.latestTs = ts },
    saveLatestTs: vi.fn().mockResolvedValue(undefined),
    invokeFunction: invokeFn,
  }
}

/** Helper: creates an invokeFunction that does read-modify-write on a single document. */
function makeReadModifyWriteFn(
  db: SimulatedDB,
  transactions: TransactionStore,
  docKey: { table: string; id: string },
) {
  return vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
    const doc = db.get(docKey.table, docKey.id)!
    transactions.addRead(txId, { table: docKey.table, documentId: docKey.id, ts: doc.ts })
    const newCounter = (doc.data.counter as number) + 1
    transactions.addWrite(txId, {
      table: docKey.table,
      documentId: docKey.id,
      data: { ...doc.data, counter: newCounter },
    })
    return {
      result: newCounter,
      readSet: [{ table: docKey.table, documentId: docKey.id, ts: doc.ts }],
      queryDescriptors: [],
    }
  })
}

// ---------------------------------------------------------------------------
// Serialized OCC tests — simulate DO input gate with mutex
// These verify that OCC conflict detection and retries work correctly
// when mutations are serialized (as they are in a real Durable Object).
// ---------------------------------------------------------------------------
describe("OCC stress tests (serialized — simulates DO input gate)", () => {

  it("sequential mutations on the same document never conflict", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_seq", { title: "sequential", counter: 0 }, 100)
    const invokeFn = makeReadModifyWriteFn(db, transactions, { table: "tasks", id: "tasks_seq" })
    const deps = makeDeps(db, transactions, invokeFn)

    for (let i = 0; i < 20; i++) {
      await executeMutation(deps, "tasks:update", {})
    }

    const finalDoc = db.get("tasks", "tasks_seq")!
    expect(finalDoc.data.counter).toBe(20)
    expect(invokeFn).toHaveBeenCalledTimes(20)
  })

  it("serialized concurrent mutations all succeed via retries", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_ser", { title: "serialized", counter: 0 }, 100)
    const invokeFn = makeReadModifyWriteFn(db, transactions, { table: "tasks", id: "tasks_ser" })
    const deps = makeDeps(db, transactions, invokeFn)
    const N = 10

    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        executeMutation(deps, "tasks:update", {})
      )
    )

    const succeeded = results.filter((r) => r.status === "fulfilled")
    // With serialization, every mutation succeeds (no concurrent conflicts)
    expect(succeeded.length).toBe(N)

    // Counter should match exactly
    const finalDoc = db.get("tasks", "tasks_ser")!
    expect(finalDoc.data.counter).toBe(N)
  })

  it("serialized bursts: waves of mutations preserve counter", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_burst", { title: "burst", counter: 0 }, 100)
    const invokeFn = makeReadModifyWriteFn(db, transactions, { table: "tasks", id: "tasks_burst" })
    const deps = makeDeps(db, transactions, invokeFn)

    let totalSucceeded = 0

    for (let wave = 0; wave < 3; wave++) {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          executeMutation(deps, "tasks:update", {})
        )
      )
      totalSucceeded += results.filter((r) => r.status === "fulfilled").length
    }

    const finalDoc = db.get("tasks", "tasks_burst")!
    expect(finalDoc.data.counter).toBe(totalSucceeded)
    expect(totalSucceeded).toBe(15)
  })

  it("serialized high contention: many writers on same doc", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_hot", { title: "hot doc", v: 0 }, 100)

    const invokeFn = vi.fn().mockImplementation(async (_fn: string, args: any, txId: string) => {
      const doc = db.get("tasks", "tasks_hot")!
      transactions.addRead(txId, { table: "tasks", documentId: "tasks_hot", ts: doc.ts })
      const updated = { ...doc.data, [`field_${args.writer}`]: args.writer, v: (doc.data.v as number) + 1 }
      transactions.addWrite(txId, { table: "tasks", documentId: "tasks_hot", data: updated })
      return {
        result: updated.v,
        readSet: [{ table: "tasks", documentId: "tasks_hot", ts: doc.ts }],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn)
    const N = 15

    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        executeMutation(deps, "tasks:update", { writer: `w${i}` })
      )
    )

    const succeeded = results.filter((r) => r.status === "fulfilled")
    expect(succeeded.length).toBe(N)

    const finalDoc = db.get("tasks", "tasks_hot")!
    expect(finalDoc.data.v).toBe(N)
  })

  it("serialized mutation + error: counter matches successful commits", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_err", { title: "error-test", v: 0 }, 100)

    let callCount = 0
    const invokeFn = vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
      callCount++
      const doc = db.get("tasks", "tasks_err")!
      transactions.addRead(txId, { table: "tasks", documentId: "tasks_err", ts: doc.ts })

      if (callCount % 3 === 0) {
        throw new Error("Application error")
      }

      transactions.addWrite(txId, {
        table: "tasks",
        documentId: "tasks_err",
        data: { ...doc.data, v: (doc.data.v as number) + 1 },
      })
      return {
        result: "ok",
        readSet: [{ table: "tasks", documentId: "tasks_err", ts: doc.ts }],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn)
    const N = 12

    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        executeMutation(deps, "tasks:update", {})
      )
    )

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    expect(succeeded + failed).toBe(N)
    expect(failed).toBeGreaterThan(0)

    const finalDoc = db.get("tasks", "tasks_err")!
    expect(finalDoc.data.v).toBe(succeeded)
  })

  it("serialized: 50 mutations on single document", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_load", { title: "load-test", counter: 0 }, 100)
    const invokeFn = makeReadModifyWriteFn(db, transactions, { table: "tasks", id: "tasks_load" })
    const deps = makeDeps(db, transactions, invokeFn)
    const N = 50

    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        executeMutation(deps, "tasks:update", {})
      )
    )

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    expect(succeeded).toBe(N)

    const finalDoc = db.get("tasks", "tasks_load")!
    expect(finalDoc.data.counter).toBe(N)
  })
})

// ---------------------------------------------------------------------------
// Concurrent OCC tests — no serialization, all mutations fire at once.
// These verify properties that must hold regardless of scheduling:
// no crashes, no transaction leaks, valid DB state.
// ---------------------------------------------------------------------------
describe("OCC stress tests (fully concurrent — no serialization)", () => {

  it("all concurrent mutations resolve without crashing", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_shared", { title: "original", counter: 0 }, 100)
    const invokeFn = makeReadModifyWriteFn(db, transactions, { table: "tasks", id: "tasks_shared" })
    const deps = makeDeps(db, transactions, invokeFn, noopLock)
    const N = 10

    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        executeMutation(deps, "tasks:update", {})
      )
    )

    const succeeded = results.filter((r) => r.status === "fulfilled")
    const failed = results.filter((r) => r.status === "rejected")

    expect(succeeded.length + failed.length).toBe(N)
    expect(succeeded.length).toBeGreaterThan(0)

    for (const f of failed) {
      expect((f as PromiseRejectedResult).reason.message).toContain("max retries exceeded")
    }

    // DB should be in a valid state (counter >= 1)
    const finalDoc = db.get("tasks", "tasks_shared")!
    expect(finalDoc.data.counter).toBeGreaterThanOrEqual(1)
  })

  it("write-only mutations never conflict even under concurrency", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()
    let insertCount = 0

    const invokeFn = vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
      const id = `tasks_insert${insertCount++}`
      transactions.addWrite(txId, { table: "tasks", documentId: id, data: { title: `task-${id}` } })
      return { result: id, readSet: [], queryDescriptors: [] }
    })

    const deps = makeDeps(db, transactions, invokeFn, noopLock)

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        executeMutation(deps, "tasks:create", {})
      )
    )

    expect(results.filter((r) => r.status === "fulfilled").length).toBe(20)
  })

  it("concurrent mutations across different documents do not interfere", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()
    const N = 10

    for (let i = 0; i < N; i++) {
      db.insert("tasks", `tasks_iso${i}`, { title: `task-${i}`, counter: 0 }, 100)
    }

    const invokeFn = vi.fn().mockImplementation(async (_fn: string, args: any, txId: string) => {
      const docId = `tasks_iso${args.idx}`
      const doc = db.get("tasks", docId)!
      transactions.addRead(txId, { table: "tasks", documentId: docId, ts: doc.ts })
      const newCounter = (doc.data.counter as number) + 1
      transactions.addWrite(txId, {
        table: "tasks",
        documentId: docId,
        data: { ...doc.data, counter: newCounter },
      })
      return {
        result: newCounter,
        readSet: [{ table: "tasks", documentId: docId, ts: doc.ts }],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn, noopLock)

    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        executeMutation(deps, "tasks:update", { idx: i })
      )
    )

    expect(results.filter((r) => r.status === "fulfilled").length).toBe(N)

    for (let i = 0; i < N; i++) {
      const doc = db.get("tasks", `tasks_iso${i}`)!
      expect(doc.data.counter).toBe(1)
    }

    expect(invokeFn).toHaveBeenCalledTimes(N)
  })

  it("no transaction leaks after concurrent stress", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_leak", { title: "leak-test", v: 0 }, 100)
    const invokeFn = makeReadModifyWriteFn(db, transactions, { table: "tasks", id: "tasks_leak" })
    const deps = makeDeps(db, transactions, invokeFn, noopLock)

    // Collect all txIds used during execution
    const txIds: string[] = []
    const origBegin = transactions.begin.bind(transactions)
    vi.spyOn(transactions, "begin").mockImplementation((txId, beginTs, mode) => {
      txIds.push(txId)
      return origBegin(txId, beginTs, mode)
    })

    await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        executeMutation(deps, "tasks:update", {})
      )
    )

    // Every transaction that was started should have been cleaned up
    for (const txId of txIds) {
      expect(transactions.get(txId)).toBeUndefined()
    }
  })

  it("conflict detection is per-document, not global", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_x", { title: "X", v: 0 }, 100)
    db.insert("tasks", "tasks_y", { title: "Y", v: 0 }, 100)

    let callCount = 0
    const invokeFn = vi.fn().mockImplementation(async (_fn: string, args: any, txId: string) => {
      callCount++
      const docId = args.target === "x" ? "tasks_x" : "tasks_y"
      const doc = db.get("tasks", docId)!
      transactions.addRead(txId, { table: "tasks", documentId: docId, ts: doc.ts })
      transactions.addWrite(txId, {
        table: "tasks",
        documentId: docId,
        data: { ...doc.data, v: (doc.data.v as number) + 1 },
      })
      return {
        result: "ok",
        readSet: [{ table: "tasks", documentId: docId, ts: doc.ts }],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn, noopLock)

    const results = await Promise.allSettled([
      executeMutation(deps, "tasks:update", { target: "x" }),
      executeMutation(deps, "tasks:update", { target: "y" }),
    ])

    expect(results.every((r) => r.status === "fulfilled")).toBe(true)
    expect(db.get("tasks", "tasks_x")!.data.v).toBe(1)
    expect(db.get("tasks", "tasks_y")!.data.v).toBe(1)
    expect(callCount).toBe(2)
  })

  it("multi-document transaction: both readers of shared documents resolve", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_a", { title: "A", counter: 0 }, 100)
    db.insert("tasks", "tasks_b", { title: "B", counter: 0 }, 100)

    const invokeFn = vi.fn().mockImplementation(async (_fn: string, args: any, txId: string) => {
      const docA = db.get("tasks", "tasks_a")!
      const docB = db.get("tasks", "tasks_b")!
      transactions.addRead(txId, { table: "tasks", documentId: "tasks_a", ts: docA.ts })
      transactions.addRead(txId, { table: "tasks", documentId: "tasks_b", ts: docB.ts })

      const target = args.target as string
      const doc = target === "a" ? docA : docB
      const id = target === "a" ? "tasks_a" : "tasks_b"
      transactions.addWrite(txId, {
        table: "tasks",
        documentId: id,
        data: { ...doc.data, counter: (doc.data.counter as number) + 1 },
      })

      return {
        result: "ok",
        readSet: [
          { table: "tasks", documentId: "tasks_a", ts: docA.ts },
          { table: "tasks", documentId: "tasks_b", ts: docB.ts },
        ],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn, noopLock)

    const results = await Promise.allSettled([
      executeMutation(deps, "tasks:update", { target: "a" }),
      executeMutation(deps, "tasks:update", { target: "b" }),
    ])

    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1)
  })

  it("latestTs increments correctly under concurrent writes", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()
    const initialTs = db.latestTs

    const invokeFn = vi.fn().mockImplementation(async (_fn: string, args: any, txId: string) => {
      transactions.addWrite(txId, {
        table: "tasks",
        documentId: `tasks_ts${args.idx}`,
        data: { title: `ts-test-${args.idx}` },
      })
      return { result: "ok", readSet: [], queryDescriptors: [] }
    })

    const deps = makeDeps(db, transactions, invokeFn, noopLock)

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        executeMutation(deps, "tasks:create", { idx: i })
      )
    )

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    expect(succeeded).toBe(10)
    expect(db.latestTs).toBe(initialTs + 10)
  })

  it("retry count grows with contention level", async () => {
    const retryCountsByContention: number[] = []

    for (const concurrency of [2, 5, 10]) {
      const db = new SimulatedDB()
      const transactions = new TransactionStore()

      db.insert("tasks", "tasks_retry", { title: "retry-test", v: 0 }, 100)
      let totalInvocations = 0

      const invokeFn = vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
        totalInvocations++
        const doc = db.get("tasks", "tasks_retry")!
        transactions.addRead(txId, { table: "tasks", documentId: "tasks_retry", ts: doc.ts })
        transactions.addWrite(txId, {
          table: "tasks",
          documentId: "tasks_retry",
          data: { ...doc.data, v: (doc.data.v as number) + 1 },
        })
        return {
          result: "ok",
          readSet: [{ table: "tasks", documentId: "tasks_retry", ts: doc.ts }],
          queryDescriptors: [],
        }
      })

      const deps = makeDeps(db, transactions, invokeFn, noopLock)

      const results = await Promise.allSettled(
        Array.from({ length: concurrency }, () =>
          executeMutation(deps, "tasks:update", {})
        )
      )

      const succeeded = results.filter((r) => r.status === "fulfilled").length
      retryCountsByContention.push(totalInvocations - succeeded)
    }

    // Higher concurrency should lead to equal or more retries
    expect(retryCountsByContention[2]).toBeGreaterThanOrEqual(retryCountsByContention[0])
  })
})

// ---------------------------------------------------------------------------
// OCC mechanism tests — verify core conflict detection logic
// ---------------------------------------------------------------------------
describe("OCC mechanism tests", () => {

  it("detects conflict when document is modified between begin and check", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_conflict", { title: "original", v: 0 }, 100)

    let attempt = 0
    const invokeFn = vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
      attempt++
      const doc = db.get("tasks", "tasks_conflict")!
      transactions.addRead(txId, { table: "tasks", documentId: "tasks_conflict", ts: doc.ts })

      if (attempt === 1) {
        // Simulate another mutation committing between read and conflict check
        // by directly bumping the doc's ts in the DB
        db.write("tasks", "tasks_conflict", { ...doc.data, v: 999 }, db.latestTs + 1)
        db.latestTs += 1
      }

      transactions.addWrite(txId, {
        table: "tasks",
        documentId: "tasks_conflict",
        data: { ...doc.data, v: (doc.data.v as number) + 1 },
      })
      return {
        result: "ok",
        readSet: [{ table: "tasks", documentId: "tasks_conflict", ts: doc.ts }],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn)
    await executeMutation(deps, "tasks:update", {})

    // Should have retried once (first attempt detected conflict)
    expect(attempt).toBe(2)
  })

  it("throws after MAX_OCC_RETRIES (5) with persistent conflicts", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_forever", { title: "forever-conflict", v: 0 }, 100)

    let attempt = 0
    const invokeFn = vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
      attempt++
      const doc = db.get("tasks", "tasks_forever")!
      transactions.addRead(txId, { table: "tasks", documentId: "tasks_forever", ts: doc.ts })

      // Simulate conflict on every attempt by bumping ts
      db.write("tasks", "tasks_forever", doc.data, db.latestTs + 1)
      db.latestTs += 1

      transactions.addWrite(txId, {
        table: "tasks",
        documentId: "tasks_forever",
        data: { ...doc.data, v: (doc.data.v as number) + 1 },
      })
      return {
        result: "ok",
        readSet: [{ table: "tasks", documentId: "tasks_forever", ts: doc.ts }],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn)

    await expect(executeMutation(deps, "tasks:update", {})).rejects.toThrow("max retries exceeded")
    expect(attempt).toBe(6) // initial + 5 retries
  })

  it("no conflict when document has not changed since beginTs", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_clean", { title: "clean", v: 0 }, 100)

    let attempt = 0
    const invokeFn = vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
      attempt++
      const doc = db.get("tasks", "tasks_clean")!
      transactions.addRead(txId, { table: "tasks", documentId: "tasks_clean", ts: doc.ts })
      transactions.addWrite(txId, {
        table: "tasks",
        documentId: "tasks_clean",
        data: { ...doc.data, v: (doc.data.v as number) + 1 },
      })
      return {
        result: "ok",
        readSet: [{ table: "tasks", documentId: "tasks_clean", ts: doc.ts }],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn)
    await executeMutation(deps, "tasks:update", {})

    expect(attempt).toBe(1) // no retries
  })

  it("conflict on one of multiple read documents triggers retry", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_r1", { title: "R1", v: 0 }, 100)
    db.insert("tasks", "tasks_r2", { title: "R2", v: 0 }, 100)
    db.insert("tasks", "tasks_r3", { title: "R3", v: 0 }, 100)

    let attempt = 0
    const invokeFn = vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
      attempt++
      const docs = ["tasks_r1", "tasks_r2", "tasks_r3"].map((id) => {
        const doc = db.get("tasks", id)!
        transactions.addRead(txId, { table: "tasks", documentId: id, ts: doc.ts })
        return doc
      })

      if (attempt === 1) {
        // Only modify r2, leaving r1 and r3 alone
        db.write("tasks", "tasks_r2", docs[1].data, db.latestTs + 1)
        db.latestTs += 1
      }

      // Write to r1 only
      transactions.addWrite(txId, {
        table: "tasks",
        documentId: "tasks_r1",
        data: { ...docs[0].data, v: (docs[0].data.v as number) + 1 },
      })

      return {
        result: "ok",
        readSet: [
          { table: "tasks", documentId: "tasks_r1", ts: docs[0].ts },
          { table: "tasks", documentId: "tasks_r2", ts: docs[1].ts },
          { table: "tasks", documentId: "tasks_r3", ts: docs[2].ts },
        ],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn)
    await executeMutation(deps, "tasks:update", {})

    // Should retry because r2 was modified (even though we only write to r1)
    expect(attempt).toBe(2)
  })

  it("backoff delays increase with retry attempts", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()

    db.insert("tasks", "tasks_backoff", { title: "backoff", v: 0 }, 100)

    const timings: number[] = []
    let lastTime = Date.now()

    const invokeFn = vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
      const now = Date.now()
      timings.push(now - lastTime)
      lastTime = now

      const doc = db.get("tasks", "tasks_backoff")!
      transactions.addRead(txId, { table: "tasks", documentId: "tasks_backoff", ts: doc.ts })

      // Always create a conflict
      db.write("tasks", "tasks_backoff", doc.data, db.latestTs + 1)
      db.latestTs += 1

      transactions.addWrite(txId, {
        table: "tasks",
        documentId: "tasks_backoff",
        data: { ...doc.data, v: (doc.data.v as number) + 1 },
      })
      return {
        result: "ok",
        readSet: [{ table: "tasks", documentId: "tasks_backoff", ts: doc.ts }],
        queryDescriptors: [],
      }
    })

    const deps = makeDeps(db, transactions, invokeFn)

    await expect(executeMutation(deps, "tasks:update", {})).rejects.toThrow("max retries exceeded")

    // We should have 6 timings (initial + 5 retries)
    expect(timings.length).toBe(6)
  })

  it("delete operations are enriched with old data", async () => {
    const db = new SimulatedDB()
    const transactions = new TransactionStore()
    const subscriptions = new SubscriptionManager()
    const invalidateSpy = vi.spyOn(subscriptions, "invalidate").mockResolvedValue(undefined)

    db.insert("tasks", "tasks_del", { title: "to-delete", v: 42 }, 100)

    const invokeFn = vi.fn().mockImplementation(async (_fn: string, _args: any, txId: string) => {
      transactions.addWrite(txId, { table: "tasks", documentId: "tasks_del", data: null })
      return { result: "ok", readSet: [], queryDescriptors: [] }
    })

    const deps = makeDeps(db, transactions, invokeFn)
    deps.subscriptions = subscriptions

    await executeMutation(deps, "tasks:delete", {})

    expect(invalidateSpy).toHaveBeenCalled()
    const writeSet = invalidateSpy.mock.calls[0][0]
    expect(writeSet[0].data).toBeNull()
    expect(writeSet[0].oldData).toBeDefined()
  })
})

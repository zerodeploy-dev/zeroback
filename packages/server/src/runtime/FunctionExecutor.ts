import type { FilterExpressionJSON, IndexQueryJSON, DbOps, SchemaJSON, ActionCtx } from "@zeroback/server"
import type { UserIdentity } from "@zeroback/values"
import { DatabaseReader, DatabaseWriter, StorageReader, StorageWriter, StorageActions } from "@zeroback/server"
import { validate } from "@zeroback/values"
import type { TableColumnInfo } from "./db/SchemaMapper"
import type { TransactionStore } from "./transaction/TransactionStore"
import type { SqlApi, FunctionDef } from "./types"
import type { DOSQLiteReader } from "./db/DOSQLiteReader"
import { queryTable } from "./QueryPlanner"
import type { StorageManager } from "./StorageManager"
import type { CronManager } from "./CronManager"
import { executeMutation, type MutationDeps } from "./MutationExecutor"
import { errorMessage } from "./errors"

export type FunctionExecutorDeps = {
  functions: Record<string, FunctionDef>
  schemaInfo: SchemaJSON
  tableColumns: Map<string, TableColumnInfo>
  transactions: TransactionStore
  sql: SqlApi
  reader: DOSQLiteReader
  storage: StorageManager
  cron: CronManager
  getLatestTs: () => number
  getMutationDeps: () => MutationDeps
}

export class FunctionExecutor {
  private deps: FunctionExecutorDeps

  constructor(deps: FunctionExecutorDeps) {
    this.deps = deps
  }

  createDbOps(txId: string): DbOps {
    const { transactions, sql, schemaInfo, tableColumns, reader } = this.deps
    return {
      query: async (table, filter, orderField, orderDirection, limit, indexQuery, keysetCursor, searchQuery) => {
        const tx = transactions.get(txId)
        if (!tx) throw new Error("Invalid transaction")

        let descriptorFilter = filter
        if (searchQuery) {
          descriptorFilter = null
        } else if (indexQuery) {
          const indexFilter = indexRangesToFilter(indexQuery.ranges)
          descriptorFilter = filter && indexFilter
            ? { op: "and" as const, exprs: [indexFilter, filter] }
            : (indexFilter || filter)
        }
        transactions.addQueryDescriptor(txId, { table, filter: descriptorFilter })

        const docs = queryTable(
          sql, schemaInfo, tableColumns,
          table, tx.beginTs, filter, indexQuery ?? null, orderField, orderDirection, limit, keysetCursor, searchQuery ?? null
        )

        for (const doc of docs) {
          transactions.addRead(txId, { table, documentId: doc.documentId, ts: doc.ts })
        }
        return docs.map((d) => d.data as Record<string, unknown>)
      },

      get: async (table, id) => {
        const tx = transactions.get(txId)
        if (!tx) throw new Error("Invalid transaction")
        const doc = await reader.getDocument(table, id, tx.beginTs)
        if (doc) {
          transactions.addRead(txId, { table, documentId: id, ts: doc.ts })
        }
        return (doc?.data as Record<string, unknown>) ?? null
      },

      getMany: async (table, ids) => {
        const tx = transactions.get(txId)
        if (!tx) throw new Error("Invalid transaction")
        const docs = reader.getDocuments(table, ids, tx.beginTs)
        const result = new Map<string, Record<string, unknown> | null>()
        for (const id of ids) {
          const doc = docs.get(id)
          if (doc) {
            transactions.addRead(txId, { table, documentId: id, ts: doc.ts })
            result.set(id, doc.data as Record<string, unknown>)
          } else {
            result.set(id, null)
          }
        }
        return result
      },

      insert: async (table, id, data) => {
        this.validateDocument(table, data as Record<string, unknown>)
        transactions.addWrite(txId, { table, documentId: id, data })
      },

      patch: async (table, id, fields) => {
        const tx = transactions.get(txId)
        if (!tx) throw new Error("Invalid transaction")
        const existing = await reader.getDocument(table, id, tx.beginTs)
        if (!existing) throw new Error(`Document ${id} not found`)
        const merged = { ...(existing.data as Record<string, unknown>), ...fields }
        this.validateDocument(table, merged)
        transactions.addWrite(txId, { table, documentId: id, data: merged })
      },

      replace: async (table, id, data) => {
        const tx = transactions.get(txId)
        if (!tx) throw new Error("Invalid transaction")
        const existing = await reader.getDocument(table, id, tx.beginTs)
        if (!existing) throw new Error(`Document ${id} not found`)
        const fullDoc = { ...(data as Record<string, unknown>), _id: id }
        this.validateDocument(table, fullDoc)
        transactions.addWrite(txId, { table, documentId: id, data: fullDoc })
      },

      delete: async (table, id) => {
        transactions.addWrite(txId, { table, documentId: id, data: null })
      },
    }
  }

  async invokeFunction(
    fnName: string,
    args: unknown,
    txId: string,
    identity?: UserIdentity | null
  ): Promise<{ result: unknown; readSet: { table: string; documentId: string; ts: number }[]; queryDescriptors: { table: string; filter: FilterExpressionJSON | null }[] }> {
    const { functions, transactions, storage, cron } = this.deps
    const fn = functions[fnName]
    if (!fn) {
      throw new Error(`Function not found: ${fnName}. Available: ${Object.keys(functions).join(", ")}`)
    }

    // Validate args
    if (fn.argsValidator && Object.keys(fn.argsValidator).length > 0) {
      const argsSchema = {
        type: "object" as const,
        value: Object.fromEntries(
          Object.entries(fn.argsValidator).map(([k, v]) => [k, v.json])
        ),
      }
      validate(args, argsSchema)
    }

    const storageOps = storage.createStorageOps()

    if (fn.type === "action") {
      const ctx = this.createActionCtx(identity)
      const result = await fn.handler(ctx, args)
      this.validateReturnValue(fnName, fn, result)
      return { result, readSet: [], queryDescriptors: [] }
    }

    const ops = this.createDbOps(txId)
    const db = fn.type === "query"
      ? new DatabaseReader(ops)
      : new DatabaseWriter(ops)

    const storageFacade = fn.type === "query"
      ? new StorageReader(storageOps)
      : new StorageWriter(storageOps)

    const baseCtx = { db, scheduler: cron.createScheduler(), storage: storageFacade }
    const ctx = { ...baseCtx, auth: { getUserIdentity: () => Promise.resolve(identity ?? null) } }
    const result = await fn.handler(ctx, args)
    this.validateReturnValue(fnName, fn, result)

    const tx = transactions.get(txId)
    return {
      result,
      readSet: tx ? [...tx.readSet] : [],
      queryDescriptors: tx ? [...tx.queryDescriptors] : [],
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ActionCtx generic methods require any for runtime dispatch
  createActionCtx(identity?: UserIdentity | null): ActionCtx<any> {
    const { functions, transactions, storage, cron } = this.deps
    const storageOps = storage.createStorageOps()
    const baseCtx = {
      runQuery: async <T>(fnName: string, args?: Record<string, unknown>): Promise<T> => {
        const fn = functions[fnName]
        if (!fn || fn.type !== "query") throw new Error(`Query not found: ${fnName}`)
        const txId = crypto.randomUUID()
        transactions.begin(txId, this.deps.getLatestTs(), "query")
        try {
          const result = await this.invokeFunction(fnName, args ?? {}, txId, identity)
          return result.result as T
        } finally {
          transactions.remove(txId)
        }
      },
      runMutation: async <T>(fnName: string, args?: Record<string, unknown>): Promise<T> => {
        const fn = functions[fnName]
        if (!fn || fn.type !== "mutation") throw new Error(`Mutation not found: ${fnName}`)
        return executeMutation(this.deps.getMutationDeps(), fnName, args ?? {}, identity) as T
      },
      runAction: async <T>(fnName: string, args?: Record<string, unknown>): Promise<T> => {
        const fn = functions[fnName]
        if (!fn || fn.type !== "action") throw new Error(`Action not found: ${fnName}`)
        const actionCtx = this.createActionCtx()
        return await fn.handler(actionCtx, args ?? {}) as T
      },
      scheduler: cron.createScheduler(),
      storage: new StorageActions(storageOps),
    }
    if (identity !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- auth is added at runtime when identity is present
      return { ...baseCtx, auth: { getUserIdentity: () => Promise.resolve(identity) } } as any
    }
    return baseCtx
  }

  validateDocument(table: string, data: Record<string, unknown>): void {
    const tableInfo = this.deps.schemaInfo.tables[table]
    if (!tableInfo) return
    const { _id, _ts, _creationTime, ...userFields } = data
    validate(userFields, { type: "object", value: tableInfo.fields })
  }

  private validateReturnValue(fnName: string, fn: FunctionDef, result: unknown): void {
    if (!fn.returnsValidator) return
    try {
      validate(result, fn.returnsValidator.json)
    } catch (e) {
      throw new Error(`Return value validation failed for "${fnName}": ${errorMessage(e)}`)
    }
  }
}

export function indexRangesToFilter(
  ranges: IndexQueryJSON["ranges"]
): FilterExpressionJSON | null {
  if (ranges.length === 0) return null

  const exprs: FilterExpressionJSON[] = ranges.map((r) => ({
    op: r.op,
    a: { op: "field" as const, path: r.field },
    b: { op: "literal" as const, value: r.value },
  }))

  if (exprs.length === 1) return exprs[0]
  return { op: "and", exprs }
}

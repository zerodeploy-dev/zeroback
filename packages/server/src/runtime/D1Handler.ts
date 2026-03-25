import type {
  DbOps, SchemaJSON, WriteSetEntry, FilterExpressionJSON,
  IndexQueryJSON, KeysetCursorInfo, SearchQueryJSON,
  ActionCtx, HttpActionHandler, CronJobDef,
} from "@zeroback/server"
import type { ValidatorJSON } from "@zeroback/values"
import { DatabaseReader, DatabaseWriter, StorageReader, StorageWriter, StorageActions } from "@zeroback/server"
import { validate } from "@zeroback/values"
import type { D1Database } from "./db/D1Adapter"
import { createD1SqlApi } from "./db/D1Adapter"
import { D1Reader } from "./db/D1Reader"
import { D1Writer } from "./db/D1Writer"
import { buildTableColumns, migrateSchema, generateTableDDL } from "./db/SchemaMapper"
import type { TableColumnInfo } from "./db/SchemaMapper"
import { queryTableAsync } from "./D1QueryPlanner"
import { D1CronManager } from "./D1CronManager"
import { errorMessage, ErrorCode } from "./errors"
import type { AsyncSqlApi } from "./types"
import type { FunctionDef, HttpRouterLike, RuntimeConfig } from "./ZerobackDO"

export interface D1Env {
  DB: D1Database
  ZEROBACK_STORAGE?: R2Bucket
}

/**
 * Create a stateless D1-backed Cloudflare Worker handler.
 * This is the D1 equivalent of createZerobackDO — same developer experience
 * (codegen, typed queries/mutations/actions) but without WebSockets or realtime.
 */
export function createD1Handler(config: RuntimeConfig) {
  const schemaInfo = config.schema as SchemaJSON
  let initialized = false

  // Inject default by_id index on every table
  for (const tableInfo of Object.values(schemaInfo.tables)) {
    if (!tableInfo.indexes) tableInfo.indexes = []
    if (!tableInfo.indexes.some((i) => i.name === "by_id")) {
      tableInfo.indexes.push({ name: "by_id", fields: ["_id"] })
    }
  }

  const tableColumns = buildTableColumns(schemaInfo)

  async function ensureInitialized(sql: AsyncSqlApi): Promise<void> {
    if (initialized) return
    // Create system tables
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        run_at REAL NOT NULL,
        fn_name TEXT NOT NULL,
        args TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      )
    `)
    await sql.exec(`CREATE INDEX IF NOT EXISTS scheduled_jobs_run_at ON scheduled_jobs (run_at) WHERE status = 'pending'`)
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        name TEXT PRIMARY KEY,
        fn_name TEXT NOT NULL,
        args TEXT NOT NULL,
        schedule TEXT NOT NULL,
        next_run_at REAL NOT NULL,
        last_run_at REAL
      )
    `)
    await sql.exec(`CREATE INDEX IF NOT EXISTS cron_jobs_next_run ON cron_jobs (next_run_at)`)
    await sql.exec(`
      CREATE TABLE IF NOT EXISTS _storage (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        created_at REAL NOT NULL
      )
    `)

    // Migrate user tables
    await migrateSchemaAsync(sql, schemaInfo)

    initialized = true
  }

  /** Async wrapper around migrateSchema for D1. */
  async function migrateSchemaAsync(sql: AsyncSqlApi, schema: SchemaJSON): Promise<void> {
    // For D1, we run each DDL statement individually since migrateSchema uses sync SqlApi.
    // We create a sync-like shim that collects statements, then execute them.
    // Actually, since D1 exec() can run raw SQL, we use that for simple DDL.
    // For the initial version, just ensure all tables exist with CREATE IF NOT EXISTS.
    for (const [tableName, tableInfo] of Object.entries(schema.tables)) {
      for (const stmt of generateTableDDL(tableName, tableInfo)) {
        await sql.exec(stmt)
      }
    }
  }

  function createDbOps(
    sql: AsyncSqlApi,
    reader: D1Reader,
    writeSet: WriteSetEntry[],
    latestTs: number,
  ): DbOps {
    return {
      query: async (table, filter, orderField, orderDirection, limit, indexQuery, keysetCursor, searchQuery) => {
        const docs = await queryTableAsync(
          sql, schemaInfo, tableColumns,
          table, latestTs, filter, indexQuery ?? null, orderField, orderDirection, limit, keysetCursor, searchQuery ?? null
        )
        return docs.map((d) => d.data as Record<string, unknown>)
      },

      get: async (table, id) => {
        const doc = await reader.getDocument(table, id, latestTs)
        return (doc?.data as Record<string, unknown>) ?? null
      },

      getMany: async (table, ids) => {
        const docs = await reader.getDocuments(table, ids, latestTs)
        const result = new Map<string, Record<string, unknown> | null>()
        for (const id of ids) {
          const doc = docs.get(id)
          result.set(id, doc ? doc.data as Record<string, unknown> : null)
        }
        return result
      },

      insert: async (table, id, data) => {
        validateDocument(table, data)
        writeSet.push({ table, documentId: id, data })
      },

      patch: async (table, id, fields) => {
        const existing = await reader.getDocument(table, id, latestTs)
        if (!existing) throw new Error(`Document ${id} not found`)
        const merged = { ...(existing.data as Record<string, unknown>), ...fields }
        validateDocument(table, merged)
        writeSet.push({ table, documentId: id, data: merged })
      },

      replace: async (table, id, data) => {
        const existing = await reader.getDocument(table, id, latestTs)
        if (!existing) throw new Error(`Document ${id} not found`)
        const fullDoc = { ...(data as Record<string, unknown>), _id: id }
        validateDocument(table, fullDoc)
        writeSet.push({ table, documentId: id, data: fullDoc })
      },

      delete: async (table, id) => {
        writeSet.push({ table, documentId: id, data: null })
      },
    }
  }

  function validateDocument(table: string, data: Record<string, unknown>): void {
    const tableInfo = schemaInfo.tables[table]
    if (!tableInfo) return
    const { _id, _ts, _creationTime, ...userFields } = data
    validate(userFields, { type: "object", value: tableInfo.fields })
  }

  function validateReturnValue(fnName: string, fn: FunctionDef, result: unknown): void {
    if (!fn.returnsValidator) return
    try {
      validate(result, fn.returnsValidator.json)
    } catch (e) {
      throw new Error(`Return value validation failed for "${fnName}": ${errorMessage(e)}`)
    }
  }

  async function getLatestTs(sql: AsyncSqlApi): Promise<number> {
    // Find the max _ts across all user tables
    let maxTs = 0
    for (const tableName of Object.keys(schemaInfo.tables)) {
      const rows = (await sql.exec(
        `SELECT MAX(_ts) as max_ts FROM "${tableName}"`
      )).toArray() as { max_ts: number | null }[]
      if (rows[0]?.max_ts != null && rows[0].max_ts > maxTs) {
        maxTs = rows[0].max_ts
      }
    }
    return maxTs
  }

  async function executeQuery(
    db: D1Database,
    sql: AsyncSqlApi,
    fnName: string,
    args: unknown,
  ): Promise<unknown> {
    const fn = config.functions[fnName]
    if (!fn) throw new Error(`Function not found: ${fnName}`)
    if (fn.type !== "query") throw new Error(`${fnName} is not a query`)

    validateArgs(fn, args)

    const reader = new D1Reader(sql, tableColumns)
    const latestTs = await getLatestTs(sql)
    const writeSet: WriteSetEntry[] = []
    const ops = createDbOps(sql, reader, writeSet, latestTs)
    const dbReader = new DatabaseReader(ops)
    const storageOps = createD1StorageOps(sql)

    const result = await fn.handler({ db: dbReader, storage: new StorageReader(storageOps) }, args)
    validateReturnValue(fnName, fn, result)
    return result
  }

  async function executeMutation(
    db: D1Database,
    sql: AsyncSqlApi,
    fnName: string,
    args: unknown,
  ): Promise<unknown> {
    const fn = config.functions[fnName]
    if (!fn) throw new Error(`Function not found: ${fnName}`)
    if (fn.type !== "mutation") throw new Error(`${fnName} is not a mutation`)

    validateArgs(fn, args)

    const reader = new D1Reader(sql, tableColumns)
    const latestTs = await getLatestTs(sql)
    const writeSet: WriteSetEntry[] = []
    const ops = createDbOps(sql, reader, writeSet, latestTs)
    const dbWriter = new DatabaseWriter(ops)
    const cronManager = new D1CronManager(sql)
    const storageOps = createD1StorageOps(sql)

    const result = await fn.handler(
      { db: dbWriter, scheduler: cronManager.createScheduler(), storage: new StorageWriter(storageOps) },
      args,
    )
    validateReturnValue(fnName, fn, result)

    // Commit writes atomically via D1 batch
    if (writeSet.length > 0) {
      const commitTs = latestTs + 1
      const writer = new D1Writer(db, tableColumns)
      await writer.commitWrites(writeSet, commitTs)
    }

    return result
  }

  async function executeAction(
    db: D1Database,
    sql: AsyncSqlApi,
    fnName: string,
    args: unknown,
  ): Promise<unknown> {
    const fn = config.functions[fnName]
    if (!fn) throw new Error(`Function not found: ${fnName}`)
    if (fn.type !== "action") throw new Error(`${fnName} is not an action`)

    validateArgs(fn, args)

    const cronManager = new D1CronManager(sql)
    const storageOps = createD1StorageOps(sql)

    const ctx: ActionCtx<any> = {
      runQuery: async <T>(qName: string, qArgs?: Record<string, unknown>): Promise<T> => {
        return executeQuery(db, sql, qName, qArgs ?? {}) as Promise<T>
      },
      runMutation: async <T>(mName: string, mArgs?: Record<string, unknown>): Promise<T> => {
        return executeMutation(db, sql, mName, mArgs ?? {}) as Promise<T>
      },
      runAction: async <T>(aName: string, aArgs?: Record<string, unknown>): Promise<T> => {
        return executeAction(db, sql, aName, aArgs ?? {}) as Promise<T>
      },
      scheduler: cronManager.createScheduler(),
      storage: new StorageActions(storageOps),
    }

    const result = await fn.handler(ctx, args)
    validateReturnValue(fnName, fn, result)
    return result
  }

  function validateArgs(fn: FunctionDef, args: unknown): void {
    if (fn.argsValidator && Object.keys(fn.argsValidator).length > 0) {
      const argsSchema = {
        type: "object" as const,
        value: Object.fromEntries(
          Object.entries(fn.argsValidator).map(([k, v]) => [k, v.json])
        ),
      }
      validate(args, argsSchema)
    }
  }

  function createD1StorageOps(sql: AsyncSqlApi) {
    return {
      generateUploadUrl: async () => {
        throw new Error("Storage upload URLs are not yet supported in D1 mode")
      },
      getUrl: async (storageId: string) => {
        const rows = (await sql.exec(
          `SELECT id FROM _storage WHERE id = ?`, storageId
        )).toArray()
        if (rows.length === 0) return null
        return `/storage/${storageId}`
      },
      getMetadata: async (storageId: string) => {
        const rows = (await sql.exec(
          `SELECT id, sha256, content_type, size FROM _storage WHERE id = ?`, storageId
        )).toArray() as { id: string; sha256: string; content_type: string; size: number }[]
        if (rows.length === 0) return null
        const row = rows[0]
        return { storageId: row.id, sha256: row.sha256, contentType: row.content_type, size: row.size }
      },
      deleteFile: async (storageId: string) => {
        await sql.exec(`DELETE FROM _storage WHERE id = ?`, storageId)
      },
      store: async (_blob: Blob) => {
        throw new Error("Direct blob storage is not yet supported in D1 mode")
      },
    }
  }

  async function executeScheduledFunction(
    db: D1Database,
    sql: AsyncSqlApi,
    fnName: string,
    args: unknown,
  ): Promise<void> {
    const fn = config.functions[fnName]
    if (!fn) throw new Error(`Function not found: ${fnName}`)

    if (fn.type === "action") {
      await executeAction(db, sql, fnName, args)
    } else if (fn.type === "mutation") {
      await executeMutation(db, sql, fnName, args)
    } else if (fn.type === "query") {
      await executeQuery(db, sql, fnName, args)
    }
  }

  const JSON_HEADERS = { "Content-Type": "application/json" }

  return {
    async fetch(request: Request, env: D1Env): Promise<Response> {
      const url = new URL(request.url)
      const path = url.pathname
      const db = env.DB
      const sql = createD1SqlApi(db)

      try {
        await ensureInitialized(sql)
      } catch (e) {
        console.error("[D1Handler] initialization failed:", e)
        return new Response(
          JSON.stringify({ error: "Database initialization failed", details: errorMessage(e) }),
          { status: 500, headers: JSON_HEADERS }
        )
      }

      // Health check
      if (path === "/health") {
        return new Response("OK")
      }

      // API routes
      if (path === "/api/query" && request.method === "POST") {
        return handleApiCall(db, sql, request, "query")
      }
      if (path === "/api/mutation" && request.method === "POST") {
        return handleApiCall(db, sql, request, "mutation")
      }
      if (path === "/api/action" && request.method === "POST") {
        return handleApiCall(db, sql, request, "action")
      }

      // HTTP actions
      if (config.httpRouter) {
        const handler = config.httpRouter.lookup(request.method, path)
        if (handler) {
          return handleHttpAction(db, sql, handler, request)
        }
      }

      return new Response("Not found", { status: 404 })
    },

    async scheduled(
      _event: { cron: string; scheduledTime: number },
      env: D1Env,
    ): Promise<void> {
      const db = env.DB
      const sql = createD1SqlApi(db)
      await ensureInitialized(sql)

      const cronManager = new D1CronManager(sql)
      await cronManager.initializeCronJobs(config.cronJobsDef)
      await cronManager.processScheduled((fnName, args) =>
        executeScheduledFunction(db, sql, fnName, args)
      )
    },
  }

  async function handleApiCall(
    db: D1Database,
    sql: AsyncSqlApi,
    request: Request,
    type: "query" | "mutation" | "action",
  ): Promise<Response> {
    try {
      const body = await request.json() as { fn: string; args?: unknown }
      const fnName = body.fn
      const args = body.args ?? {}

      const fn = config.functions[fnName]
      if (!fn) {
        return new Response(
          JSON.stringify({ success: false, error: `Function not found: ${fnName}`, code: ErrorCode.NOT_FOUND }),
          { status: 404, headers: JSON_HEADERS }
        )
      }

      if (fn.isInternal) {
        return new Response(
          JSON.stringify({ success: false, error: `Function "${fnName}" is internal`, code: ErrorCode.FORBIDDEN }),
          { status: 403, headers: JSON_HEADERS }
        )
      }

      if (fn.type !== type) {
        return new Response(
          JSON.stringify({ success: false, error: `${fnName} is a ${fn.type}, not a ${type}`, code: ErrorCode.EXECUTION_ERROR }),
          { status: 400, headers: JSON_HEADERS }
        )
      }

      let result: unknown
      switch (type) {
        case "query": result = await executeQuery(db, sql, fnName, args); break
        case "mutation": result = await executeMutation(db, sql, fnName, args); break
        case "action": result = await executeAction(db, sql, fnName, args); break
      }

      return new Response(
        JSON.stringify({ success: true, result }),
        { status: 200, headers: JSON_HEADERS }
      )
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, error: errorMessage(e), code: ErrorCode.EXECUTION_ERROR }),
        { status: 500, headers: JSON_HEADERS }
      )
    }
  }

  async function handleHttpAction(
    db: D1Database,
    sql: AsyncSqlApi,
    handler: HttpActionHandler,
    req: Request,
  ): Promise<Response> {
    try {
      const cronManager = new D1CronManager(sql)
      const storageOps = createD1StorageOps(sql)

      const ctx: ActionCtx<any> = {
        runQuery: async <T>(qName: string, qArgs?: Record<string, unknown>): Promise<T> => {
          return executeQuery(db, sql, qName, qArgs ?? {}) as Promise<T>
        },
        runMutation: async <T>(mName: string, mArgs?: Record<string, unknown>): Promise<T> => {
          return executeMutation(db, sql, mName, mArgs ?? {}) as Promise<T>
        },
        runAction: async <T>(aName: string, aArgs?: Record<string, unknown>): Promise<T> => {
          return executeAction(db, sql, aName, aArgs ?? {}) as Promise<T>
        },
        scheduler: cronManager.createScheduler(),
        storage: new StorageActions(storageOps),
      }

      return await handler(ctx, req)
    } catch (e) {
      console.error("HTTP action error:", e)
      return new Response(
        JSON.stringify({ error: errorMessage(e) }),
        { status: 500, headers: JSON_HEADERS }
      )
    }
  }
}

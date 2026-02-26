import { DurableObject } from "cloudflare:workers";
import type { FilterExpressionJSON, IndexQueryJSON, DbOps, SchemaJSON } from "@vex/server";
import { DatabaseReader, DatabaseWriter } from "@vex/server";
import { validate } from "@vex/values";
import { DOSQLiteReader } from "./db/DOSQLiteReader";
import { DOSQLiteWriter } from "./db/DOSQLiteWriter";
import { applyFilter, applyLimit, evaluateFilter, compileFilterToSQL } from "./db/FilterEngine";
import { TransactionStore } from "./transaction/TransactionStore";
import { SubscriptionManager } from "./subscriptions/SubscriptionManager";
import { ConnectionManager } from "./websocket/ConnectionManager";
import type { ClientMessage, ServerMessage } from "./websocket/Protocol";
import { functions as bundledFunctions, schema as bundledSchema, httpRouter as bundledHttpRouter, cronJobsDef as bundledCrons } from "./_functions.generated";
import type { CronSchedule, CronJobDef } from "@vex/server";
import { getNextRunTime } from "@vex/server";

type FunctionDef = {
  type: "query" | "mutation" | "action";
  isInternal: boolean;
  handler: (ctx: any, args: any) => Promise<any>;
  argsValidator?: Record<string, { json: any }>;
  returnsValidator?: { json: any };
};

export class TenantBackend extends DurableObject {
  private latestTs: number = 0;
  private transactions: TransactionStore;
  private subscriptions: SubscriptionManager;
  private connections: ConnectionManager;
  private functions: Record<string, FunctionDef> = {};
  private schemaInfo: SchemaJSON;
  private sql;
  private reader: DOSQLiteReader;
  private writer: DOSQLiteWriter;

  /** Prune transaction_log every N mutations. */
  private static readonly PRUNE_INTERVAL = 100;
  /** Keep the last N transaction timestamps in the log. */
  private static readonly PRUNE_KEEP_COUNT = 1000;
  private mutationsSincePrune = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.transactions = new TransactionStore();
    this.subscriptions = new SubscriptionManager();
    this.connections = new ConnectionManager();
    this.sql = ctx.storage.sql;
    this.schemaInfo = bundledSchema as SchemaJSON;

    // Inject default by_creation_time and by_id indexes on every table
    for (const tableInfo of Object.values(this.schemaInfo.tables)) {
      if (!tableInfo.indexes) tableInfo.indexes = [];
      if (!tableInfo.indexes.some((i) => i.name === "by_creation_time")) {
        tableInfo.indexes.push({ name: "by_creation_time", fields: ["_creationTime"] });
      }
      if (!tableInfo.indexes.some((i) => i.name === "by_id")) {
        tableInfo.indexes.push({ name: "by_id", fields: ["_id"] });
      }
    }

    this.initializeTables();
    this.initializeIndexTables();

    this.reader = new DOSQLiteReader(this.sql);
    this.writer = new DOSQLiteWriter(this.sql);
    this.loadLatestTs();

    // Update SQLite query planner statistics
    this.sql.exec("PRAGMA optimize");

    // Load bundled user functions
    this.functions = bundledFunctions;

    // Restore WebSocket connections after hibernation
    this.restoreConnectionsFromHibernation();

    // Register cron jobs
    this.initializeCronJobs();
  }

  /** Re-register WebSocket connections that survived DO hibernation. */
  private restoreConnectionsFromHibernation(): void {
    const existingWs = this.ctx.getWebSockets();
    if (existingWs.length === 0) return;

    for (const ws of existingWs) {
      const tags = this.ctx.getTags(ws);
      const connectionId = tags[0];
      if (connectionId) {
        this.connections.add(ws, connectionId);
        // Subscriptions were lost — ask client to re-subscribe
        ws.send('{"type":"reset"}');
      }
    }
  }

  /** Sync cron job definitions from code into SQLite and set the next alarm. */
  private initializeCronJobs(): void {
    if (!bundledCrons || !bundledCrons.jobs || bundledCrons.jobs.length === 0) return;

    const now = Date.now();
    const definedNames = new Set<string>();

    for (const job of bundledCrons.jobs as CronJobDef[]) {
      definedNames.add(job.name);

      // Check if this cron already exists
      const existing = this.sql.exec(
        `SELECT name, schedule FROM cron_jobs WHERE name = ?`, job.name
      ).toArray() as { name: string; schedule: string }[];

      const scheduleJSON = JSON.stringify(job.schedule);

      if (existing.length === 0) {
        // New cron — compute first run time
        const nextRun = getNextRunTime(job.schedule, now);
        this.sql.exec(
          `INSERT INTO cron_jobs (name, fn_name, args, schedule, next_run_at) VALUES (?, ?, ?, ?, ?)`,
          job.name, job.fnName, JSON.stringify(job.args), scheduleJSON, nextRun
        );
      } else if (existing[0].schedule !== scheduleJSON) {
        // Schedule changed — recompute next run time
        const nextRun = getNextRunTime(job.schedule, now);
        this.sql.exec(
          `UPDATE cron_jobs SET fn_name = ?, args = ?, schedule = ?, next_run_at = ? WHERE name = ?`,
          job.fnName, JSON.stringify(job.args), scheduleJSON, nextRun, job.name
        );
      }
    }

    // Remove crons no longer defined in code
    const allCrons = this.sql.exec(`SELECT name FROM cron_jobs`).toArray() as { name: string }[];
    for (const row of allCrons) {
      if (!definedNames.has(row.name)) {
        this.sql.exec(`DELETE FROM cron_jobs WHERE name = ?`, row.name);
      }
    }

    // Ensure alarm is set for the earliest due time (crons + scheduled jobs)
    this.ensureNextAlarm();
  }

  /** Set the DO alarm to the earliest pending scheduled job or cron job. */
  private ensureNextAlarm(): void {
    const scheduledNext = this.sql.exec(
      `SELECT MIN(run_at) as next FROM scheduled_jobs WHERE status = 'pending'`
    ).toArray() as { next: number | null }[];

    const cronNext = this.sql.exec(
      `SELECT MIN(next_run_at) as next FROM cron_jobs`
    ).toArray() as { next: number | null }[];

    const times: number[] = [];
    if (scheduledNext[0]?.next != null) times.push(scheduledNext[0].next);
    if (cronNext[0]?.next != null) times.push(cronNext[0].next);

    if (times.length > 0) {
      this.ctx.storage.setAlarm(Math.min(...times));
    }
  }

  private initializeTables(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS transaction_log (
        ts INTEGER NOT NULL,
        table_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        data TEXT,
        inserted_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS document_index (
        table_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        data TEXT,
        PRIMARY KEY (table_name, document_id)
      );
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        run_at REAL NOT NULL,
        fn_name TEXT NOT NULL,
        args TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS scheduled_jobs_run_at ON scheduled_jobs (run_at) WHERE status = 'pending';
      CREATE TABLE IF NOT EXISTS cron_jobs (
        name TEXT PRIMARY KEY,
        fn_name TEXT NOT NULL,
        args TEXT NOT NULL,
        schedule TEXT NOT NULL,
        next_run_at REAL NOT NULL,
        last_run_at REAL
      );
      CREATE INDEX IF NOT EXISTS cron_jobs_next_run ON cron_jobs (next_run_at);
    `);
    // Migrate: if old schema had PK (table_name, document_id, ts), deduplicate rows.
    // This is a one-time migration that keeps only the latest ts per document.
    this.migrateDocumentIndex();
  }

  private migrateDocumentIndex(): void {
    // Check if duplicate rows exist (old schema with ts in PK)
    const dupes = this.sql.exec(
      `SELECT COUNT(*) as cnt FROM (
        SELECT document_id FROM document_index GROUP BY table_name, document_id HAVING COUNT(*) > 1
      )`
    ).toArray() as { cnt: number }[];
    if ((dupes[0]?.cnt ?? 0) === 0) return;

    // Keep only the latest version per (table_name, document_id)
    this.sql.exec(`
      DELETE FROM document_index WHERE rowid NOT IN (
        SELECT rowid FROM (
          SELECT rowid, ROW_NUMBER() OVER (PARTITION BY table_name, document_id ORDER BY ts DESC) AS rn
          FROM document_index
        ) WHERE rn = 1
      )
    `);
  }

  private initializeIndexTables(): void {
    for (const [tableName, tableInfo] of Object.entries(this.schemaInfo.tables)) {
      for (const index of tableInfo.indexes || []) {
        const idxTable = `idx_${tableName}_${index.name}`;
        const colDefs = index.fields.map((_, i) => `c${i}`).join(", ");
        const indexCols = [...index.fields.map((_, i) => `c${i}`), "_creationTime"].join(", ");

        // Migrate: old schema stored full document copy in 'data' column.
        // New schema only stores indexed columns — documents are JOINed on read.
        if (this.indexTableNeedsMigration(idxTable)) {
          this.sql.exec(`DROP TABLE IF EXISTS "${idxTable}"`);
        }

        this.sql.exec(`
          CREATE TABLE IF NOT EXISTS "${idxTable}" (
            document_id TEXT PRIMARY KEY,
            ${colDefs},
            _creationTime REAL
          );
        `);

        this.sql.exec(`
          CREATE INDEX IF NOT EXISTS "${idxTable}_sort" ON "${idxTable}" (${indexCols});
        `);

        // Rebuild index from document_index after migration (or fresh create with existing data)
        const count = (this.sql.exec(`SELECT COUNT(*) as cnt FROM "${idxTable}"`).toArray() as { cnt: number }[])[0]?.cnt ?? 0;
        if (count === 0) {
          this.rebuildIndex(tableName, index);
        }
      }
    }
  }

  private indexTableNeedsMigration(idxTable: string): boolean {
    const info = this.sql.exec(`PRAGMA table_info("${idxTable}")`).toArray() as { name: string }[];
    if (info.length === 0) return false; // Table doesn't exist yet
    return info.some((c) => c.name === "data");
  }

  private rebuildIndex(tableName: string, index: { name: string; fields: string[] }): void {
    const idxTable = `idx_${tableName}_${index.name}`;
    const docs = this.sql.exec(
      `SELECT document_id, data FROM document_index WHERE table_name = ?`, tableName
    ).toArray() as { document_id: string; data: string }[];

    if (docs.length === 0) return;

    const colNames = ["document_id", ...index.fields.map((_, i) => `c${i}`), "_creationTime"];
    const rowPlaceholder = `(${colNames.map(() => "?").join(", ")})`;
    const chunkSize = Math.floor(100 / colNames.length);

    for (let i = 0; i < docs.length; i += chunkSize) {
      const chunk = docs.slice(i, i + chunkSize);
      const values = chunk.map(() => rowPlaceholder).join(", ");
      const params = chunk.flatMap((row) => {
        const doc = JSON.parse(row.data);
        return [row.document_id, ...index.fields.map((f) => doc[f]), doc._creationTime ?? 0];
      });
      this.sql.exec(
        `INSERT OR REPLACE INTO "${idxTable}" (${colNames.join(", ")}) VALUES ${values}`,
        ...params
      );
    }
  }

  private async loadLatestTs(): Promise<void> {
    const stored = await this.ctx.storage.get<number>("latestTs");
    this.latestTs = stored ?? 0;
  }

  private async saveLatestTs(): Promise<void> {
    await this.ctx.storage.put("latestTs", this.latestTs);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/ws") {
      return this.handleWebSocketUpgrade(req);
    }

    if (path === "/health") {
      return new Response("OK");
    }

    // HTTP actions — user-defined routes
    if (bundledHttpRouter) {
      const handler = bundledHttpRouter.lookup(req.method, path);
      if (handler) {
        return this.handleHttpAction(handler, req);
      }
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleHttpAction(
    handler: (ctx: any, request: Request) => Promise<Response>,
    req: Request
  ): Promise<Response> {
    try {
      const ctx = this.createActionCtx();
      return await handler(ctx, req);
    } catch (e) {
      console.error("HTTP action error:", e);
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  private handleWebSocketUpgrade(req: Request): Response {
    if (this.connections.isFull()) {
      return new Response("Too many connections", { status: 503 });
    }

    const { 0: server, 1: client } = new WebSocketPair();
    const connectionId = crypto.randomUUID();

    this.ctx.acceptWebSocket(server, [connectionId]);
    this.connections.add(server, connectionId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    const connId = this.connections.get(ws);
    if (!connId) return;

    // Rate limiting
    if (!this.connections.checkRateLimit(connId)) {
      ws.send(JSON.stringify({
        type: "error",
        code: "rate_limited",
        message: "Too many requests — slow down",
      } as ServerMessage));
      return;
    }

    const msg = JSON.parse(message) as ClientMessage;

    switch (msg.type) {
      case "query":
        await this.handleQuery(connId, msg);
        break;
      case "mutation":
        await this.handleMutation(connId, msg);
        break;
      case "action":
        await this.handleAction(connId, msg);
        break;
      case "unsubscribe":
        this.handleUnsubscribe(connId, msg);
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.connections.remove(ws);
    this.subscriptions.removeAll(ws);
  }

  // -- DbOps: direct in-process SQLite access --

  private createDbOps(txId: string): DbOps {
    return {
      query: async (table, filter, orderField, orderDirection, limit, indexQuery) => {
        const tx = this.transactions.get(txId);
        if (!tx) throw new Error("Invalid transaction");

        let rows: unknown[];
        let docEntries: { documentId: string; data: unknown; ts: number }[];

        if (indexQuery) {
          // Use index table for efficient querying
          // Only push LIMIT to SQL when there's no additional JS filter
          const sqlLimit = filter ? null : limit;
          const indexResults = this.queryByIndex(table, indexQuery, orderDirection, sqlLimit);
          rows = indexResults.map((r) => r.data);
          rows = applyFilter(rows, filter);
          rows = applyLimit(rows, limit);

          docEntries = indexResults.map((r) => ({ documentId: r.documentId, data: r.data, ts: tx.beginTs }));

          // Build combined filter for query descriptor (index ranges + user filter)
          const indexFilter = indexRangesToFilter(indexQuery.ranges);
          const combinedFilter = filter && indexFilter
            ? { op: "and" as const, exprs: [indexFilter, filter] }
            : (indexFilter || filter);
          this.transactions.addQueryDescriptor(txId, { table, filter: combinedFilter });
        } else {
          // Push filter/order/limit down to SQL
          const docs = this.queryFullScan(table, tx.beginTs, filter, orderField, orderDirection, limit);
          rows = docs.map((d) => d.data);
          docEntries = docs;
          this.transactions.addQueryDescriptor(txId, { table, filter });
        }

        for (const doc of docEntries) {
          this.transactions.addRead(txId, { table, documentId: doc.documentId, ts: doc.ts });
        }
        return rows;
      },

      get: async (table, id) => {
        const tx = this.transactions.get(txId);
        if (!tx) throw new Error("Invalid transaction");

        const doc = await this.reader.getDocument(table, id, tx.beginTs);
        if (doc) {
          this.transactions.addRead(txId, { table, documentId: id, ts: doc.ts });
        }
        return doc?.data ?? null;
      },

      getMany: async (table, ids) => {
        const tx = this.transactions.get(txId);
        if (!tx) throw new Error("Invalid transaction");

        const docs = this.reader.getDocuments(table, ids, tx.beginTs);
        const result = new Map<string, any>();
        for (const id of ids) {
          const doc = docs.get(id);
          if (doc) {
            this.transactions.addRead(txId, { table, documentId: id, ts: doc.ts });
            result.set(id, doc.data);
          } else {
            result.set(id, null);
          }
        }
        return result;
      },

      insert: async (table, id, data) => {
        this.transactions.addWrite(txId, { table, documentId: id, data });
      },

      patch: async (table, id, fields) => {
        const tx = this.transactions.get(txId);
        if (!tx) throw new Error("Invalid transaction");
        const existing = await this.reader.getDocument(table, id, tx.beginTs);
        if (!existing) throw new Error(`Document ${id} not found`);
        const merged = { ...(existing.data as any), ...fields };
        this.transactions.addWrite(txId, { table, documentId: id, data: merged });
      },

      replace: async (table, id, data) => {
        this.transactions.addWrite(txId, { table, documentId: id, data });
      },

      delete: async (table, id) => {
        this.transactions.addWrite(txId, { table, documentId: id, data: null });
      },
    };
  }

  // -- Function execution --

  private async invokeFunction(
    fnName: string,
    args: unknown,
    txId: string
  ): Promise<{ result: unknown; readSet: { table: string; documentId: string; ts: number }[]; queryDescriptors: { table: string; filter: FilterExpressionJSON | null }[] }> {
    const fn = this.functions[fnName];
    if (!fn) {
      throw new Error(`Function not found: ${fnName}. Available: ${Object.keys(this.functions).join(", ")}`);
    }

    // Validate args against the function's declared validators
    if (fn.argsValidator && Object.keys(fn.argsValidator).length > 0) {
      const argsSchema = {
        type: "object" as const,
        value: Object.fromEntries(
          Object.entries(fn.argsValidator).map(([k, v]) => [k, v.json])
        ),
      };
      validate(args, argsSchema);
    }

    if (fn.type === "action") {
      // Actions don't get direct db access — they use runQuery/runMutation
      const ctx = this.createActionCtx();
      const result = await fn.handler(ctx, args);
      this.validateReturnValue(fnName, fn, result);
      return { result, readSet: [], queryDescriptors: [] };
    }

    const ops = this.createDbOps(txId);
    const db = fn.type === "query"
      ? new DatabaseReader(ops)
      : new DatabaseWriter(ops);

    const result = await fn.handler({ db, scheduler: this.createScheduler() }, args);
    this.validateReturnValue(fnName, fn, result);

    const tx = this.transactions.get(txId);
    return {
      result,
      readSet: tx ? [...tx.readSet] : [],
      queryDescriptors: tx ? [...tx.queryDescriptors] : [],
    };
  }

  private validateReturnValue(fnName: string, fn: FunctionDef, result: unknown): void {
    if (!fn.returnsValidator) return;
    try {
      validate(result, fn.returnsValidator.json);
    } catch (e) {
      throw new Error(`Return value validation failed for "${fnName}": ${e instanceof Error ? e.message : e}`);
    }
  }

  // -- WebSocket handlers --

  private async handleQuery(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const ws = this.connections.getById(connectionId);
    if (!ws) return;

    const fn = this.functions[msg.fn];
    if (fn?.isInternal) {
      ws.send(JSON.stringify({ type: "error", id: msg.id, code: "forbidden", message: `Function "${msg.fn}" is internal and cannot be called from a client` } as ServerMessage));
      return;
    }

    const txId = crypto.randomUUID();
    this.transactions.begin(txId, this.latestTs, "query");

    try {
      const result = await this.invokeFunction(msg.fn, msg.args, txId);
      const resultJSON = JSON.stringify(result.result);

      this.subscriptions.subscribe({
        id: msg.id,
        connectionId,
        ws,
        fnName: msg.fn,
        args: msg.args,
        readSet: result.readSet,
        queryDescriptors: result.queryDescriptors,
        lastResultJSON: resultJSON,
      });

      // Reuse pre-serialized result JSON to avoid double-stringify
      ws.send(
        `{"type":"result","id":${JSON.stringify(msg.id)},"result":${resultJSON}}`
      );
    } catch (e) {
      ws.send(
        JSON.stringify({
          type: "error",
          id: msg.id,
          code: "execution_error",
          message: e instanceof Error ? e.message : "Unknown error",
        } as ServerMessage)
      );
    } finally {
      this.transactions.remove(txId);
    }
  }

  private static readonly MAX_OCC_RETRIES = 5;

  private async handleMutation(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const ws = this.connections.getById(connectionId);
    if (!ws) return;

    const fn = this.functions[msg.fn];
    if (fn?.isInternal) {
      ws.send(JSON.stringify({ type: "error", id: msg.id, code: "forbidden", message: `Function "${msg.fn}" is internal and cannot be called from a client` } as ServerMessage));
      return;
    }

    for (let attempt = 0; attempt <= TenantBackend.MAX_OCC_RETRIES; attempt++) {
      const txId = crypto.randomUUID();
      this.transactions.begin(txId, this.latestTs, "mutation");

      try {
        const result = await this.invokeFunction(msg.fn, msg.args, txId);

        const mutationTx = this.transactions.get(txId);
        const writeSet = mutationTx ? [...mutationTx.writeSet] : [];
        const readSet = mutationTx ? [...mutationTx.readSet] : [];

        // OCC: check for conflicts before committing
        if (readSet.length > 0) {
          const hasConflicts = this.checkConflicts(readSet, mutationTx!.beginTs);
          if (hasConflicts) {
            this.transactions.remove(txId);
            if (attempt < TenantBackend.MAX_OCC_RETRIES) continue; // Retry
            ws.send(
              JSON.stringify({
                type: "error",
                id: msg.id,
                code: "conflict",
                message: "Transaction conflict — max retries exceeded",
              } as ServerMessage)
            );
            return;
          }
        }

        // 1. Enrich deletes with old data (before commit removes them)
        const enrichedWriteSet: { table: string; documentId: string; data: unknown | null; oldData?: unknown }[] = [];
        for (const entry of writeSet) {
          if (entry.data === null) {
            const old = await this.reader.getDocument(entry.table, entry.documentId, this.latestTs);
            enrichedWriteSet.push({ ...entry, oldData: old?.data ?? undefined });
          } else {
            enrichedWriteSet.push(entry);
          }
        }

        // 2. Commit writes
        if (writeSet.length > 0) {
          const commitTs = ++this.latestTs;
          await this.saveLatestTs();
          await this.writer.commitWrites(writeSet, commitTs);
          this.updateIndexTables(writeSet);
        }

        // 3. Send result
        ws.send(
          JSON.stringify({
            type: "mutationResult",
            id: msg.id,
            result: result.result,
          } as ServerMessage)
        );

        this.transactions.remove(txId);

        // 4. Invalidate affected subscriptions (using enriched write set with old data for deletes)
        if (writeSet.length > 0) {
          try {
            await this.subscriptions.invalidate(enrichedWriteSet, async (fnName, args) => {
              const subTxId = crypto.randomUUID();
              this.transactions.begin(subTxId, this.latestTs, "query");
              try {
                return await this.invokeFunction(fnName, args, subTxId);
              } finally {
                this.transactions.remove(subTxId);
              }
            });
          } catch (subError) {
            console.error("Subscription invalidation error:", subError);
          }
        }

        // 5. Periodically prune old transaction log entries
        if (++this.mutationsSincePrune >= TenantBackend.PRUNE_INTERVAL) {
          this.mutationsSincePrune = 0;
          const pruneTs = this.latestTs - TenantBackend.PRUNE_KEEP_COUNT;
          if (pruneTs > 0) {
            this.writer.pruneTransactionLog(pruneTs);
          }
        }

        return; // Success — exit retry loop
      } catch (e) {
        console.error("Mutation error:", e);
        this.transactions.remove(txId);
        ws.send(
          JSON.stringify({
            type: "error",
            id: msg.id,
            code: "execution_error",
            message: e instanceof Error ? e.message : "Unknown error",
          } as ServerMessage)
        );
        return; // Non-OCC errors are not retryable
      }
    }
  }

  private async handleAction(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const ws = this.connections.getById(connectionId);
    if (!ws) return;

    try {
      const fn = this.functions[msg.fn];
      if (!fn) throw new Error(`Function not found: ${msg.fn}`);
      if (fn.isInternal) {
        ws.send(JSON.stringify({ type: "error", id: msg.id, code: "forbidden", message: `Function "${msg.fn}" is internal and cannot be called from a client` } as ServerMessage));
        return;
      }
      if (fn.type !== "action") throw new Error(`${msg.fn} is not an action`);

      // Validate args
      if (fn.argsValidator && Object.keys(fn.argsValidator).length > 0) {
        const argsSchema = {
          type: "object" as const,
          value: Object.fromEntries(
            Object.entries(fn.argsValidator).map(([k, v]) => [k, v.json])
          ),
        };
        validate(msg.args, argsSchema);
      }

      const actionCtx = this.createActionCtx();
      const result = await fn.handler(actionCtx, msg.args);

      ws.send(
        JSON.stringify({
          type: "actionResult",
          id: msg.id,
          result,
        } as ServerMessage)
      );
    } catch (e) {
      ws.send(
        JSON.stringify({
          type: "error",
          id: msg.id,
          code: "execution_error",
          message: e instanceof Error ? e.message : "Unknown error",
        } as ServerMessage)
      );
    }
  }

  private handleUnsubscribe(connectionId: string, msg: { id: string }): void {
    this.subscriptions.remove(msg.id);
  }

  // -- Action context --

  private createActionCtx(): { runQuery: (fnName: string, args?: unknown) => Promise<any>; runMutation: (fnName: string, args?: unknown) => Promise<any>; scheduler: ReturnType<typeof TenantBackend.prototype.createScheduler> } {
    return {
      runQuery: async (fnName: string, args?: unknown) => {
        const fn = this.functions[fnName];
        if (!fn || fn.type !== "query") throw new Error(`Query not found: ${fnName}`);
        const txId = crypto.randomUUID();
        this.transactions.begin(txId, this.latestTs, "query");
        try {
          const result = await this.invokeFunction(fnName, args ?? {}, txId);
          return result.result;
        } finally {
          this.transactions.remove(txId);
        }
      },
      runMutation: async (fnName: string, args?: unknown) => {
        const fn = this.functions[fnName];
        if (!fn || fn.type !== "mutation") throw new Error(`Mutation not found: ${fnName}`);
        // Run the mutation through the same path as handleMutation (with OCC retries)
        for (let attempt = 0; attempt <= TenantBackend.MAX_OCC_RETRIES; attempt++) {
          const txId = crypto.randomUUID();
          this.transactions.begin(txId, this.latestTs, "mutation");
          try {
            const result = await this.invokeFunction(fnName, args ?? {}, txId);
            const mutationTx = this.transactions.get(txId);
            const writeSet = mutationTx ? [...mutationTx.writeSet] : [];
            const readSet = mutationTx ? [...mutationTx.readSet] : [];

            if (readSet.length > 0 && this.checkConflicts(readSet, mutationTx!.beginTs)) {
              this.transactions.remove(txId);
              if (attempt < TenantBackend.MAX_OCC_RETRIES) continue;
              throw new Error("Transaction conflict — max retries exceeded");
            }

            // Enrich deletes
            const enrichedWriteSet: { table: string; documentId: string; data: unknown | null; oldData?: unknown }[] = [];
            for (const entry of writeSet) {
              if (entry.data === null) {
                const old = await this.reader.getDocument(entry.table, entry.documentId, this.latestTs);
                enrichedWriteSet.push({ ...entry, oldData: old?.data ?? undefined });
              } else {
                enrichedWriteSet.push(entry);
              }
            }

            if (writeSet.length > 0) {
              const commitTs = ++this.latestTs;
              await this.saveLatestTs();
              await this.writer.commitWrites(writeSet, commitTs);
              this.updateIndexTables(writeSet);
            }

            this.transactions.remove(txId);

            // Invalidate subscriptions
            if (writeSet.length > 0) {
              await this.subscriptions.invalidate(enrichedWriteSet, async (fn, a) => {
                const subTxId = crypto.randomUUID();
                this.transactions.begin(subTxId, this.latestTs, "query");
                try {
                  return await this.invokeFunction(fn, a, subTxId);
                } finally {
                  this.transactions.remove(subTxId);
                }
              });
            }

            return result.result;
          } catch (e) {
            this.transactions.remove(txId);
            throw e;
          }
        }
      },
      runAction: async (fnName: string, args?: unknown) => {
        const fn = this.functions[fnName];
        if (!fn || fn.type !== "action") throw new Error(`Action not found: ${fnName}`);
        const actionCtx = this.createActionCtx();
        return await fn.handler(actionCtx, args ?? {});
      },
      scheduler: this.createScheduler(),
    };
  }

  // -- Scheduler --

  private createScheduler() {
    return {
      runAfter: async (delayMs: number, fnName: string, args?: unknown): Promise<string> => {
        const runAt = Date.now() + delayMs;
        return this.scheduleJob(runAt, fnName, args ?? {});
      },
      runAt: async (timestamp: number, fnName: string, args?: unknown): Promise<string> => {
        return this.scheduleJob(timestamp, fnName, args ?? {});
      },
      cancel: async (id: string): Promise<void> => {
        this.sql.exec(
          `DELETE FROM scheduled_jobs WHERE id = ? AND status = 'pending'`,
          id
        );
      },
    };
  }

  private async scheduleJob(runAt: number, fnName: string, args: unknown): Promise<string> {
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO scheduled_jobs (id, run_at, fn_name, args, status) VALUES (?, ?, ?, ?, 'pending')`,
      id, runAt, fnName, JSON.stringify(args)
    );

    this.ensureNextAlarm();
    return id;
  }

  /** Execute a function by name and type (used by both scheduler and cron). */
  private async executeScheduledFunction(fnName: string, args: unknown): Promise<void> {
    const fn = this.functions[fnName];
    if (!fn) throw new Error(`Function not found: ${fnName}`);

    if (fn.type === "action") {
      const ctx = this.createActionCtx();
      await fn.handler(ctx, args);
    } else if (fn.type === "mutation") {
      const ctx = this.createActionCtx();
      await ctx.runMutation(fnName, args);
    } else if (fn.type === "query") {
      const txId = crypto.randomUUID();
      this.transactions.begin(txId, this.latestTs, "query");
      try {
        await this.invokeFunction(fnName, args, txId);
      } finally {
        this.transactions.remove(txId);
      }
    }
  }

  /** Cloudflare DO alarm handler — executes due scheduled jobs and cron jobs. */
  async alarm(): Promise<void> {
    const now = Date.now();

    // 1. Process due scheduled jobs
    const dueJobs = this.sql.exec(
      `SELECT id, fn_name, args FROM scheduled_jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at`,
      now
    ).toArray() as { id: string; fn_name: string; args: string }[];

    for (const job of dueJobs) {
      this.sql.exec(`UPDATE scheduled_jobs SET status = 'running' WHERE id = ?`, job.id);
      try {
        await this.executeScheduledFunction(job.fn_name, JSON.parse(job.args));
        this.sql.exec(`UPDATE scheduled_jobs SET status = 'completed' WHERE id = ?`, job.id);
      } catch (e) {
        console.error(`Scheduled job ${job.id} (${job.fn_name}) failed:`, e);
        this.sql.exec(`UPDATE scheduled_jobs SET status = 'failed' WHERE id = ?`, job.id);
      }
    }

    // Clean up completed/failed scheduled jobs
    this.sql.exec(`DELETE FROM scheduled_jobs WHERE status IN ('completed', 'failed')`);

    // 2. Process due cron jobs
    const dueCrons = this.sql.exec(
      `SELECT name, fn_name, args, schedule FROM cron_jobs WHERE next_run_at <= ?`,
      now
    ).toArray() as { name: string; fn_name: string; args: string; schedule: string }[];

    for (const cron of dueCrons) {
      try {
        await this.executeScheduledFunction(cron.fn_name, JSON.parse(cron.args));
      } catch (e) {
        console.error(`Cron job "${cron.name}" (${cron.fn_name}) failed:`, e);
      }

      // Compute next run time regardless of success/failure
      const schedule = JSON.parse(cron.schedule) as CronSchedule;
      const nextRun = getNextRunTime(schedule, now);
      this.sql.exec(
        `UPDATE cron_jobs SET last_run_at = ?, next_run_at = ? WHERE name = ?`,
        now, nextRun, cron.name
      );
    }

    // 3. Set the next alarm
    this.ensureNextAlarm();
  }

  // -- Index queries --

  private queryByIndex(
    table: string,
    indexQuery: IndexQueryJSON,
    orderDirection: "asc" | "desc",
    limit: number | null = null
  ): { documentId: string; data: unknown }[] {
    const tableSchema = this.schemaInfo.tables[table];
    if (!tableSchema) return [];

    const index = tableSchema.indexes.find((i) => i.name === indexQuery.indexName);
    if (!index) throw new Error(`Index "${indexQuery.indexName}" not found on table "${table}"`);

    const idxTable = `idx_${table}_${indexQuery.indexName}`;
    const conditions: string[] = [];
    const params: unknown[] = [table]; // For the JOIN condition

    for (const range of indexQuery.ranges) {
      const fieldIdx = index.fields.indexOf(range.field);
      if (fieldIdx === -1) throw new Error(`Field "${range.field}" not in index "${indexQuery.indexName}"`);
      const col = `i.c${fieldIdx}`;
      switch (range.op) {
        case "eq": conditions.push(`${col} = ?`); break;
        case "gt": conditions.push(`${col} > ?`); break;
        case "gte": conditions.push(`${col} >= ?`); break;
        case "lt": conditions.push(`${col} < ?`); break;
        case "lte": conditions.push(`${col} <= ?`); break;
      }
      params.push(range.value);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const order = orderDirection === "desc" ? "DESC" : "ASC";

    // JOIN with document_index to get the full document (no longer stored in index table)
    let sql = `SELECT i.document_id, d.data FROM "${idxTable}" i
      JOIN document_index d ON d.table_name = ? AND d.document_id = i.document_id
      ${where} ORDER BY i._creationTime ${order}`;

    if (limit != null) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    const results = this.sql.exec(sql, ...params).toArray() as { document_id: string; data: string }[];

    return results.map((r) => ({
      documentId: r.document_id,
      data: JSON.parse(r.data),
    }));
  }

  // -- Full-scan queries with SQL pushdown --

  private queryFullScan(
    table: string,
    asOfTs: number,
    filter: FilterExpressionJSON | null,
    orderField: string | null,
    orderDirection: "asc" | "desc",
    limit: number | null
  ): { documentId: string; data: unknown; ts: number }[] {
    const compiled = filter ? compileFilterToSQL(filter) : null;
    const filterPushed = !filter || compiled !== null;
    const params: unknown[] = [table, asOfTs];

    // PK is (table_name, document_id) — one row per doc, no dedup needed
    let sql = `SELECT document_id, ts, data FROM document_index
      WHERE table_name = ? AND ts <= ?`;

    // Push filter to SQL
    if (compiled) {
      sql += ` AND ${compiled.sql}`;
      params.push(...compiled.params);
    }

    // ORDER BY
    if (orderField) {
      sql += ` ORDER BY json_extract(data, ?) ${orderDirection === "desc" ? "DESC" : "ASC"}`;
      params.push(`$.${orderField}`);
    }

    // LIMIT (only when filter was pushed or no filter)
    if (limit != null && filterPushed) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    const results = this.sql.exec(sql, ...params).toArray() as { document_id: string; ts: number; data: string }[];

    let docs = results.map((r) => ({
      documentId: r.document_id,
      data: JSON.parse(r.data) as unknown,
      ts: r.ts,
    }));

    // JS fallback if filter couldn't be compiled to SQL
    if (filter && !filterPushed) {
      docs = docs.filter((d) => evaluateFilter(d.data, filter));
      if (limit != null) docs = docs.slice(0, limit);
    }

    return docs;
  }

  // -- Index table maintenance --

  private updateIndexTables(writeSet: { table: string; documentId: string; data: unknown | null }[]): void {
    // Group operations by index table for batching
    const ops = new Map<string, {
      fields: string[];
      deletes: string[];
      upserts: { documentId: string; vals: unknown[]; creationTime: number }[];
    }>();

    for (const entry of writeSet) {
      const tableSchema = this.schemaInfo.tables[entry.table];
      if (!tableSchema?.indexes) continue;

      for (const index of tableSchema.indexes) {
        const idxTable = `idx_${entry.table}_${index.name}`;
        let op = ops.get(idxTable);
        if (!op) {
          op = { fields: index.fields, deletes: [], upserts: [] };
          ops.set(idxTable, op);
        }

        if (entry.data === null) {
          op.deletes.push(entry.documentId);
        } else {
          const doc = entry.data as Record<string, unknown>;
          op.upserts.push({
            documentId: entry.documentId,
            vals: index.fields.map((f) => doc[f]),
            creationTime: (doc._creationTime as number) ?? Date.now(),
          });
        }
      }
    }

    // Execute one statement per index table (instead of one per document)
    for (const [idxTable, { fields, deletes, upserts }] of ops) {
      if (deletes.length > 0) {
        const placeholders = deletes.map(() => "?").join(", ");
        this.sql.exec(
          `DELETE FROM "${idxTable}" WHERE document_id IN (${placeholders})`,
          ...deletes
        );
      }

      if (upserts.length > 0) {
        const colNames = ["document_id", ...fields.map((_, i) => `c${i}`), "_creationTime"];
        const colList = colNames.join(", ");
        const rowPlaceholder = `(${colNames.map(() => "?").join(", ")})`;
        const chunkSize = Math.floor(100 / colNames.length);

        for (let i = 0; i < upserts.length; i += chunkSize) {
          const chunk = upserts.slice(i, i + chunkSize);
          const values = chunk.map(() => rowPlaceholder).join(", ");
          const params = chunk.flatMap((u) => [u.documentId, ...u.vals, u.creationTime]);
          this.sql.exec(
            `INSERT OR REPLACE INTO "${idxTable}" (${colList}) VALUES ${values}`,
            ...params
          );
        }
      }
    }
  }

  // -- OCC --

  private checkConflicts(
    readSet: { table: string; documentId: string; ts: number }[],
    beginTs: number
  ): boolean {
    if (readSet.length === 0) return false;

    const conditions: string[] = [];
    const params: unknown[] = [];

    for (const entry of readSet) {
      conditions.push(`(table_name = ? AND document_id = ? AND ts > ?)`);
      params.push(entry.table, entry.documentId, beginTs);
    }

    const query = `SELECT COUNT(*) as count FROM document_index WHERE ${conditions.join(" OR ")}`;
    const results = this.sql.exec(query, ...params).toArray() as { count: number }[];
    return (results[0]?.count ?? 0) > 0;
  }

}

function indexRangesToFilter(
  ranges: IndexQueryJSON["ranges"]
): FilterExpressionJSON | null {
  if (ranges.length === 0) return null;

  const exprs: FilterExpressionJSON[] = ranges.map((r) => ({
    op: r.op,
    a: { op: "field" as const, path: r.field },
    b: { op: "literal" as const, value: r.value },
  }));

  if (exprs.length === 1) return exprs[0];
  return { op: "and", exprs };
}

export interface Env {
  TENANT_BACKEND: DurableObjectNamespace;
}

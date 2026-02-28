import { ulid } from "ulidx";
import { DurableObject } from "cloudflare:workers";
import type { FilterExpressionJSON, IndexQueryJSON, DbOps, SchemaJSON, KeysetCursorInfo, SearchQueryJSON, StorageOps, StorageMetadata } from "@vex/server";
import { DatabaseReader, DatabaseWriter, StorageReader, StorageWriter, StorageActions } from "@vex/server";
import { validate } from "@vex/values";
import { DOSQLiteReader } from "./db/DOSQLiteReader";
import { DOSQLiteWriter } from "./db/DOSQLiteWriter";
import { applyFilter, applyLimit, evaluateFilter, compileFilterToSQL } from "./db/FilterEngine";
import { generateTableDDL, buildTableColumns, sqlRowToDoc, migrateSchema } from "./db/SchemaMapper";
import type { TableColumnInfo } from "./db/SchemaMapper";
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

/** Max bound parameters per SQL statement on Cloudflare DO SQLite. */
const MAX_PARAMS = 100;

export class VexDO extends DurableObject {
  private latestTs: number = 0;
  private transactions: TransactionStore;
  private subscriptions: SubscriptionManager;
  private connections: ConnectionManager;
  private functions: Record<string, FunctionDef> = {};
  private schemaInfo: SchemaJSON;
  private sql;
  private reader: DOSQLiteReader;
  private writer: DOSQLiteWriter;
  private tableColumns: Map<string, TableColumnInfo>;
  private uploadTokens = new Map<string, { expiresAt: number }>();
  private baseUrl: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.transactions = new TransactionStore();
    this.subscriptions = new SubscriptionManager();
    this.connections = new ConnectionManager();
    this.sql = ctx.storage.sql;
    this.schemaInfo = bundledSchema as SchemaJSON;

    // Inject default by_id index on every table
    for (const tableInfo of Object.values(this.schemaInfo.tables)) {
      if (!tableInfo.indexes) tableInfo.indexes = [];
      if (!tableInfo.indexes.some((i) => i.name === "by_id")) {
        tableInfo.indexes.push({ name: "by_id", fields: ["_id"] });
      }
    }

    this.tableColumns = buildTableColumns(this.schemaInfo);
    this.initializeTables();

    this.reader = new DOSQLiteReader(this.sql, this.tableColumns);
    this.writer = new DOSQLiteWriter(this.sql, this.tableColumns);
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
    // System tables
    this.sql.exec(`
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
      CREATE TABLE IF NOT EXISTS _storage (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        created_at REAL NOT NULL
      );
    `);

    // User tables from schema — migrate if needed
    try {
      migrateSchema(this.sql, this.schemaInfo);
    } catch (e) {
      console.error("[migration] failed, falling back to CREATE IF NOT EXISTS:", e);
      for (const [tableName, tableInfo] of Object.entries(this.schemaInfo.tables)) {
        for (const stmt of generateTableDDL(tableName, tableInfo)) {
          this.sql.exec(stmt);
        }
      }
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

    // Capture base URL from Worker header (used for storage URLs)
    const headerBaseUrl = req.headers.get("X-Vex-Base-Url");
    if (headerBaseUrl && !this.baseUrl) {
      this.baseUrl = headerBaseUrl;
    }

    if (path === "/ws") {
      return this.handleWebSocketUpgrade(req);
    }

    if (path === "/health") {
      return new Response("OK");
    }

    if (path === "/__dev/reset" && req.method === "POST") {
      return this.handleDevReset();
    }

    // Internal storage routes (called by Worker)
    if (path === "/__internal/validate-upload" && req.method === "POST") {
      return this.handleValidateUpload(url);
    }
    if (path === "/__internal/storage-record" && req.method === "POST") {
      return this.handleStorageRecord(req);
    }
    if (path === "/__internal/storage-delete" && req.method === "POST") {
      return this.handleStorageDelete(req);
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

  private handleDevReset(): Response {
    // Delete all rows from user tables
    for (const tableName of Object.keys(this.schemaInfo.tables)) {
      this.sql.exec(`DELETE FROM "${tableName}"`);
    }

    // Clear storage metadata and R2 objects
    const storageRows = this.sql.exec(`SELECT r2_key FROM _storage`).toArray() as { r2_key: string }[];
    if (storageRows.length > 0) {
      const r2 = (this.env as any).VEX_STORAGE as R2Bucket | undefined;
      if (r2) {
        for (const row of storageRows) {
          r2.delete(row.r2_key);
        }
      }
    }
    this.sql.exec(`DELETE FROM _storage`);
    this.uploadTokens.clear();

    // Reset timestamp
    this.latestTs = 0;
    this.ctx.storage.put("latestTs", 0);

    // Clear subscriptions
    this.subscriptions.clearAll();

    // Notify all connected clients to re-subscribe
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send('{"type":"reset"}');
      } catch {}
    }

    return new Response("OK");
  }

  // -- Internal storage routes --

  private handleValidateUpload(url: URL): Response {
    const token = url.searchParams.get("token");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const entry = this.uploadTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      this.uploadTokens.delete(token!);
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    // One-time use
    this.uploadTokens.delete(token);

    return new Response(
      JSON.stringify({ valid: true, doId: this.ctx.id.toString() }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  private async handleStorageRecord(req: Request): Promise<Response> {
    const body = await req.json() as { storageId: string; sha256: string; contentType: string; size: number; r2Key: string };
    this.sql.exec(
      `INSERT INTO _storage (id, sha256, content_type, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      body.storageId, body.sha256, body.contentType, body.size, body.r2Key, Date.now()
    );
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  private async handleStorageDelete(req: Request): Promise<Response> {
    const body = await req.json() as { storageId: string };
    const rows = this.sql.exec(
      `SELECT r2_key FROM _storage WHERE id = ?`, body.storageId
    ).toArray() as { r2_key: string }[];

    if (rows.length > 0) {
      const r2 = (this.env as any).VEX_STORAGE as R2Bucket | undefined;
      if (r2) {
        await r2.delete(rows[0].r2_key);
      }
      this.sql.exec(`DELETE FROM _storage WHERE id = ?`, body.storageId);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  // -- Storage ops --

  private createStorageOps(): StorageOps {
    const r2 = (this.env as any).VEX_STORAGE as R2Bucket | undefined;
    const doId = this.ctx.id.toString();

    const requireR2 = (): R2Bucket => {
      if (!r2) throw new Error("File storage not configured. Add a [[r2_buckets]] binding named VEX_STORAGE to your wrangler.toml.");
      return r2;
    };

    return {
      generateUploadUrl: async () => {
        requireR2();
        if (!this.baseUrl) throw new Error("Base URL not available — storage requires HTTP request context");
        const token = crypto.randomUUID();
        this.uploadTokens.set(token, { expiresAt: Date.now() + 60_000 });
        return `${this.baseUrl}/storage/upload?token=${token}`;
      },

      getUrl: async (storageId: string) => {
        const rows = this.sql.exec(
          `SELECT id FROM _storage WHERE id = ?`, storageId
        ).toArray();
        if (rows.length === 0) return null;
        if (!this.baseUrl) throw new Error("Base URL not available — storage requires HTTP request context");
        return `${this.baseUrl}/storage/${storageId}`;
      },

      getMetadata: async (storageId: string) => {
        const rows = this.sql.exec(
          `SELECT id, sha256, content_type, size FROM _storage WHERE id = ?`, storageId
        ).toArray() as { id: string; sha256: string; content_type: string; size: number }[];
        if (rows.length === 0) return null;
        const row = rows[0];
        return {
          storageId: row.id,
          sha256: row.sha256,
          contentType: row.content_type,
          size: row.size,
        };
      },

      deleteFile: async (storageId: string) => {
        const bucket = requireR2();
        const rows = this.sql.exec(
          `SELECT r2_key FROM _storage WHERE id = ?`, storageId
        ).toArray() as { r2_key: string }[];
        if (rows.length > 0) {
          await bucket.delete(rows[0].r2_key);
          this.sql.exec(`DELETE FROM _storage WHERE id = ?`, storageId);
        }
      },

      store: async (blob: Blob) => {
        const bucket = requireR2();
        const storageId = `_storage/${crypto.randomUUID()}`;
        const r2Key = `${doId}/${storageId}`;
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        const sha256 = [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
        await bucket.put(r2Key, buffer, {
          httpMetadata: { contentType: blob.type || "application/octet-stream" },
        });
        this.sql.exec(
          `INSERT INTO _storage (id, sha256, content_type, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          storageId, sha256, blob.type || "application/octet-stream", blob.size, r2Key, Date.now()
        );
        return storageId;
      },
    };
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

  // -- Schema validation on writes --

  private validateDocument(table: string, data: Record<string, unknown>): void {
    const tableInfo = this.schemaInfo.tables[table];
    if (!tableInfo) return;
    const { _id, _ts, _creationTime, ...userFields } = data;
    validate(userFields, { type: "object", value: tableInfo.fields });
  }

  // -- DbOps: direct in-process SQLite access --

  private createDbOps(txId: string): DbOps {
    return {
      query: async (table, filter, orderField, orderDirection, limit, indexQuery, keysetCursor, searchQuery) => {
        const tx = this.transactions.get(txId);
        if (!tx) throw new Error("Invalid transaction");

        // Build combined filter for query descriptor (index ranges + user filter)
        // For search queries, use null filter (conservative invalidation — any write triggers re-execution)
        let descriptorFilter = filter;
        if (searchQuery) {
          descriptorFilter = null;
        } else if (indexQuery) {
          const indexFilter = indexRangesToFilter(indexQuery.ranges);
          descriptorFilter = filter && indexFilter
            ? { op: "and" as const, exprs: [indexFilter, filter] }
            : (indexFilter || filter);
        }
        this.transactions.addQueryDescriptor(txId, { table, filter: descriptorFilter });

        const docs = this.queryTable(table, tx.beginTs, filter, indexQuery ?? null, orderField, orderDirection, limit, keysetCursor, searchQuery ?? null);

        for (const doc of docs) {
          this.transactions.addRead(txId, { table, documentId: doc.documentId, ts: doc.ts });
        }
        return docs.map((d) => d.data);
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
        this.validateDocument(table, data as Record<string, unknown>);
        this.transactions.addWrite(txId, { table, documentId: id, data });
      },

      patch: async (table, id, fields) => {
        const tx = this.transactions.get(txId);
        if (!tx) throw new Error("Invalid transaction");
        const existing = await this.reader.getDocument(table, id, tx.beginTs);
        if (!existing) throw new Error(`Document ${id} not found`);
        const merged = { ...(existing.data as any), ...fields };
        this.validateDocument(table, merged);
        this.transactions.addWrite(txId, { table, documentId: id, data: merged });
      },

      replace: async (table, id, data) => {
        const tx = this.transactions.get(txId);
        if (!tx) throw new Error("Invalid transaction");
        const existing = await this.reader.getDocument(table, id, tx.beginTs);
        if (!existing) throw new Error(`Document ${id} not found`);
        const fullDoc = { ...(data as any), _id: id };
        this.validateDocument(table, fullDoc);
        this.transactions.addWrite(txId, { table, documentId: id, data: fullDoc });
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

    const storageOps = this.createStorageOps();

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

    const storage = fn.type === "query"
      ? new StorageReader(storageOps)
      : new StorageWriter(storageOps);

    const result = await fn.handler({ db, scheduler: this.createScheduler(), storage }, args);
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

  private static occBackoff(attempt: number): Promise<void> {
    const baseMs = 10;
    const capMs = 500;
    const delay = Math.random() * Math.min(baseMs * 2 ** attempt, capMs);
    return new Promise((r) => setTimeout(r, delay));
  }

  private async handleMutation(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const ws = this.connections.getById(connectionId);
    if (!ws) return;

    const fn = this.functions[msg.fn];
    if (fn?.isInternal) {
      ws.send(JSON.stringify({ type: "error", id: msg.id, code: "forbidden", message: `Function "${msg.fn}" is internal and cannot be called from a client` } as ServerMessage));
      return;
    }

    for (let attempt = 0; attempt <= VexDO.MAX_OCC_RETRIES; attempt++) {
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
            if (attempt < VexDO.MAX_OCC_RETRIES) {
              await VexDO.occBackoff(attempt);
              continue;
            }
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

  private createActionCtx(): { runQuery: (fnName: string, args?: unknown) => Promise<any>; runMutation: (fnName: string, args?: unknown) => Promise<any>; runAction: (fnName: string, args?: unknown) => Promise<any>; scheduler: ReturnType<typeof VexDO.prototype.createScheduler>; storage: StorageActions } {
    const storageOps = this.createStorageOps();
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
        for (let attempt = 0; attempt <= VexDO.MAX_OCC_RETRIES; attempt++) {
          const txId = crypto.randomUUID();
          this.transactions.begin(txId, this.latestTs, "mutation");
          try {
            const result = await this.invokeFunction(fnName, args ?? {}, txId);
            const mutationTx = this.transactions.get(txId);
            const writeSet = mutationTx ? [...mutationTx.writeSet] : [];
            const readSet = mutationTx ? [...mutationTx.readSet] : [];

            if (readSet.length > 0 && this.checkConflicts(readSet, mutationTx!.beginTs)) {
              this.transactions.remove(txId);
              if (attempt < VexDO.MAX_OCC_RETRIES) {
                await VexDO.occBackoff(attempt);
                continue;
              }
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
      storage: new StorageActions(storageOps),
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
    const id = ulid();
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

  // -- Unified query --

  private queryTable(
    table: string,
    asOfTs: number,
    filter: FilterExpressionJSON | null,
    indexQuery: IndexQueryJSON | null,
    orderField: string | null,
    orderDirection: "asc" | "desc",
    limit: number | null,
    keysetCursor?: KeysetCursorInfo | null,
    searchQuery?: SearchQueryJSON | null
  ): { documentId: string; data: unknown; ts: number }[] {
    const info = this.tableColumns.get(table);
    if (!info) return [];

    // Build set of JSON columns for filter compilation
    const jsonColumns = new Set<string>();
    for (const [name, col] of info.columns) {
      if (col.isJsonColumn) jsonColumns.add(name);
    }

    const isSearch = !!searchQuery;
    // When doing FTS, use table alias "m" so filters reference m.column
    const colPrefix = isSearch ? "m." : "";
    const ftsTable = isSearch
      ? `${table}_search_${searchQuery!.searchField}`
      : null;

    // Find the actual FTS table name from schema search indexes
    let resolvedFtsTable = ftsTable;
    if (isSearch) {
      const tableSchema = this.schemaInfo.tables[table];
      if (tableSchema?.searchIndexes) {
        const si = tableSchema.searchIndexes.find(
          (s) => s.searchField === searchQuery!.searchField
        );
        if (si) {
          resolvedFtsTable = `${table}_${si.name}`;
        }
      }
    }

    const conditions: string[] = [`${colPrefix}_ts <= ?`];
    const params: unknown[] = [asOfTs];

    // FTS MATCH condition
    if (isSearch && resolvedFtsTable) {
      conditions.push(`"${resolvedFtsTable}" MATCH ?`);
      params.push(searchQuery!.searchQuery);
    }

    // Index range conditions (not used with search)
    if (indexQuery && !isSearch) {
      for (const range of indexQuery.ranges) {
        const sqlOps: Record<string, string> = {
          eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=",
        };
        conditions.push(`${colPrefix}"${range.field}" ${sqlOps[range.op]} ?`);
        // SQLite stores booleans as INTEGER 0/1; convert JS booleans to match
        params.push(typeof range.value === "boolean" ? (range.value ? 1 : 0) : range.value);
      }
    }

    // Try to compile filter to SQL
    const compiled = filter ? compileFilterToSQL(filter, jsonColumns) : null;
    const filterPushed = !filter || compiled !== null;

    if (compiled) {
      if (isSearch) {
        conditions.push(prefixFilterColumns(compiled.sql, "m"));
      } else {
        conditions.push(compiled.sql);
      }
      params.push(...compiled.params);
    }

    // Keyset cursor WHERE clause — seek past the last seen row
    if (keysetCursor && !isSearch) {
      const sf = keysetCursor.sortField;
      const cmp = keysetCursor.direction === "desc" ? "<" : ">";
      conditions.push(`(${colPrefix}"${sf}" ${cmp} ? OR (${colPrefix}"${sf}" = ? AND ${colPrefix}_id ${cmp} ?))`);
      params.push(keysetCursor.sortValue, keysetCursor.sortValue, keysetCursor.lastId);
    }

    const where = conditions.join(" AND ");

    // ORDER BY
    let orderClause: string;
    if (isSearch) {
      // FTS results ordered by relevance (rank), with _id tiebreaker
      orderClause = `ORDER BY fts.rank, ${colPrefix}_id ASC`;
    } else {
      const effectiveSortField = orderField ?? "_id";
      const dir = orderDirection === "desc" ? "DESC" : "ASC";
      orderClause = `ORDER BY ${colPrefix}"${effectiveSortField}" ${dir}, ${colPrefix}_id ${dir}`;
    }

    // LIMIT (only when filter was fully pushed to SQL)
    let limitClause = "";
    if (limit != null && filterPushed) {
      limitClause = ` LIMIT ?`;
      params.push(limit);
    }

    let sqlQuery: string;
    if (isSearch && resolvedFtsTable) {
      sqlQuery = `SELECT m.* FROM "${table}" m INNER JOIN "${resolvedFtsTable}" fts ON m.rowid = fts.rowid WHERE ${where} ${orderClause}${limitClause}`;
    } else {
      sqlQuery = `SELECT * FROM "${table}" WHERE ${where} ${orderClause}${limitClause}`;
    }

    const results = this.sql.exec(sqlQuery, ...params).toArray() as Record<string, unknown>[];

    let docs = results.map((row) => ({
      documentId: row._id as string,
      data: sqlRowToDoc(row, info),
      ts: row._ts as number,
    }));

    // JS fallback if filter couldn't be compiled to SQL
    if (filter && !filterPushed) {
      docs = docs.filter((d) => evaluateFilter(d.data, filter));
      if (limit != null) docs = docs.slice(0, limit);
    }

    return docs;
  }

  // -- OCC --

  private checkConflicts(
    readSet: { table: string; documentId: string; ts: number }[],
    beginTs: number
  ): boolean {
    if (readSet.length === 0) return false;

    // Group reads by table
    const byTable = new Map<string, string[]>();
    for (const entry of readSet) {
      let ids = byTable.get(entry.table);
      if (!ids) { ids = []; byTable.set(entry.table, ids); }
      ids.push(entry.documentId);
    }

    for (const [table, ids] of byTable) {
      // Chunk to stay under param limit (1 param for beginTs + N ids)
      const chunkSize = MAX_PARAMS - 1;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => "?").join(", ");
        const results = this.sql.exec(
          `SELECT 1 FROM "${table}" WHERE _ts > ? AND _id IN (${placeholders}) LIMIT 1`,
          beginTs, ...chunk
        ).toArray();
        if (results.length > 0) return true;
      }
    }

    return false;
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

/**
 * Prefix quoted column references in a SQL fragment with a table alias.
 * e.g. `"status" = ?` → `m."status" = ?`
 */
function prefixFilterColumns(sql: string, alias: string): string {
  // Match quoted identifiers that aren't already prefixed with alias.
  return sql.replace(/(?<![.\w])"(\w+)"/g, `${alias}."$1"`);
}

export interface Env {
  VEX_DO: DurableObjectNamespace;
  VEX_STORAGE?: R2Bucket;
}

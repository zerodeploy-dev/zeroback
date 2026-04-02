import { DurableObject } from "cloudflare:workers";
import type { SchemaJSON, CronJobDef, HttpActionHandler } from "@zeroback/server";
import type { UserIdentity } from "@zeroback/values";
import type { ClientMessage, ServerMessage } from "@zeroback/values";
import type { FunctionDef, HttpRouterLike } from "./types";
import { AuthManager } from "./auth/AuthManager";
import { DOSQLiteReader } from "./db/DOSQLiteReader";
import { DOSQLiteWriter } from "./db/DOSQLiteWriter";
import { generateTableDDL, buildTableColumns, migrateSchema } from "./db/SchemaMapper";
import type { TableColumnInfo } from "./db/SchemaMapper";
import { TransactionStore } from "./transaction/TransactionStore";
import { SubscriptionManager } from "./subscriptions/SubscriptionManager";
import { ConnectionManager } from "./websocket/ConnectionManager";
import { StorageManager } from "./StorageManager";
import { CronManager } from "./CronManager";
import { executeMutation, createMutationLock, type MutationDeps } from "./MutationExecutor";
import { ErrorCode, errorMessage, sendError } from "./errors";
import { createSystemFunctions } from "./SystemFunctions";
import { FunctionExecutor } from "./FunctionExecutor";

export { type FunctionDef, type HttpRouterLike } from "./types";

export interface RuntimeConfig {
  functions: Record<string, FunctionDef>;
  schema: SchemaJSON;
  httpRouter: HttpRouterLike | null;
  cronJobsDef: { jobs: CronJobDef[] } | null;
  authDef?: import("@zeroback/values").AuthDef;
}

export function createZerobackDO(config: RuntimeConfig): {
  new (ctx: DurableObjectState, env: Env): DurableObject<Env>;
} {
  return class ZerobackDO extends DurableObject<Env> {
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
  private storage: StorageManager;
  private cron: CronManager;
  private mutationDeps: MutationDeps;
  private functionExecutor: FunctionExecutor;
  private auth: AuthManager | null = null;
  private connectionIdentities: Map<string, UserIdentity | null> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.transactions = new TransactionStore();
    this.subscriptions = new SubscriptionManager();
    this.connections = new ConnectionManager();
    this.sql = ctx.storage.sql;
    this.schemaInfo = config.schema as SchemaJSON;

    // Inject default by_id index on every table
    for (const tableInfo of Object.values(this.schemaInfo.tables)) {
      if (!tableInfo.indexes) tableInfo.indexes = [];
      if (!tableInfo.indexes.some((i) => i.name === "by_id")) {
        tableInfo.indexes.push({ name: "by_id", fields: ["_id"] });
      }
    }

    this.tableColumns = buildTableColumns(this.schemaInfo);
    this.initializeTables();

    if (config.authDef) {
      this.auth = new AuthManager(this.sql, config.authDef, env as unknown as Record<string, unknown>);
      ctx.blockConcurrencyWhile(async () => {
        await this.auth!.runMigrations()
        this.auth!.registerAuthTables(this.tableColumns)
      })
    }

    this.reader = new DOSQLiteReader(this.sql, this.tableColumns);
    this.writer = new DOSQLiteWriter(this.sql, this.tableColumns);
    this.loadLatestTs();

    // Update SQLite query planner statistics
    this.sql.exec("PRAGMA optimize");

    // Load bundled user functions
    this.functions = config.functions;

    // Register system functions for the dashboard
    const systemFns = createSystemFunctions({
      sql: this.sql,
      schemaInfo: this.schemaInfo,
      tableColumns: this.tableColumns,
    });
    Object.assign(this.functions, systemFns);

    // Initialize subsystems
    this.storage = new StorageManager(this.sql, ctx, env);
    this.restoreBaseUrl();
    this.cron = new CronManager(this.sql, ctx);

    // Build FunctionExecutor and mutation deps
    this.functionExecutor = new FunctionExecutor({
      functions: this.functions,
      schemaInfo: this.schemaInfo,
      tableColumns: this.tableColumns,
      transactions: this.transactions,
      sql: this.sql,
      reader: this.reader,
      storage: this.storage,
      cron: this.cron,
      getLatestTs: () => this.latestTs,
      getMutationDeps: () => this.mutationDeps,
    });

    this.mutationDeps = {
      transactions: this.transactions,
      subscriptions: this.subscriptions,
      reader: this.reader,
      writer: this.writer,
      sql: this.sql,
      lock: createMutationLock(),
      getLatestTs: () => this.latestTs,
      setLatestTs: (ts) => { this.latestTs = ts; },
      saveLatestTs: () => this.saveLatestTs(),
      invokeFunction: (fnName, args, txId, identity) => this.functionExecutor.invokeFunction(fnName, args, txId, identity),
    };

    // Restore WebSocket connections after hibernation
    this.restoreConnectionsFromHibernation();

    // Register cron jobs
    this.cron.initializeCronJobs(config.cronJobsDef);
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
        // Note: connectionIdentities are not restored after hibernation.
        // Clients receive a "reset" message and will reconnect, re-establishing identity.
        ws.send('{"type":"reset"}');
      }
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

  private restoreBaseUrl(): void {
    this.ctx.storage.get<string>("baseUrl").then((url) => {
      if (url) {
        this.storage.setBaseUrl(url);
        this.auth?.setBaseUrl(url);
      }
    });
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

    // Capture base URL from Worker header (used for storage URLs).
    // Persist to KV so it survives DO hibernation.
    const headerBaseUrl = req.headers.get("X-Zeroback-Base-Url");
    if (headerBaseUrl && !this.storage.getBaseUrl()) {
      this.storage.setBaseUrl(headerBaseUrl);
      this.ctx.storage.put("baseUrl", headerBaseUrl);
    }

    if (headerBaseUrl && this.auth) {
      this.auth.setBaseUrl(headerBaseUrl);
    }

    if (this.auth && path.startsWith("/auth/")) {
      const authResponse = await this.auth.handleRequest(req);
      if (authResponse) return authResponse;
    }

    if (path === "/ws") return this.handleWebSocketUpgrade(req);
    if (path === "/health") return new Response("OK");
    if (path === "/__dev/reset" && req.method === "POST") return this.handleDevReset();

    // Internal storage routes (called by Worker)
    if (path === "/__internal/validate-upload" && req.method === "POST") return this.storage.handleValidateUpload(url);
    if (path === "/__internal/storage-record" && req.method === "POST") return this.storage.handleStorageRecord(req);
    if (path === "/__internal/storage-delete" && req.method === "POST") return this.storage.handleStorageDelete(req);

    // Admin: invoke any function (public or internal) from CLI
    if (path === "/__admin/run" && req.method === "POST") return this.handleAdminRun(req);
    // /query is a reserved Zeroback path and is dispatched before user httpRouter
    if (path === "/query" && req.method === "POST") return this.handleQueryHttp(req);

    // HTTP actions — user-defined routes
    if (config.httpRouter) {
      const handler = config.httpRouter.lookup(req.method, path);
      if (handler) return this.handleHttpAction(handler, req);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleHttpAction(
    handler: HttpActionHandler,
    req: Request
  ): Promise<Response> {
    try {
      const ctx = this.functionExecutor.createActionCtx();
      return await handler(ctx, req);
    } catch (e) {
      console.error("HTTP action error:", e);
      return new Response(
        JSON.stringify({ error: errorMessage(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  private handleDevReset(): Response {
    for (const tableName of Object.keys(this.schemaInfo.tables)) {
      this.sql.exec(`DELETE FROM "${tableName}"`);
    }

    this.storage.clearAll();

    this.latestTs = 0;
    this.ctx.storage.put("latestTs", 0);
    this.subscriptions.clearAll();

    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send('{"type":"reset"}'); } catch {}
    }

    return new Response("OK");
  }

  private async handleAdminRun(req: Request): Promise<Response> {
    const json = { "Content-Type": "application/json" };
    try {
      const body = (await req.json()) as { fn: string; args?: unknown };
      const fnName = body.fn;
      const args = body.args ?? {};

      const fn = this.functions[fnName];
      if (!fn) {
        return new Response(
          JSON.stringify({ success: false, error: `Function not found: ${fnName}`, code: ErrorCode.NOT_FOUND }),
          { status: 404, headers: json }
        );
      }

      let result: unknown;
      if (fn.type === "mutation") {
        result = await executeMutation(this.mutationDeps, fnName, args);
      } else {
        const txId = crypto.randomUUID();
        this.transactions.begin(txId, this.latestTs, "query");
        try {
          const invoked = await this.functionExecutor.invokeFunction(fnName, args, txId);
          result = invoked.result;
        } finally {
          this.transactions.remove(txId);
        }
      }

      return new Response(
        JSON.stringify({ success: true, result }),
        { status: 200, headers: json }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, error: errorMessage(e), code: ErrorCode.EXECUTION_ERROR }),
        { status: 500, headers: json }
      );
    }
  }

  private async handleQueryHttp(req: Request): Promise<Response> {
    const json = { "Content-Type": "application/json" }
    try {
      const body = (await req.json()) as { fn?: unknown; args?: unknown }
      const fnName = body.fn
      const args = body.args ?? {}

      if (!fnName || typeof fnName !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing required field: fn", code: ErrorCode.BAD_REQUEST }),
          { status: 400, headers: json }
        )
      }

      const fn = this.functions[fnName]
      if (!fn) {
        return new Response(
          JSON.stringify({ error: `Function not found: ${fnName}`, code: ErrorCode.NOT_FOUND }),
          { status: 404, headers: json }
        )
      }

      if (fn.isInternal) {
        return new Response(
          JSON.stringify({ error: `Function "${fnName}" is internal`, code: ErrorCode.FORBIDDEN }),
          { status: 403, headers: json }
        )
      }

      if (fn.type !== "query") {
        return new Response(
          JSON.stringify({ error: `"${fnName}" is not a query`, code: ErrorCode.BAD_REQUEST }),
          { status: 400, headers: json }
        )
      }

      const txId = crypto.randomUUID()
      this.transactions.begin(txId, this.latestTs, "query")
      try {
        const { result } = await this.functionExecutor.invokeFunction(fnName, args, txId)
        return new Response(JSON.stringify({ result }), { status: 200, headers: json })
      } finally {
        this.transactions.remove(txId)
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: errorMessage(e), code: ErrorCode.EXECUTION_ERROR }),
        { status: 500, headers: json }
      )
    }
  }

  // -- WebSocket --

  private async handleWebSocketUpgrade(req: Request): Promise<Response> {
    if (this.connections.isFull()) {
      return new Response("Too many connections", { status: 503 });
    }

    const { 0: server, 1: client } = new WebSocketPair();
    const connectionId = crypto.randomUUID();

    this.ctx.acceptWebSocket(server, [connectionId]);
    this.connections.add(server, connectionId);

    if (this.auth) {
      const identity = await this.auth.getSessionFromHeaders(req.headers);
      this.connectionIdentities.set(connectionId, identity);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    const connId = this.connections.get(ws);
    if (!connId) return;

    const msg = JSON.parse(message) as ClientMessage;

    if (msg.type === "ping") {
      ws.send('{"type":"pong"}');
      return;
    }

    if (!this.connections.checkRateLimit(connId)) {
      sendError(ws, undefined, ErrorCode.RATE_LIMITED, "Too many requests — slow down");
      return;
    }

    switch (msg.type) {
      case "query": await this.handleQuery(connId, msg); break;
      case "mutation": await this.handleMutation(connId, msg); break;
      case "action": await this.handleAction(connId, msg); break;
      case "unsubscribe": this.subscriptions.remove(msg.id); break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const connId = this.connections.get(ws);
    this.connections.remove(ws);
    this.subscriptions.removeAll(ws);
    if (connId) {
      this.connectionIdentities.delete(connId);
    }
  }

  // -- WebSocket handlers --

  private async handleQuery(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const ws = this.connections.getById(connectionId);
    if (!ws) return;

    const fn = this.functions[msg.fn];
    if (fn?.isInternal) {
      sendError(ws, msg.id, ErrorCode.FORBIDDEN, `Function "${msg.fn}" is internal and cannot be called from a client`);
      return;
    }

    const identity = this.connectionIdentities.get(connectionId);
    const txId = crypto.randomUUID();
    this.transactions.begin(txId, this.latestTs, "query");

    try {
      const result = await this.functionExecutor.invokeFunction(msg.fn, msg.args, txId, identity);
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
        identity,
      });

      ws.send(`{"type":"result","id":${JSON.stringify(msg.id)},"result":${resultJSON}}`);
    } catch (e) {
      sendError(ws, msg.id, ErrorCode.EXECUTION_ERROR, errorMessage(e));
    } finally {
      this.transactions.remove(txId);
    }
  }

  private async handleMutation(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const ws = this.connections.getById(connectionId);
    if (!ws) return;

    const fn = this.functions[msg.fn];
    if (fn?.isInternal) {
      sendError(ws, msg.id, ErrorCode.FORBIDDEN, `Function "${msg.fn}" is internal and cannot be called from a client`);
      return;
    }

    const identity = this.connectionIdentities.get(connectionId);
    try {
      const result = await executeMutation(this.mutationDeps, msg.fn, msg.args, identity);
      ws.send(JSON.stringify({ type: "mutationResult", id: msg.id, result } as ServerMessage));
    } catch (e) {
      const code = errorMessage(e).includes("Transaction conflict") ? ErrorCode.CONFLICT : ErrorCode.EXECUTION_ERROR;
      sendError(ws, msg.id, code, errorMessage(e));
    }
  }

  private async handleAction(connectionId: string, msg: { id: string; fn: string; args: unknown }): Promise<void> {
    const ws = this.connections.getById(connectionId);
    if (!ws) return;

    try {
      const fn = this.functions[msg.fn];
      if (!fn) throw new Error(`Function not found: ${msg.fn}`);
      if (fn.isInternal) {
        sendError(ws, msg.id, ErrorCode.FORBIDDEN, `Function "${msg.fn}" is internal and cannot be called from a client`);
        return;
      }
      if (fn.type !== "action") throw new Error(`${msg.fn} is not an action`);

      const identity = this.connectionIdentities.get(connectionId);
      const actionCtx = this.functionExecutor.createActionCtx(identity);
      const result = await fn.handler(actionCtx, msg.args);

      ws.send(JSON.stringify({ type: "actionResult", id: msg.id, result } as ServerMessage));
    } catch (e) {
      sendError(ws, msg.id, ErrorCode.EXECUTION_ERROR, errorMessage(e));
    }
  }

  // -- Scheduler execution --

  private async executeScheduledFunction(fnName: string, args: unknown): Promise<void> {
    const fn = this.functions[fnName];
    if (!fn) throw new Error(`Function not found: ${fnName}`);

    if (fn.type === "action") {
      const ctx = this.functionExecutor.createActionCtx();
      await fn.handler(ctx, args);
    } else if (fn.type === "mutation") {
      await executeMutation(this.mutationDeps, fnName, args);
    } else if (fn.type === "query") {
      const txId = crypto.randomUUID();
      this.transactions.begin(txId, this.latestTs, "query");
      try {
        await this.functionExecutor.invokeFunction(fnName, args, txId);
      } finally {
        this.transactions.remove(txId);
      }
    }
  }

  async alarm(): Promise<void> {
    await this.cron.processAlarm((fnName, args) => this.executeScheduledFunction(fnName, args));
  }

} // end class ZerobackDO
} // end createZerobackDO

export interface Env {
  ZEROBACK_DO: DurableObjectNamespace;
  ZEROBACK_STORAGE?: R2Bucket;
  ZEROBACK_DASHBOARD?: string;
}

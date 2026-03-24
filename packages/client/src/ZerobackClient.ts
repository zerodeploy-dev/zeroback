import { SubscriptionRegistry } from "./SubscriptionRegistry";
import { Backoff, type BackoffOptions } from "./Backoff";
import { QueryStore } from "./QueryStore";
import type { LocalStore, QueryKey } from "./QueryStore";
import type { ClientMessage, ServerMessage } from "@zeroback/values";
import type { PersistenceAdapter } from "./persistence/PersistenceAdapter.js";
import { IDBPersistence } from "./persistence/IDBPersistence.js";
import { MutationQueue } from "./persistence/MutationQueue.js";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface ZerobackClientOptions {
  persistence?: boolean | PersistenceAdapter;
  maxCacheAge?: number;
  schemaVersion?: string;
  backoff?: BackoffOptions;
  /** Heartbeat ping interval in milliseconds. Set to 0 to disable. Default: 30000 (30s). */
  heartbeatIntervalMs?: number;
  /** Timeout for mutation/action requests in milliseconds. Default: 60000 (60s). */
  requestTimeoutMs?: number;
}

export class ZerobackClient {
  private ws: WebSocket | null = null;
  private subscriptions: SubscriptionRegistry;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private url: string;
  private backoff: Backoff;
  private isConnecting = false;
  private messageQueue: ClientMessage[] = [];
  private closed = false;

  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastPongAt = 0;
  private heartbeatIntervalMs: number;
  private requestTimeoutMs: number;

  private _connectionState: ConnectionState = "disconnected";
  private connectionListeners = new Set<(state: ConnectionState) => void>();

  /** Centralized query result cache with optimistic update support. */
  readonly queryStore = new QueryStore();

  /** Sequential mutation queue — ensures mutations execute one at a time in order. */
  private mutationQueue: Promise<void> = Promise.resolve();

  private persistedMutationQueue: MutationQueue | null = null;
  private options: ZerobackClientOptions;

  constructor(url: string, options?: ZerobackClientOptions) {
    this.url = url;
    this.options = options ?? {};
    this.backoff = new Backoff(options?.backoff);
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 30_000;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 60_000;
    this.subscriptions = new SubscriptionRegistry();

    if (this.options.persistence) {
      const adapter =
        typeof this.options.persistence === "object"
          ? this.options.persistence
          : new IDBPersistence(url, {
              maxCacheAge: this.options.maxCacheAge,
              schemaVersion: this.options.schemaVersion,
            });
      this.queryStore.setPersistence(adapter);
      this.persistedMutationQueue = new MutationQueue(url);
      // When persistence is enabled, defer connect() to init()
    } else {
      this.connect();
    }
  }

  /**
   * Initialize the client with persistence.
   * Hydrates cached data from IndexedDB, connects the WebSocket, and replays
   * any persisted offline mutations. Only needed when persistence is enabled.
   */
  async init(): Promise<void> {
    await this.queryStore.hydrate();
    this.connect();
    await this.replayPersistedMutations();
  }

  private async replayPersistedMutations(): Promise<void> {
    if (!this.persistedMutationQueue) return;
    const pending = await this.persistedMutationQueue.getAll();
    for (const m of pending) {
      try {
        await this.mutation(m.fnName, m.args);
      } catch {
        // Mutation failed on replay — discard it
      }
      await this.persistedMutationQueue.remove(m.id);
    }
  }

  hasServerResult(key: QueryKey): boolean {
    return this.queryStore.hasServerConfirmation(key);
  }

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  onConnectionChange(listener: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState === state) return;
    this._connectionState = state;
    for (const listener of this.connectionListeners) {
      listener(state);
    }
  }

  private connect(): void {
    if (this.closed || this.isConnecting || (this.ws?.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    this.setConnectionState("connecting");

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.isConnecting = false;
      this.setConnectionState("disconnected");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.isConnecting = false;
      this.backoff.reset();
      this.setConnectionState("connected");
      this.startHeartbeat();
      this.resubscribeAll();
      this.flushMessageQueue();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        this.handleMessage(msg);
      } catch {
        // Ignore unparseable messages
      }
    };

    this.ws.onclose = () => {
      this.isConnecting = false;
      this.stopHeartbeat();
      this.setConnectionState("disconnected");
      if (!this.closed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.isConnecting = false;
      this.stopHeartbeat();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.backoff.shouldRetry()) {
      this.rejectAllPending("Connection lost");
      return;
    }

    const delay = this.backoff.next();
    setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.heartbeatIntervalMs <= 0) return;

    this.lastPongAt = Date.now();
    this.heartbeatInterval = setInterval(() => {
      // If no pong received within 2x the interval, consider connection dead
      if (Date.now() - this.lastPongAt > this.heartbeatIntervalMs * 2) {
        this.stopHeartbeat();
        this.ws?.close();
        return;
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('{"type":"ping"}');
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** Re-subscribe all active subscriptions after reconnect or server reset. */
  private resubscribeAll(): void {
    for (const sub of this.subscriptions.getAll()) {
      this.send({ type: "query", id: sub.id, fn: sub.fnName, args: sub.args });
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      this.send(msg);
    }
  }

  private addPendingRequest(
    id: string,
    resolve: (value: unknown) => void,
    reject: (reason: unknown) => void,
  ): void {
    const timer = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error("Request timed out"));
    }, this.requestTimeoutMs);
    this.pendingRequests.set(id, { resolve, reject, timer });
  }

  private resolvePending(id: string, value: unknown): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(value);
      this.pendingRequests.delete(id);
    }
  }

  private rejectPending(id: string, reason: unknown): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
      this.pendingRequests.delete(id);
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.messageQueue.push(msg);
    }
  }

  subscribe(fnName: string, args: unknown, callback?: (data: unknown) => void): () => void {
    const subId = this.subscriptions.add(fnName, args, callback ?? (() => {}));
    this.send({ type: "query", id: subId, fn: fnName, args });
    return () => {
      this.subscriptions.remove(subId);
      this.send({ type: "unsubscribe", id: subId });
    };
  }

  /** Subscribe to changes for a specific query key in the centralized store. */
  watchQuery(key: QueryKey, listener: () => void): () => void {
    return this.queryStore.subscribe(key, listener);
  }

  /** Get the current (merged base + optimistic) result for a query key. */
  getQueryResult(key: QueryKey): unknown | undefined {
    return this.queryStore.getResult(key);
  }

  mutation(
    fnName: string,
    args: unknown,
    opts?: { optimisticUpdate?: (store: LocalStore) => void },
  ): Promise<unknown> {
    const id = crypto.randomUUID();

    // Apply optimistic update immediately (before waiting in queue)
    if (opts?.optimisticUpdate) {
      this.queryStore.addLayer(id, opts.optimisticUpdate);
    }

    // Persist mutation for offline replay (fire-and-forget)
    if (this.persistedMutationQueue) {
      this.persistedMutationQueue.add({ id, fnName, args, timestamp: Date.now() }).catch(() => {});
    }

    // Chain onto the mutation queue so mutations execute sequentially
    const result = this.mutationQueue.then(async () => {
      try {
        const res = await new Promise((resolve, reject) => {
          this.addPendingRequest(id, resolve, reject);
          this.send({ type: "mutation", id, fn: fnName, args });
        });
        // Mutation succeeded — remove from persisted queue
        this.persistedMutationQueue?.remove(id).catch(() => {});
        return res;
      } finally {
        if (opts?.optimisticUpdate) {
          this.queryStore.removeLayer(id);
        }
      }
    });

    // Update the queue — always resolve so subsequent mutations aren't blocked by failures
    this.mutationQueue = result.then(() => {}, () => {});

    return result;
  }

  async action(fnName: string, args: unknown): Promise<unknown> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.addPendingRequest(id, resolve, reject);
      this.send({ type: "action", id, fn: fnName, args });
    });
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "result":
      case "update": {
        // Update centralized store
        const sub = this.subscriptions.get(msg.id);
        if (sub) {
          const key = QueryStore.makeKey(sub.fnName, sub.args);
          this.queryStore.setServerResult(key, msg.result);
        }
        // Also call subscription callback (for usePaginatedQuery and direct subscribers)
        this.subscriptions.notify(msg.id, msg.result);
        break;
      }

      case "updates":
        for (const item of msg.items) {
          const sub = this.subscriptions.get(item.id);
          if (sub) {
            const key = QueryStore.makeKey(sub.fnName, sub.args);
            this.queryStore.setServerResult(key, item.result);
          }
          this.subscriptions.notify(item.id, item.result);
        }
        break;

      case "mutationResult":
      case "actionResult":
        this.resolvePending(msg.id, msg.result);
        break;

      case "error":
        if (msg.id) {
          this.rejectPending(msg.id, new Error(msg.message));
        }
        break;

      case "pong":
        this.lastPongAt = Date.now();
        break;

      case "reset":
        // Server lost subscription state (e.g. hibernation wake) — re-subscribe
        this.queryStore.clearServerConfirmations();
        this.resubscribeAll();
        break;
    }
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.setConnectionState("disconnected");
  }
}

import { SubscriptionRegistry } from "./SubscriptionRegistry";
import { Backoff } from "./Backoff";
import type { ClientMessage, ServerMessage } from "./Protocol";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export class ConvexClient {
  private ws: WebSocket | null = null;
  private subscriptions: SubscriptionRegistry;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>();
  private url: string;
  private backoff = new Backoff();
  private isConnecting = false;
  private messageQueue: ClientMessage[] = [];
  private closed = false;

  private _connectionState: ConnectionState = "disconnected";
  private connectionListeners = new Set<(state: ConnectionState) => void>();

  constructor(url: string) {
    this.url = url;
    this.subscriptions = new SubscriptionRegistry();
    this.connect();
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
      this.setConnectionState("disconnected");
      if (!this.closed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.isConnecting = false;
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.backoff.shouldRetry()) {
      // Reject all pending requests on permanent disconnect
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error("Connection lost"));
        this.pendingRequests.delete(id);
      }
      return;
    }

    const delay = this.backoff.next();
    setTimeout(() => this.connect(), delay);
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

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.messageQueue.push(msg);
    }
  }

  subscribe(fnName: string, args: unknown, callback: (data: unknown) => void): () => void {
    const subId = this.subscriptions.add(fnName, args, callback);
    this.send({ type: "query", id: subId, fn: fnName, args });
    return () => {
      this.subscriptions.remove(subId);
      this.send({ type: "unsubscribe", id: subId });
    };
  }

  async mutation(fnName: string, args: unknown): Promise<unknown> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ type: "mutation", id, fn: fnName, args });
    });
  }

  async action(fnName: string, args: unknown): Promise<unknown> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ type: "action", id, fn: fnName, args });
    });
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "result":
      case "update":
        this.subscriptions.notify(msg.id, msg.result);
        break;

      case "updates":
        for (const item of msg.items) {
          this.subscriptions.notify(item.id, item.result);
        }
        break;

      case "mutationResult":
      case "actionResult": {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          pending.resolve(msg.result);
          this.pendingRequests.delete(msg.id);
        }
        break;
      }

      case "error":
        if (msg.id) {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            pending.reject(new Error(msg.message));
            this.pendingRequests.delete(msg.id);
          }
        }
        break;

      case "reset":
        // Server lost subscription state (e.g. hibernation wake) — re-subscribe
        this.resubscribeAll();
        break;
    }
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.setConnectionState("disconnected");
  }
}

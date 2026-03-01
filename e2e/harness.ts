import WebSocket from "ws";
import type { ServerMessage } from "@zeroback/values";

const PORT = 8788;

export class ZerobackTestClient {
  private ws!: WebSocket;
  private pending = new Map<string, {
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
  }>();
  private subscriptions = new Map<string, (msg: ServerMessage) => void>();
  private idCounter = 0;
  private connected = false;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      this.ws.on("open", () => {
        this.connected = true;
        resolve();
      });
      this.ws.on("error", reject);
      this.ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerMessage;

        // Handle batched updates — fan out to individual subscription handlers
        if (msg.type === "updates") {
          for (const item of msg.items) {
            if (this.subscriptions.has(item.id)) {
              this.subscriptions.get(item.id)!({ type: "update", id: item.id, result: item.result });
            }
          }
          return;
        }

        // Ignore reset messages in tests
        if (msg.type === "reset") return;

        const id = "id" in msg ? msg.id : undefined;

        if (id && msg.type === "update" && this.subscriptions.has(id)) {
          this.subscriptions.get(id)!(msg);
          return;
        }

        if (id && this.pending.has(id)) {
          const p = this.pending.get(id)!;
          this.pending.delete(id);
          p.resolve(msg);
        }
      });
    });
  }

  private nextId(): string {
    return `req_${++this.idCounter}`;
  }

  async query(fn: string, args: Record<string, unknown> = {}): Promise<{ id: string; result: any }> {
    const id = this.nextId();
    const msg = await this.send({ type: "query", id, fn, args });
    if (msg.type === "error") throw new Error(`Query error: ${msg.message}`);
    return { id, result: (msg as any).result };
  }

  async mutation(fn: string, args: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId();
    const msg = await this.send({ type: "mutation", id, fn, args });
    if (msg.type === "error") throw new Error(`Mutation error: ${msg.message}`);
    return (msg as any).result;
  }

  async action(fn: string, args: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId();
    const msg = await this.send({ type: "action", id, fn, args });
    if (msg.type === "error") throw new Error(`Action error: ${msg.message}`);
    return (msg as any).result;
  }

  async mutationError(fn: string, args: Record<string, unknown> = {}): Promise<{ code: string; message: string }> {
    const id = this.nextId();
    const msg = await this.send({ type: "mutation", id, fn, args });
    if (msg.type !== "error") throw new Error(`Expected error but got ${msg.type}`);
    return { code: (msg as any).code, message: (msg as any).message };
  }

  async queryError(fn: string, args: Record<string, unknown> = {}): Promise<{ code: string; message: string }> {
    const id = this.nextId();
    const msg = await this.send({ type: "query", id, fn, args });
    if (msg.type !== "error") throw new Error(`Expected error but got ${msg.type}`);
    return { code: (msg as any).code, message: (msg as any).message };
  }

  async actionError(fn: string, args: Record<string, unknown> = {}): Promise<{ code: string; message: string }> {
    const id = this.nextId();
    const msg = await this.send({ type: "action", id, fn, args });
    if (msg.type !== "error") throw new Error(`Expected error but got ${msg.type}`);
    return { code: (msg as any).code, message: (msg as any).message };
  }

  waitForUpdate(subscriptionId: string, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.subscriptions.delete(subscriptionId);
        reject(new Error(`Timed out waiting for update on ${subscriptionId}`));
      }, timeoutMs);

      this.subscriptions.set(subscriptionId, (msg) => {
        clearTimeout(timer);
        this.subscriptions.delete(subscriptionId);
        resolve((msg as any).result);
      });
    });
  }

  /**
   * Register a non-blocking callback for the next update.
   * Returns a handle with cancel() — no dangling timers.
   */
  onNextUpdate(subscriptionId: string, cb: (result: any) => void): { cancel: () => void } {
    this.subscriptions.set(subscriptionId, (msg) => {
      this.subscriptions.delete(subscriptionId);
      cb((msg as any).result);
    });
    return {
      cancel: () => { this.subscriptions.delete(subscriptionId); },
    };
  }

  unsubscribe(id: string): void {
    this.ws.send(JSON.stringify({ type: "unsubscribe", id }));
    this.subscriptions.delete(id);
  }

  close(): void {
    if (this.connected) {
      this.ws.close();
      this.connected = false;
    }
  }

  private send(payload: any): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(payload.id);
        reject(new Error(`Request ${payload.id} timed out`));
      }, 10_000);

      this.pending.set(payload.id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.ws.send(JSON.stringify(payload));
    });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

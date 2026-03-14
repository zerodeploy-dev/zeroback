export interface SubscriptionEntry {
  id: string;
  fnName: string;
  args: unknown;
  callback: (data: unknown) => void;
}

export class SubscriptionRegistry {
  private subs = new Map<string, SubscriptionEntry>();

  add(fnName: string, args: unknown, callback: (data: unknown) => void): string {
    const id = crypto.randomUUID();
    this.subs.set(id, { id, fnName, args, callback });
    return id;
  }

  get(id: string): SubscriptionEntry | undefined {
    return this.subs.get(id);
  }

  remove(id: string): void {
    this.subs.delete(id);
  }

  notify(id: string, data: unknown): void {
    const sub = this.subs.get(id);
    if (sub) {
      sub.callback(data);
    }
  }

  getAll(): SubscriptionEntry[] {
    return Array.from(this.subs.values());
  }
}

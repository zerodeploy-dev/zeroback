import type { PersistenceAdapter, CachedEntry } from "./persistence/PersistenceAdapter.js";

export type QueryKey = string;

export interface LocalStore {
  getQuery(ref: { _name: string } | string, args?: unknown): unknown | undefined;
  setQuery(ref: { _name: string } | string, args: unknown, value: unknown): void;
}

interface OptimisticLayer {
  id: string;
  changes: Map<QueryKey, unknown>;
}

export class QueryStore {
  private baseCache = new Map<QueryKey, unknown>();
  private mergedCache = new Map<QueryKey, unknown>();
  private layers: OptimisticLayer[] = [];
  private listeners = new Map<QueryKey, Set<() => void>>();
  private persistence: PersistenceAdapter | null = null;
  private serverConfirmed = new Set<QueryKey>();

  static makeKey(fnName: string, args: unknown): string {
    return fnName + "|" + JSON.stringify(args ?? {});
  }

  private static resolveName(ref: { _name: string } | string): string {
    return typeof ref === "string" ? ref : ref._name;
  }

  setPersistence(adapter: PersistenceAdapter): void {
    this.persistence = adapter;
  }

  async hydrate(): Promise<void> {
    if (!this.persistence) return;
    const entries = await this.persistence.getAll();
    for (const [key, entry] of entries) {
      this.baseCache.set(key, entry.result);
      this.recomputeAndNotify(key);
    }
  }

  setServerResult(key: QueryKey, result: unknown): void {
    this.baseCache.set(key, result);
    this.serverConfirmed.add(key);
    this.recomputeAndNotify(key);
    this.persistence?.set(key, { result, timestamp: Date.now() }).catch(() => {});
  }

  hasServerConfirmation(key: QueryKey): boolean {
    return this.serverConfirmed.has(key);
  }

  clearServerConfirmations(): void {
    this.serverConfirmed.clear();
  }

  addLayer(mutationId: string, updateFn: (store: LocalStore) => void): void {
    const changes = new Map<QueryKey, unknown>();

    const localStore: LocalStore = {
      getQuery: (ref, args?) => {
        const key = QueryStore.makeKey(QueryStore.resolveName(ref), args);
        return this.mergedCache.get(key);
      },
      setQuery: (ref, args, value) => {
        const key = QueryStore.makeKey(QueryStore.resolveName(ref), args);
        changes.set(key, value);
      },
    };

    updateFn(localStore);

    if (changes.size === 0) return;

    this.layers.push({ id: mutationId, changes });

    for (const key of changes.keys()) {
      this.recomputeAndNotify(key);
    }
  }

  removeLayer(mutationId: string): void {
    const idx = this.layers.findIndex((l) => l.id === mutationId);
    if (idx === -1) return;

    const affectedKeys = new Set(this.layers[idx].changes.keys());
    this.layers.splice(idx, 1);

    for (const key of affectedKeys) {
      this.recomputeAndNotify(key);
    }
  }

  getResult(key: QueryKey): unknown | undefined {
    return this.mergedCache.get(key);
  }

  subscribe(key: QueryKey, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(key);
    };
  }

  private recomputeAndNotify(key: QueryKey): void {
    let result = this.baseCache.get(key);

    for (const layer of this.layers) {
      if (layer.changes.has(key)) {
        result = layer.changes.get(key);
      }
    }

    const prev = this.mergedCache.get(key);

    // Same reference — no change
    if (prev === result) return;

    // Deep equality check to avoid unnecessary re-renders
    try {
      if (JSON.stringify(prev) === JSON.stringify(result)) return;
    } catch {
      // stringify fails — treat as different
    }

    this.mergedCache.set(key, result);

    const listeners = this.listeners.get(key);
    if (listeners) {
      for (const fn of listeners) fn();
    }
  }
}

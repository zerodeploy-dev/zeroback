import type { CachedEntry, PersistenceAdapter } from "./PersistenceAdapter.js";

const STORE_QUERY_CACHE = "queryCache";
const STORE_META = "meta";
const DB_VERSION = 1;

export interface IDBPersistenceOptions {
  maxCacheAge?: number;
  schemaVersion?: string;
}

export class IDBPersistence implements PersistenceAdapter {
  private dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private maxCacheAge: number;
  private schemaVersion: string | undefined;

  constructor(deploymentUrl: string, opts?: IDBPersistenceOptions) {
    this.dbName = "vex_" + hashString(deploymentUrl);
    this.maxCacheAge = opts?.maxCacheAge ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    this.schemaVersion = opts?.schemaVersion;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_QUERY_CACHE)) {
          db.createObjectStore(STORE_QUERY_CACHE);
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async getAll(): Promise<Map<string, CachedEntry>> {
    const db = await this.open();

    // Check schema version — clear if mismatched
    if (this.schemaVersion) {
      const storedVersion = await this.getMeta(db, "schemaVersion");
      if (storedVersion && storedVersion !== this.schemaVersion) {
        await this.clear();
        await this.setMeta(db, "schemaVersion", this.schemaVersion);
        return new Map();
      }
      if (!storedVersion) {
        await this.setMeta(db, "schemaVersion", this.schemaVersion);
      }
    }

    const now = Date.now();
    const result = new Map<string, CachedEntry>();
    const entries = await this.getAllFromStore<CachedEntry>(db, STORE_QUERY_CACHE);

    for (const [key, entry] of entries) {
      if (now - entry.timestamp < this.maxCacheAge) {
        result.set(key, entry);
      }
    }

    return result;
  }

  async set(key: string, entry: CachedEntry): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUERY_CACHE, "readwrite");
      tx.objectStore(STORE_QUERY_CACHE).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUERY_CACHE, "readwrite");
      tx.objectStore(STORE_QUERY_CACHE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const storeNames = [STORE_QUERY_CACHE, STORE_META];
      const tx = db.transaction(storeNames, "readwrite");
      for (const name of storeNames) {
        tx.objectStore(name).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private getMeta(db: IDBDatabase, key: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readonly");
      const req = tx.objectStore(STORE_META).get(key);
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private setMeta(db: IDBDatabase, key: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<[string, T][]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const entries: [string, T][] = [];

      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          entries.push([c.key as string, c.value as T]);
          c.continue();
        } else {
          resolve(entries);
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}

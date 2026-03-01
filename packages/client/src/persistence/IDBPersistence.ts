import type { CachedEntry, PersistenceAdapter } from "./PersistenceAdapter.js";
import { hashString, openIDB, idbPut, idbDelete, idbClear, idbGet, idbGetAllEntries } from "./idb-helpers.js";

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
    this.dbPromise = openIDB(this.dbName, DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(STORE_QUERY_CACHE)) {
        db.createObjectStore(STORE_QUERY_CACHE);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    });
    return this.dbPromise;
  }

  async getAll(): Promise<Map<string, CachedEntry>> {
    const db = await this.open();

    // Check schema version — clear if mismatched
    if (this.schemaVersion) {
      const storedVersion = await idbGet<string>(db, STORE_META, "schemaVersion");
      if (storedVersion && storedVersion !== this.schemaVersion) {
        await this.clear();
        await idbPut(db, STORE_META, this.schemaVersion, "schemaVersion");
        return new Map();
      }
      if (!storedVersion) {
        await idbPut(db, STORE_META, this.schemaVersion, "schemaVersion");
      }
    }

    const now = Date.now();
    const result = new Map<string, CachedEntry>();
    const entries = await idbGetAllEntries<CachedEntry>(db, STORE_QUERY_CACHE);

    for (const [key, entry] of entries) {
      if (now - entry.timestamp < this.maxCacheAge) {
        result.set(key, entry);
      }
    }

    return result;
  }

  async set(key: string, entry: CachedEntry): Promise<void> {
    const db = await this.open();
    await idbPut(db, STORE_QUERY_CACHE, entry, key);
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    await idbDelete(db, STORE_QUERY_CACHE, key);
  }

  async clear(): Promise<void> {
    const db = await this.open();
    await idbClear(db, [STORE_QUERY_CACHE, STORE_META]);
  }
}

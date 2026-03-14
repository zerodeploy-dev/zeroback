import { hashString, openIDB, idbPut, idbDelete, idbClear, idbGetAll } from "./idb-helpers.js";

const STORE_PENDING_MUTATIONS = "pendingMutations";
const DB_VERSION = 1;

export interface PersistedMutation {
  id: string;
  fnName: string;
  args: unknown;
  timestamp: number;
}

export class MutationQueue {
  private dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(deploymentUrl: string) {
    this.dbName = "vex_mutations_" + hashString(deploymentUrl);
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = openIDB(this.dbName, DB_VERSION, (db) => {
      if (!db.objectStoreNames.contains(STORE_PENDING_MUTATIONS)) {
        db.createObjectStore(STORE_PENDING_MUTATIONS, { keyPath: "id" });
      }
    });
    return this.dbPromise;
  }

  async add(mutation: PersistedMutation): Promise<void> {
    const db = await this.open();
    await idbPut(db, STORE_PENDING_MUTATIONS, mutation);
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    await idbDelete(db, STORE_PENDING_MUTATIONS, id);
  }

  async getAll(): Promise<PersistedMutation[]> {
    const db = await this.open();
    const mutations = await idbGetAll<PersistedMutation>(db, STORE_PENDING_MUTATIONS);
    return mutations.sort((a, b) => a.timestamp - b.timestamp);
  }

  async clear(): Promise<void> {
    const db = await this.open();
    await idbClear(db, STORE_PENDING_MUTATIONS);
  }
}

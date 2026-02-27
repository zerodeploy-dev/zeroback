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

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_PENDING_MUTATIONS)) {
          db.createObjectStore(STORE_PENDING_MUTATIONS, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async add(mutation: PersistedMutation): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_MUTATIONS, "readwrite");
      tx.objectStore(STORE_PENDING_MUTATIONS).put(mutation);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_MUTATIONS, "readwrite");
      tx.objectStore(STORE_PENDING_MUTATIONS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAll(): Promise<PersistedMutation[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_MUTATIONS, "readonly");
      const req = tx.objectStore(STORE_PENDING_MUTATIONS).getAll();
      req.onsuccess = () => {
        const mutations = (req.result as PersistedMutation[]).sort(
          (a, b) => a.timestamp - b.timestamp,
        );
        resolve(mutations);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_MUTATIONS, "readwrite");
      tx.objectStore(STORE_PENDING_MUTATIONS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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

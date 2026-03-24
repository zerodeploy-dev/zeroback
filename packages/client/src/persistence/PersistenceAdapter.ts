export interface CachedEntry {
  result: unknown;
  timestamp: number;
}

export interface PersistenceAdapter {
  getAll(): Promise<Map<string, CachedEntry>>;
  set(key: string, entry: CachedEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

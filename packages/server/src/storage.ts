export type StorageOps = {
  generateUploadUrl(): Promise<string>;
  getUrl(storageId: string): Promise<string | null>;
  getMetadata(storageId: string): Promise<StorageMetadata | null>;
  deleteFile(storageId: string): Promise<void>;
  store(blob: Blob): Promise<string>;
};

export type StorageMetadata = {
  storageId: string;
  sha256: string;
  contentType: string;
  size: number;
};

export class StorageReader {
  constructor(protected ops: StorageOps) {}

  getUrl(storageId: string): Promise<string | null> {
    return this.ops.getUrl(storageId);
  }

  getMetadata(storageId: string): Promise<StorageMetadata | null> {
    return this.ops.getMetadata(storageId);
  }
}

export class StorageWriter extends StorageReader {
  generateUploadUrl(): Promise<string> {
    return this.ops.generateUploadUrl();
  }

  delete(storageId: string): Promise<void> {
    return this.ops.deleteFile(storageId);
  }
}

export class StorageActions extends StorageWriter {
  store(blob: Blob): Promise<string> {
    return this.ops.store(blob);
  }
}

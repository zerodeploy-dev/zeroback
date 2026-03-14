import type { StorageOps } from "@zeroback/server";
import type { SqlApi } from "./types";

export class StorageManager {
  private uploadTokens = new Map<string, { expiresAt: number }>();
  private baseUrl: string | null = null;

  constructor(
    private sql: SqlApi,
    private ctx: { id: { toString(): string } },
    private env: { ZEROBACK_STORAGE?: R2Bucket },
  ) {}

  setBaseUrl(url: string): void {
    if (!this.baseUrl) this.baseUrl = url;
  }

  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  private requireR2(): R2Bucket {
    const r2 = this.env.ZEROBACK_STORAGE;
    if (!r2) throw new Error("File storage not configured. Add a [[r2_buckets]] binding named ZEROBACK_STORAGE to your wrangler.toml.");
    return r2;
  }

  createStorageOps(): StorageOps {
    const doId = this.ctx.id.toString();

    return {
      generateUploadUrl: async () => {
        this.requireR2();
        if (!this.baseUrl) throw new Error("Base URL not available — storage requires HTTP request context");
        const token = crypto.randomUUID();
        this.uploadTokens.set(token, { expiresAt: Date.now() + 60_000 });
        return `${this.baseUrl}/storage/upload?token=${token}`;
      },

      getUrl: async (storageId: string) => {
        const rows = this.sql.exec(
          `SELECT id FROM _storage WHERE id = ?`, storageId
        ).toArray();
        if (rows.length === 0) return null;
        if (!this.baseUrl) throw new Error("Base URL not available — storage requires HTTP request context");
        return `${this.baseUrl}/storage/${storageId}`;
      },

      getMetadata: async (storageId: string) => {
        const rows = this.sql.exec(
          `SELECT id, sha256, content_type, size FROM _storage WHERE id = ?`, storageId
        ).toArray() as { id: string; sha256: string; content_type: string; size: number }[];
        if (rows.length === 0) return null;
        const row = rows[0];
        return {
          storageId: row.id,
          sha256: row.sha256,
          contentType: row.content_type,
          size: row.size,
        };
      },

      deleteFile: async (storageId: string) => {
        const bucket = this.requireR2();
        const rows = this.sql.exec(
          `SELECT r2_key FROM _storage WHERE id = ?`, storageId
        ).toArray() as { r2_key: string }[];
        if (rows.length > 0) {
          await bucket.delete(rows[0].r2_key);
          this.sql.exec(`DELETE FROM _storage WHERE id = ?`, storageId);
        }
      },

      store: async (blob: Blob) => {
        const bucket = this.requireR2();
        const storageId = `_storage/${crypto.randomUUID()}`;
        const r2Key = `${doId}/${storageId}`;
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        const sha256 = [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
        await bucket.put(r2Key, buffer, {
          httpMetadata: { contentType: blob.type || "application/octet-stream" },
        });
        this.sql.exec(
          `INSERT INTO _storage (id, sha256, content_type, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          storageId, sha256, blob.type || "application/octet-stream", blob.size, r2Key, Date.now()
        );
        return storageId;
      },
    };
  }

  // -- Internal HTTP handlers --

  handleValidateUpload(url: URL): Response {
    const token = url.searchParams.get("token");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const entry = this.uploadTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      this.uploadTokens.delete(token!);
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    // One-time use
    this.uploadTokens.delete(token);

    return new Response(
      JSON.stringify({ valid: true, doId: this.ctx.id.toString() }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  async handleStorageRecord(req: Request): Promise<Response> {
    const body = await req.json() as { storageId: string; sha256: string; contentType: string; size: number; r2Key: string };
    this.sql.exec(
      `INSERT INTO _storage (id, sha256, content_type, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      body.storageId, body.sha256, body.contentType, body.size, body.r2Key, Date.now()
    );
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  async handleStorageDelete(req: Request): Promise<Response> {
    const body = await req.json() as { storageId: string };
    const rows = this.sql.exec(
      `SELECT r2_key FROM _storage WHERE id = ?`, body.storageId
    ).toArray() as { r2_key: string }[];

    if (rows.length > 0) {
      const r2 = this.env.ZEROBACK_STORAGE;
      if (r2) {
        await r2.delete(rows[0].r2_key);
      }
      this.sql.exec(`DELETE FROM _storage WHERE id = ?`, body.storageId);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  /** Clear all storage metadata and R2 objects (used by dev reset). */
  clearAll(): void {
    const storageRows = this.sql.exec(`SELECT r2_key FROM _storage`).toArray() as { r2_key: string }[];
    if (storageRows.length > 0) {
      const r2 = this.env.ZEROBACK_STORAGE;
      if (r2) {
        for (const row of storageRows) {
          r2.delete(row.r2_key);
        }
      }
    }
    this.sql.exec(`DELETE FROM _storage`);
    this.uploadTokens.clear();
  }
}

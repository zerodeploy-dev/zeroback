import type { Env } from "./ZerobackDO"
import { dashboardHtml } from "./dashboard-html"

export { createZerobackDO } from "./ZerobackDO"
export type { RuntimeConfig, FunctionDef, HttpRouterLike, Env } from "./ZerobackDO"

/**
 * Extract tenant slug from URL path.
 *
 *   /t/{slug}/ws      → slug
 *   /t/{slug}/health  → slug
 *   /ws               → "default"
 *   /health           → null  (handled at worker level)
 */
function extractTenant(pathname: string): { slug: string; forwardPath: string } | null {
  const match = pathname.match(/^\/t\/([^/]+)(\/.*)?$/);
  if (match) {
    return { slug: match[1], forwardPath: match[2] || "/" };
  }

  // Backward compat: bare /ws goes to "default" tenant
  if (pathname === "/ws" || pathname.startsWith("/ws?")) {
    return { slug: "default", forwardPath: "/ws" };
  }

  // All other paths (HTTP actions) go to "default" tenant
  if (pathname.startsWith("/")) {
    return { slug: "default", forwardPath: pathname };
  }

  return null;
}

/**
 * Compute the tenant prefix for constructing external URLs.
 * "default" tenant has no prefix; named tenants get /t/{slug}.
 */
function tenantPrefix(slug: string): string {
  return slug === "default" ? "" : `/t/${slug}`;
}

/**
 * Compute SHA-256 hex digest of an ArrayBuffer.
 */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const workerHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Worker-level health check (not tenant-specific)
    if (url.pathname === "/health") {
      return new Response("OK");
    }

    // Dashboard SPA (dev only — enabled via ZEROBACK_DASHBOARD=true)
    if (url.pathname === "/_dashboard" || url.pathname.startsWith("/_dashboard/")) {
      if (env.ZEROBACK_DASHBOARD !== "true") {
        return new Response("Not found", { status: 404 });
      }
      return new Response(dashboardHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    if (!env.ZEROBACK_DO) {
      return new Response("ZEROBACK_DO binding not configured", { status: 500 });
    }

    const tenant = extractTenant(url.pathname);
    if (!tenant) {
      return new Response("Not found", { status: 404 });
    }

    // Derive base URL from Host header (url.origin may be an internal
    // hostname in wrangler dev / workerd).
    const host = request.headers.get("Host") ?? url.host;
    const protocol = url.protocol;
    const baseUrl = `${protocol}//${host}${tenantPrefix(tenant.slug)}`;

    // -- Storage upload route (Worker handles file I/O, DO handles metadata) --
    if (tenant.forwardPath === "/storage/upload" && request.method === "POST") {
      return handleStorageUpload(request, env, tenant.slug, baseUrl, url);
    }

    // -- Storage download route (Worker only, zero DO calls) --
    const storageMatch = tenant.forwardPath.match(/^\/storage\/(_storage\/[0-9a-f-]+)$/);
    if (storageMatch && request.method === "GET") {
      return handleStorageDownload(env, tenant.slug, storageMatch[1]);
    }

    const doId = env.ZEROBACK_DO.idFromName(tenant.slug);
    const doStub = env.ZEROBACK_DO.get(doId);

    // Forward to DO with the tenant prefix stripped + base URL header
    const forwardUrl = new URL(request.url);
    forwardUrl.pathname = tenant.forwardPath;
    const headers = new Headers(request.headers);
    headers.set("X-Zeroback-Base-Url", baseUrl);
    const init = {
      method: request.method,
      headers,
      body: request.body,
      duplex: request.body ? ("half" as const) : undefined,
    };
    const forwardReq = new Request(forwardUrl.toString(), init);

    return doStub.fetch(forwardReq);
  },
};

async function handleStorageUpload(
  request: Request,
  env: Env,
  slug: string,
  baseUrl: string,
  url: URL
): Promise<Response> {
  const r2 = env.ZEROBACK_STORAGE;
  if (!r2) {
    return new Response(
      JSON.stringify({ error: "File storage not configured. Add a [[r2_buckets]] binding named ZEROBACK_STORAGE to your wrangler.toml." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = url.searchParams.get("token");
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing upload token" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Validate token with DO (lightweight, no body)
  const doId = env.ZEROBACK_DO.idFromName(slug);
  const doStub = env.ZEROBACK_DO.get(doId);
  const validateUrl = `https://do-internal/__internal/validate-upload?token=${encodeURIComponent(token)}`;
  const validateHeaders = new Headers();
  validateHeaders.set("X-Zeroback-Base-Url", baseUrl);
  const validateRes = await doStub.fetch(new Request(validateUrl, { method: "POST", headers: validateHeaders }));

  if (!validateRes.ok) {
    const body = await validateRes.json() as { error?: string };
    return new Response(
      JSON.stringify({ error: body.error ?? "Invalid upload token" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const { doId: doIdStr } = await validateRes.json() as { doId: string };

  // Read file body and compute SHA-256
  const buffer = await request.arrayBuffer();
  const sha256 = await sha256Hex(buffer);
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  const storageId = `_storage/${crypto.randomUUID()}`;
  const r2Key = `${doIdStr}/${storageId}`;

  // Upload to R2
  await r2.put(r2Key, buffer, {
    httpMetadata: { contentType },
  });

  // Record metadata in DO
  const recordUrl = `https://do-internal/__internal/storage-record`;
  const recordHeaders = new Headers();
  recordHeaders.set("Content-Type", "application/json");
  recordHeaders.set("X-Zeroback-Base-Url", baseUrl);
  await doStub.fetch(new Request(recordUrl, {
    method: "POST",
    headers: recordHeaders,
    body: JSON.stringify({ storageId, sha256, contentType, size: buffer.byteLength, r2Key }),
  }));

  return new Response(
    JSON.stringify({ storageId }),
    { headers: { "Content-Type": "application/json" } }
  );
}

async function handleStorageDownload(
  env: Env,
  slug: string,
  storageId: string
): Promise<Response> {
  const r2 = env.ZEROBACK_STORAGE;
  if (!r2) {
    return new Response(
      JSON.stringify({ error: "File storage not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Derive R2 key deterministically — no DO call needed
  const doId = env.ZEROBACK_DO.idFromName(slug).toString();
  const r2Key = `${doId}/${storageId}`;

  const object = await r2.get(r2Key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  if (object.httpMetadata?.contentType) {
    headers.set("Content-Type", object.httpMetadata.contentType);
  }
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);

  return new Response(object.body, { headers });
}

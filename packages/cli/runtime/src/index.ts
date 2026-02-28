import { VexDO, Env } from "./VexDO";

export { VexDO };

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Worker-level health check (not tenant-specific)
    if (url.pathname === "/health") {
      return new Response("OK");
    }

    if (!env.VEX_DO) {
      return new Response("VEX_DO binding not configured", { status: 500 });
    }

    const tenant = extractTenant(url.pathname);
    if (!tenant) {
      return new Response("Not found", { status: 404 });
    }

    const doId = env.VEX_DO.idFromName(tenant.slug);
    const doStub = env.VEX_DO.get(doId);

    // Forward to DO with the tenant prefix stripped
    const forwardUrl = new URL(request.url);
    forwardUrl.pathname = tenant.forwardPath;
    const forwardReq = new Request(forwardUrl.toString(), request);

    return doStub.fetch(forwardReq);
  },
};

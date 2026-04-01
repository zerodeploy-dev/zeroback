import type { FunctionReference } from "@zeroback/server"

export type Preloaded<Ref extends FunctionReference<"query", any, any>> = {
  _fn: string
  _args: unknown
  _result: Ref["_returns"]
}

/**
 * Convert a Zeroback WebSocket URL to the HTTP /query endpoint URL.
 *   ws://localhost:8788/ws  → http://localhost:8788/query
 *   wss://example.com/ws   → https://example.com/query
 */
function toQueryUrl(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/ws$/, "/query")
}

/**
 * Fetch a query result over HTTP for use during SSR.
 * Pass the same deployment URL you use for ZerobackClient.
 * Throws if the server returns a non-2xx response.
 */
export async function preloadQuery<Ref extends FunctionReference<"query", any, any>>(
  deploymentUrl: string,
  ref: Ref,
  args?: Ref["_args"]
): Promise<Preloaded<Ref>> {
  const url = toQueryUrl(deploymentUrl)
  const resolvedArgs = args ?? {}

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fn: ref._name, args: resolvedArgs }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; code?: string }
    throw new Error(body.code ?? body.error ?? `HTTP ${res.status}`)
  }

  const { result } = await res.json() as { result: Ref["_returns"] }
  return { _fn: ref._name, _args: resolvedArgs, _result: result }
}

---
title: Authentication
description: Bring your own authentication to Zeroback. Verify users in your Worker before they reach the Durable Object.
sidebar:
  badge:
    text: BYOA
    variant: caution
---

Zeroback does not (yet) include a built-in auth system. Instead, you **bring your own authentication** — verify users in your Worker's `fetch()` handler before forwarding requests to the Durable Object.

:::note[Built-in auth is coming]
We're working on adding built-in authentication to Zeroback — session management, OAuth, and magic links, all running inside your Durable Object with zero external dependencies. Until then, the BYOA pattern described here is the recommended approach and will continue to be supported.
:::

This keeps auth decoupled from the framework: use any provider (Clerk, Auth0, Lucia, WorkOS, cookie sessions, JWTs) and any verification strategy. Zeroback doesn't care how you authenticate — it only needs the Worker to gate access.

## How It Works

```
┌────────────┐                ┌───────────────────┐                ┌────────────────┐
│            │   cookie/JWT   │                   │    forward     │                │
│   Browser  │ ─────────────→ │  Worker fetch()   │ ─────────────→ │  ZerobackDO    │
│            │                │  verify auth      │    request     │  (trusted)     │
│            │                │  reject or forward│                │                │
└────────────┘                └───────────────────┘                └────────────────┘
```

The Worker acts as a gateway. Unauthenticated requests get a `401` and never reach the Durable Object. Authenticated requests are forwarded as-is.

## Setup

### 1. Write a verify function

Create an `auth.ts` that verifies the incoming request. This example validates a session cookie against an external API via a [service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/):

```typescript
// auth.ts
import type { Env } from "./index"

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; error: string }

export async function verifyAuth(
  request: Request,
  env: Env
): Promise<AuthResult> {
  const cookie = request.headers.get("Cookie")
  if (!cookie) {
    return { ok: false, error: "Not authenticated" }
  }

  try {
    // Call your auth service — service binding, JWT verify, etc.
    const res = await env.AUTH_API.fetch(
      new Request("https://auth.example.com/me", {
        headers: { Cookie: cookie },
      })
    )

    if (!res.ok) {
      return { ok: false, error: "Not authenticated" }
    }

    const data = (await res.json()) as { id: string }
    return { ok: true, userId: data.id }
  } catch {
    return { ok: false, error: "Auth service unavailable" }
  }
}
```

**Other verification strategies:**

- **JWT**: Use `jose` or `@clerk/backend` to verify a JWT from the `Authorization` header. No external call needed.
- **Session cookie**: Look up a session token in KV or D1.
- **Service binding**: Forward the cookie to another Worker that owns auth (zero network roundtrip — shown above).

### 2. Gate requests in your Worker

Your Worker's `fetch()` handler verifies auth before forwarding to the Durable Object:

```typescript
// index.ts
import { createZerobackDO } from "@zeroback/runtime"
import { functions, schema, httpRouter, cronJobsDef } from "./zeroback/_generated/manifest"
import { verifyAuth } from "./auth"

export const ZerobackDO = createZerobackDO({ functions, schema, httpRouter, cronJobsDef })

export interface Env {
  ZEROBACK_DO: DurableObjectNamespace
  AUTH_API: Fetcher  // service binding to your auth worker
}

function getDOStub(env: Env): DurableObjectStub {
  const doId = env.ZEROBACK_DO.idFromName("default")
  return env.ZEROBACK_DO.get(doId)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Public routes (no auth)
    if (url.pathname === "/health") {
      return new Response("ok")
    }

    // Verify auth
    const auth = await verifyAuth(request, env)
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ error: auth.error }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      )
    }

    // Forward to Zeroback DO
    const doStub = getDOStub(env)
    return doStub.fetch(request)
  },
}
```

This applies to **all** Zeroback traffic — WebSocket connections (`/ws`), HTTP actions, and function calls. If the auth check fails, the request never reaches the Durable Object.

### 3. Add CORS (if your frontend is on a different origin)

If your frontend and backend are on different origins, add CORS headers:

```typescript
function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? ""

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    // ... auth check ...

    const response = await doStub.fetch(request)

    // Add CORS headers to response
    const newResponse = new Response(response.body, response)
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      newResponse.headers.set(key, value)
    }
    return newResponse
  },
}
```

**Important:** Set `Access-Control-Allow-Credentials: "true"` so cookies are sent with cross-origin requests. Your frontend must also set `credentials: "include"` on fetch calls (the Zeroback client does this automatically for WebSocket connections).

## JWT Verification Example

If your auth provider issues JWTs (Clerk, Auth0, Supabase), you can verify them directly in the Worker without an external call:

```typescript
// auth.ts
import { jwtVerify, createRemoteJWKSet } from "jose"

const JWKS = createRemoteJWKSet(
  new URL("https://your-app.clerk.accounts.dev/.well-known/jwks.json")
)

export async function verifyAuth(request: Request): Promise<AuthResult> {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "")
  if (!token) {
    return { ok: false, error: "No token" }
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: "https://your-app.clerk.accounts.dev",
      audience: "your-app",
    })
    return { ok: true, userId: payload.sub! }
  } catch {
    return { ok: false, error: "Invalid token" }
  }
}
```

## Multi-Tenant Routing

For multi-tenant apps, you can use the authenticated user to route to different Durable Objects:

```typescript
function getDOStub(env: Env, tenantId: string): DurableObjectStub {
  const doId = env.ZEROBACK_DO.idFromName(tenantId)
  return env.ZEROBACK_DO.get(doId)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = await verifyAuth(request, env)
    if (!auth.ok) {
      return new Response("Unauthorized", { status: 401 })
    }

    // Route to tenant-specific DO
    const doStub = getDOStub(env, auth.tenantId)
    return doStub.fetch(request)
  },
}
```

Each tenant gets its own Durable Object with isolated SQLite storage. Auth determines which DO handles the request.

## Summary

| Concern | Where it lives |
|---------|---------------|
| Authentication (who are you?) | Worker `fetch()` — your code |
| Transport (WebSocket, HTTP) | Zeroback runtime |
| Authorization (can you do this?) | Your Zeroback functions |
| Data isolation | DO routing (single or multi-tenant) |

The Worker is the security boundary. Everything behind it — queries, mutations, subscriptions — is trusted internal traffic.

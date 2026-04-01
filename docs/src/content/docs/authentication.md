---
title: Authentication
description: Built-in authentication powered by better-auth
---

## Overview

Zeroback ships with built-in authentication powered by [better-auth](https://www.better-auth.com/), running entirely inside your Durable Object. There is no external auth service to configure or pay for — sessions, user accounts, and OAuth tokens all live in the same SQLite database as your application data.

Key properties:

- **Email/password** sign-up and sign-in out of the box
- **OAuth providers** — Google and GitHub with minimal config
- **Cookie-based sessions** with configurable expiry
- **Zero-schema pollution** — auth tables are hidden from codegen and your functions
- **Opt-out** with `zeroback init --no-auth` if you prefer to bring your own auth

---

## Getting Started

### 1. Scaffold your project

`zeroback init` creates `zeroback/auth.ts` automatically:

```bash
zeroback init my-app
```

To skip auth entirely:

```bash
zeroback init my-app --no-auth
```

### 2. Configure auth

The generated `zeroback/auth.ts` exports an `auth` constant created with `defineAuth`:

```typescript
// zeroback/auth.ts
import { defineAuth } from "@zeroback/server"

export const auth = defineAuth({
  emailAndPassword: true,
})
```

That is all that is required to get email/password auth working.

### 3. Set the secret

Add `BETTER_AUTH_SECRET` to your environment. For local development, create `.dev.vars` in your project root (Wrangler picks this up automatically):

```bash
# .dev.vars
BETTER_AUTH_SECRET=a-long-random-string-at-least-32-characters
```

For production, set it via Wrangler secrets:

```bash
wrangler secret put BETTER_AUTH_SECRET
```

If the secret is missing, Zeroback logs a warning and uses an insecure fallback value — fine for development, not for production.

---

## Configuration (`defineAuth`)

```typescript
import { defineAuth } from "@zeroback/server"

export const auth = defineAuth({
  // Enable email + password sign-up and sign-in
  emailAndPassword: true,

  // OAuth providers — reads client credentials from env automatically
  providers: [
    { type: "google" },   // reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
    { type: "github" },   // reads GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
  ],

  // Allow cross-origin requests from specific origins
  trustedOrigins: ["https://your-app.com"],

  // Session lifetime — default is 7 days
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days in seconds
  },
})
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `emailAndPassword` | `boolean` | `true` | Enable email/password auth |
| `providers` | `Array<{ type: "google" \| "github" }>` | `[]` | OAuth providers |
| `trustedOrigins` | `string[]` | `[]` | Allowed origins for cross-origin requests |
| `session.expiresIn` | `number` | 604800 (7 days) | Session lifetime in seconds |

---

## Using Auth in Functions

Inside queries, mutations, and actions, `ctx.auth.getUserIdentity()` returns the signed-in user or `null` for unauthenticated requests.

```typescript
import { query, mutation } from "./_generated/server"

// Return the current user's profile
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return null
    }
    return {
      id: identity.subject,
      email: identity.email,
      name: identity.name,
    }
  },
})

// Only allow authenticated users to create records
export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Must be signed in to create a task")
    }
    await ctx.db.insert("tasks", {
      text: args.text,
      userId: identity.subject,
    })
  },
})
```

### `UserIdentity` fields

| Field | Type | Description |
|-------|------|-------------|
| `subject` | `string` | Unique user ID |
| `issuer` | `string` | Always `"zeroback"` for built-in auth |
| `tokenIdentifier` | `string` | `"zeroback|<subject>"` — unique across providers |
| `email` | `string \| undefined` | User's email address |
| `emailVerified` | `boolean \| undefined` | Whether the email has been verified |
| `name` | `string \| undefined` | Display name |
| `pictureUrl` | `string \| undefined` | Profile picture URL |

If the request has no valid session cookie, `getUserIdentity()` returns `null`. Functions that require authentication should always check for `null` and throw or return early.

---

## Auth HTTP Endpoints

Zeroback mounts all better-auth routes under `/auth/`. The most commonly used endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/sign-up/email` | Create a new account |
| `POST` | `/auth/sign-in/email` | Sign in with email and password |
| `POST` | `/auth/sign-out` | End the current session |
| `GET` | `/auth/get-session` | Return the current session |
| `GET` | `/auth/sign-in/social?provider=google` | Start OAuth sign-in |

These are handled automatically — you do not need to write any HTTP routes for them.

---

## Client SDK

Pass `auth: true` when creating your `ZerobackClient` to enable the auth namespace:

```typescript
import { ZerobackClient } from "@zeroback/client"

const client = new ZerobackClient("wss://your-worker.workers.dev/ws", {
  auth: true,
})

// Sign up
await client.auth.signUp({
  email: "user@example.com",
  password: "password123",
  name: "Alice",
})

// Sign in
await client.auth.signIn({
  email: "user@example.com",
  password: "password123",
})

// Get the current session
const session = await client.auth.getSession()
// { user: { id, email, name, image } } or null

// Sign out
await client.auth.signOut()
```

### OAuth (browser only)

```typescript
// Redirects the browser to the OAuth provider
client.auth.signInWithGoogle()
client.auth.signInWithGitHub()
```

After the OAuth flow completes, the provider redirects back to your app. The client reconnects automatically with the new session.

---

## React Hooks

Use `useAuth()` to access session state in React components:

```tsx
import { useAuth } from "@zeroback/react"

function Header() {
  const { isLoading, isAuthenticated, user, signOut } = useAuth()

  if (isLoading) return <span>Loading...</span>

  if (!isAuthenticated) {
    return <a href="/login">Sign in</a>
  }

  return (
    <div>
      <span>Hello, {user?.name}</span>
      <button onClick={signOut}>Sign out</button>
    </div>
  )
}
```

`useAuth()` requires `auth: true` in your `ZerobackClient` options and a `<ZerobackProvider>` wrapping your component tree:

```tsx
import { ZerobackProvider, ZerobackClient } from "@zeroback/react"

const client = new ZerobackClient("wss://...", { auth: true })

export default function App() {
  return (
    <ZerobackProvider client={client}>
      <Header />
      {/* rest of app */}
    </ZerobackProvider>
  )
}
```

---

## Cross-Origin Deployments

If your frontend is on a different origin than your Zeroback Worker (for example, `app.example.com` vs `api.example.com`), you need two things:

**1. Add trusted origins to `defineAuth`:**

```typescript
export const auth = defineAuth({
  emailAndPassword: true,
  trustedOrigins: ["https://app.example.com"],
})
```

**2. Configure CORS in your Worker** to allow credentials from that origin.

**3. Use `credentials: "include"` in fetch calls** (the Zeroback client handles this automatically).

### Vite dev proxy

During development, the easiest approach is to proxy `/auth` requests through Vite so they appear same-origin:

```typescript
// vite.config.ts
export default {
  server: {
    proxy: {
      "/auth": "http://localhost:8788",
    },
  },
}
```

This avoids CORS issues entirely during local development. In production, set `trustedOrigins` for your deployed frontend domain.

---

## Auth Without Init (--no-auth)

If you don't need built-in auth, scaffold without it:

```bash
zeroback init my-app --no-auth
```

No `zeroback/auth.ts` is created, no auth routes are mounted, and `ctx.auth` is not available in functions. This is the right choice if you want to authenticate users before they reach Zeroback (for example, using a Cloudflare Access policy or a JWT you verify in your Worker).

---

## Alternative: Bring Your Own Auth

Built-in auth is opt-in. You can keep using any external auth provider with the BYOA pattern — verify users in your Worker's `fetch()` handler before forwarding requests to the Durable Object.

```typescript
// index.ts (Worker entry point)
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Verify your JWT or session cookie here
    const token = request.headers.get("Authorization")?.replace("Bearer ", "")
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Validate the token (using jose, @clerk/backend, etc.)
    // ...

    // Forward to Zeroback
    const doId = env.ZEROBACK_DO.idFromName("default")
    const stub = env.ZEROBACK_DO.get(doId)
    return stub.fetch(request)
  },
}
```

The Worker acts as a security boundary. Everything behind it — WebSocket connections, queries, mutations — is trusted internal traffic.

Common BYOA providers:
- **Clerk** — verify JWTs using `@clerk/backend`
- **Auth0** — verify JWTs using `jose` and the Auth0 JWKS endpoint
- **WorkOS** — use their Node.js SDK
- **KV sessions** — look up a session token in Cloudflare KV

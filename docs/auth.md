# Authentication

> **Status: Not yet implemented** — Design document.

Cloudflare doesn't have a managed auth service — no equivalent to Firebase Auth or Supabase Auth. You're expected to bring your own (Clerk, Auth0, etc.) or roll a custom solution. This is a real gap in the ecosystem.

Zeroback fills it. Built-in authentication runs entirely inside your Durable Object — email/password, OAuth, magic links, and anonymous auth with zero external dependencies. Your user data never leaves your Cloudflare account.

You can also use an external provider (Clerk, Auth0) if you already have one. Both paths expose the same `ctx.auth.getUserIdentity()` API in your functions.

## Built-in Auth (Primary)

Zeroback's built-in auth is powered by [better-auth](https://www.better-auth.com) and stores everything in your Durable Object's SQLite — users, sessions, accounts, verification tokens. Zero external dependencies.

### Setup

```typescript
// zeroback/auth.ts
import { defineAuth } from "@zeroback/server"

export default defineAuth({
  // Email + password (enabled by default)
  emailAndPassword: true,

  // OAuth providers (optional)
  providers: [
    { type: "google" },
    { type: "github" },
  ],

  // Magic link via email (optional)
  magicLink: {
    sendEmail: async ({ email, url }) => {
      // Use Resend, Cloudflare Email Workers, etc.
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "noreply@yourapp.com",
          to: email,
          subject: "Sign in to your account",
          html: `<a href="${url}">Click here to sign in</a>`,
        }),
      })
    },
  },

  // Anonymous auth (optional) — guest users that can upgrade later
  anonymous: true,

  // Session config (optional)
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
  },
})
```

Environment variables for OAuth providers (set via `wrangler secret`):

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

### Auth Routes

Zeroback automatically exposes auth endpoints on your worker:

```
POST /auth/sign-up/email          # Email + password registration
POST /auth/sign-in/email          # Email + password login
POST /auth/sign-in/magic-link     # Send magic link
GET  /auth/magic-link/verify      # Verify magic link token
GET  /auth/sign-in/social?provider=google
GET  /auth/sign-in/social?provider=github
GET  /auth/callback/google
GET  /auth/callback/github
POST /auth/sign-in/anonymous      # Guest sign-in
GET  /auth/get-session
POST /auth/sign-out
GET  /auth/list-sessions
POST /auth/revoke-session
```

### Client SDK

```typescript
import { ZerobackClient } from "@zeroback/client"

const client = new ZerobackClient("ws://localhost:8788/ws")

// Email + password
await client.auth.signUp({ email: "alice@example.com", password: "..." })
await client.auth.signIn({ email: "alice@example.com", password: "..." })

// OAuth (opens redirect)
await client.auth.signInWithGoogle()
await client.auth.signInWithGitHub()

// Magic link
await client.auth.sendMagicLink("alice@example.com")

// Anonymous (guest)
await client.auth.signInAnonymously()

// Session
const session = await client.auth.getSession()
await client.auth.signOut()

// Upgrade anonymous user to a real account
await client.auth.linkGoogle()
await client.auth.linkGitHub()
```

### React

```tsx
import { ZerobackProvider, useAuth, useQuery } from "@zeroback/react"
import { api } from "../zeroback/_generated/api"

function App() {
  return (
    <ZerobackProvider client={client}>
      <Auth />
    </ZerobackProvider>
  )
}

function Auth() {
  const { isAuthenticated, user, signIn, signOut } = useAuth()

  if (!isAuthenticated) {
    return (
      <div>
        <button onClick={() => signIn.google()}>Sign in with Google</button>
        <button onClick={() => signIn.github()}>Sign in with GitHub</button>
      </div>
    )
  }

  return (
    <div>
      <p>Signed in as {user.email}</p>
      <button onClick={signOut}>Sign out</button>
      <Tasks />
    </div>
  )
}

function Tasks() {
  const tasks = useQuery(api.tasks.myTasks)
  return <ul>{tasks?.map((t) => <li key={t._id}>{t.text}</li>)}</ul>
}
```

### Internal Tables

Built-in auth stores data in internal tables (prefixed `_auth_`, managed by Zeroback):

| Table | Purpose |
|-------|---------|
| `_auth_users` | User accounts (email, name, emailVerified, isAnonymous) |
| `_auth_sessions` | Active sessions (token, expiry, IP, user agent) |
| `_auth_accounts` | Linked providers (google, github, email, magic-link) |
| `_auth_verifications` | Pending verification tokens (magic links, email verify) |

These are invisible to your `ctx.db` queries — they don't appear in your schema or pollute your data model.

---

## External Providers (Alternative)

If you already use Clerk, Auth0, or another OpenID Connect provider, you can use it instead of built-in auth. The client passes a JWT token, and Zeroback validates it server-side.

```
┌──────────┐     JWT      ┌─────────────────┐    WebSocket     ┌──────────────┐
│  Auth     │ ──────────→  │  ZerobackClient │ ──────────────→  │  ZerobackDO  │
│  Provider │              │  (browser)      │   token param    │  validates   │
│  (Clerk)  │              │                 │                  │  JWT → ctx   │
└──────────┘               └─────────────────┘                  └──────────────┘
```

### Configuration

```typescript
// zeroback/auth.ts
import { defineAuth } from "@zeroback/server"

export default defineAuth({
  // Use an external OpenID Connect provider instead of built-in auth
  externalProviders: [
    {
      domain: "https://your-app.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
})
```

Zeroback validates the JWT using the provider's JWKS endpoint, verifies `iss` and `aud` claims, and extracts the identity.

### Client Setup

```typescript
import { ZerobackClient } from "@zeroback/client"

const client = new ZerobackClient("ws://localhost:8788/ws")

// Pass the JWT from your auth provider
client.setAuth(tokenFromClerk)

// Clear on logout
client.clearAuth()
```

With Clerk + React:

```tsx
import { useAuth } from "@clerk/clerk-react"
import { useEffect } from "react"

function AuthSync({ client }: { client: ZerobackClient }) {
  const { getToken, isSignedIn } = useAuth()

  useEffect(() => {
    if (!isSignedIn) {
      client.clearAuth()
      return
    }
    const sync = async () => {
      const token = await getToken({ template: "zeroback" })
      client.setAuth(token)
    }
    sync()
    const interval = setInterval(sync, 60_000)
    return () => clearInterval(interval)
  }, [isSignedIn])

  return null
}
```

---

## Using Auth in Functions

Regardless of whether you use built-in or external auth, the API in your functions is the same.

### `ctx.auth.getUserIdentity()`

Returns the authenticated user's identity, or `null` if unauthenticated.

```typescript
import { query, mutation } from "./_generated/server"
import { v } from "@zeroback/values"

export const myTasks = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    return await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect()
  },
})

export const createTask = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Unauthenticated")

    await ctx.db.insert("tasks", {
      text: args.text,
      userId: identity.subject,
    })
  },
})
```

### `UserIdentity`

```typescript
interface UserIdentity {
  // Always present
  subject: string         // User ID
  issuer: string          // "zeroback" for built-in, provider URL for external
  tokenIdentifier: string // Unique across providers (subject + issuer)

  // Standard claims
  email?: string
  emailVerified?: boolean
  name?: string
  pictureUrl?: string

  // Built-in auth extras
  isAnonymous?: boolean

  // Custom claims (external providers)
  [key: string]: unknown
}
```

---

## Authorization Patterns

Zeroback does not have a built-in authorization framework. You write authorization checks in your functions — this keeps things simple, explicit, and easy to reason about.

### Pattern 1: Check at the top of each function

```typescript
export const updateProject = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Unauthenticated")

    const member = await ctx.db
      .query("members")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", identity.subject).eq("projectId", args.projectId)
      )
      .first()

    if (!member || member.role !== "admin") {
      throw new Error("Not authorized")
    }

    await ctx.db.patch(args.projectId, { name: args.name })
  },
})
```

### Pattern 2: Helper functions for common checks

```typescript
// zeroback/helpers.ts
import { QueryCtx, MutationCtx } from "./_generated/server"

export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Unauthenticated")
  return identity
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const identity = await requireAuth(ctx)
  const user = await ctx.db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
    .first()
  if (!user || user.role !== "admin") {
    throw new Error("Admin access required")
  }
  return user
}

export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  projectId: string
) {
  const identity = await requireAuth(ctx)
  const member = await ctx.db
    .query("members")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", identity.subject).eq("projectId", projectId)
    )
    .first()
  if (!member) throw new Error("Not a member of this project")
  return member
}
```

```typescript
// zeroback/projects.ts
import { requireAdmin, requireMember } from "./helpers"

export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    return await ctx.db.query("admin_settings").collect()
  },
})

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId)
    return await ctx.db.get(args.projectId)
  },
})
```

### Pattern 3: Storing users in the database

Map auth identities to app-level user records with roles, preferences, etc:

```typescript
// zeroback/schema.ts
export const schema = defineSchema({
  users: defineTable({
    subject: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.string(),
  })
    .index("by_subject", ["subject"]),

  tasks: defineTable({
    userId: v.id("users"),
    text: v.string(),
    completed: v.boolean(),
  })
    .index("by_user", ["userId"]),
})
```

```typescript
// zeroback/users.ts
export const getOrCreate = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Unauthenticated")

    const existing = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .first()

    if (existing) return existing._id

    return await ctx.db.insert("users", {
      subject: identity.subject,
      name: identity.name ?? "Anonymous",
      email: identity.email ?? "",
      role: "member",
    })
  },
})
```

---

## Sources

- [better-auth](https://www.better-auth.com)
- [Convex Authentication](https://docs.convex.dev/auth)
- [Convex Auth in Functions](https://docs.convex.dev/auth/functions-auth)
- [Convex Authorization Best Practices](https://stack.convex.dev/authorization)

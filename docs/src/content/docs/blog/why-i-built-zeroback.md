---
title: Why I Built Zeroback
description: I built Zeroback — an open-source, self-hosted Convex alternative running on Cloudflare Durable Objects. Real-time queries, type-safe codegen, your infrastructure.
pagefind: false
head:
  - tag: title
    content: "Why I Built Zeroback — An Open-Source Convex Alternative on Cloudflare"
  - tag: meta
    attrs:
      name: description
      content: "I built Zeroback — an open-source, self-hosted Convex alternative running on Cloudflare Durable Objects. Real-time queries, type-safe codegen, your infrastructure."
---

*March 27, 2026* · By [Ran Yefet](https://x.com/ranyefet)

Cloudflare has everything you need to build a backend. Workers for compute. D1 for SQL. R2 for storage. Durable Objects for stateful coordination. I built an entire [hosting platform](https://zerodeploy.dev) on Cloudflare without a single external service.

But when I needed a real-time backend — database, subscriptions, type-safe functions — there was nothing that tied it all together. The infrastructure exists. The developer experience doesn't.

If you want a backend today, you leave the ecosystem. Bolt on [Supabase](https://supabase.com). Add Firebase. Your frontend runs on Cloudflare, your backend runs somewhere else. Two vendors, two bills, your data in someone else's cloud.

I wanted an open-source, self-hosted real-time backend for Cloudflare. So I built one.

## The first attempt

I knew [Convex](https://convex.dev). I loved the developer experience — reactive queries, type-safe functions, real-time by default. But my first attempt at a Cloudflare backend wasn't Convex-inspired at all. It was Supabase-inspired.

I built a PostgREST-style API layer for D1 — Cloudflare's SQLite database. REST endpoints, query parameters for filtering, the whole thing. It worked. You could CRUD data, do joins, run aggregates. Similar goals to what Zeroback is today: database, real-time, storage, auth — all on Cloudflare.

But it didn't feel right.

The REST API was limited compared to writing actual query functions. Type safety was a constant concern — query params aren't typed, and the gap between what you write and what the database returns was too wide. And real-time was the real problem. D1 is a serverless database — there's no persistent connection, no way to push changes to clients. Bolting real-time onto D1 felt like fighting the architecture.

I shelved it. But the idea didn't go away.

## The Durable Objects discovery

Then I found something I'd overlooked. Durable Objects come with built-in SQLite storage — the same SQLite that D1 is built on. And they support WebSockets natively.

That's when it clicked.

A single Durable Object gives you a long-lived, single-threaded process with SQLite for persistence and WebSocket connections to every client. Queries, mutations, and subscriptions — all in one place. No distributed coordination. No cache invalidation across nodes. Strong consistency by default. And real-time isn't bolted on — it's the native model. The data and the connections live together.

I wasn't sure it was possible at first. Could you build a real-time database with Convex's developer experience on top of a single Durable Object? Would the performance hold up? Would the programming model work?

I started experimenting. And it worked.

## What Zeroback is

Zeroback is an open-source Convex alternative that runs on Cloudflare Durable Objects. You define a schema:

```typescript
import { defineSchema, defineTable } from "@zeroback/server";
import { v } from "@zeroback/server";

export default defineSchema({
  messages: defineTable({
    channel: v.string(),
    author: v.string(),
    body: v.string(),
  }).index("by_channel", ["channel"]),
});
```

You write functions — plain TypeScript, fully typed:

```typescript
export const list = query({
  args: { channel: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .collect();
  },
});

export const send = mutation({
  args: { channel: v.string(), author: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
  },
});
```

You call them from React:

```tsx
function Chat({ channel }) {
  const messages = useQuery(api.messages.list, { channel });
  const sendMessage = useMutation(api.messages.send);

  // messages auto-update when anyone sends a new message.
  // no refetch, no polling, no WebSocket boilerplate.
}
```

The client connects over WebSocket. Queries auto-subscribe. When a mutation changes data, Zeroback figures out which queries are affected and pushes updated results to the right clients.

Not table-level invalidation — query-level. Posting to `#random` doesn't trigger re-execution of subscriptions watching `#general`. That was the hardest problem to solve, and the one I'm most proud of.

Optimistic concurrency control handles conflicts automatically. If two mutations touch the same data, the second one retries. The client never sees a conflict. IndexedDB persistence means your app renders instantly from cache, even before the WebSocket connects.

## What's real today

This isn't a prototype. It's 7 packages, a CLI, React and Solid.js bindings, and over 300 tests:

- **Real-time subscriptions** with query-level invalidation and diff suppression
- **Type-safe codegen** — schema and functions generate a typed API object, end-to-end from database to UI
- **Indexed queries**, compound indexes, full-text search, cursor-based pagination
- **File storage**, scheduled jobs, cron — backed by R2 and Durable Object alarms
- **Offline support** — IndexedDB persistence for instant renders and offline reads

I'm using it in production. I built an email client on Zeroback — real-time inbox with threads, labels, attachments, AI-powered classification. When an email arrives, every connected client sees it instantly. The entire backend is a single Durable Object.

## What's honest

Zeroback runs on a single Durable Object. That means real limits:

- **~10 GB storage** (SQLite in a DO)
- **~1,000 concurrent connections** (self-imposed, to keep latency predictable)
- **Single-threaded execution**

This is not a database for the next billion-user app. It's a backend for apps where a team, a project, or a tenant needs real-time data with great DX and full control. Side projects, internal tools, SaaS per-tenant backends, collaborative apps, real-time dashboards.

If you need Postgres features, multi-region, or unlimited scale — use Supabase or Convex. They're more mature and feature-complete. I'm not pretending otherwise.

But if you're on Cloudflare and you've been waiting for a backend that feels right — or if you want a self-hosted Convex alternative on your own infrastructure — that's what Zeroback is for.

## What's next

Authentication is the biggest missing piece. Right now you bring your own (Clerk, Auth0, etc.). Built-in auth — email/password, OAuth, magic links — is the top priority. I'll build it when users confirm they need it, not before.

The code is open source, MIT licensed, and on [GitHub](https://github.com/zerodeploy-dev/zeroback).

## How I built it

I built Zeroback in a week. Entirely with Claude Code.

I know how that sounds. A week for 7 packages, a CLI, real-time subscriptions, codegen, optimistic concurrency, offline support, React hooks, Solid bindings, 300+ tests.

It's true, and it's the thing that made me take the leap from engineering manager back to builder. I've been managing for four years. Good at it. But I missed building. The kind of building where you close your laptop at midnight and can't wait to open it again the next day.

LLMs didn't give me the vision for Zeroback — I'd been thinking about real-time backends and Cloudflare's potential for a long time. What they gave me is leverage. The kind of leverage that lets a solo founder with a full-time job and two kids build at a pace that used to require a team.

I'm not going to pretend Claude Code wrote perfect code on the first try. It didn't. I designed the architecture, made every trade-off decision, and debugged the hard problems. I tested everything — over 300 tests across the codebase. But the velocity is real. And it changes what's possible for one person working after hours.

`npx @zeroback/cli init` and you'll have a working app in under two minutes.

I'm building this in public. If you're on Cloudflare and you've been waiting for a backend that feels right — [give it a try](https://github.com/zerodeploy-dev/zeroback). And if you want to follow the journey: [@ranyefet on X](https://x.com/ranyefet).

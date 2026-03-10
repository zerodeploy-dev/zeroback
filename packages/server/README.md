# @zeroback/server

Server APIs for Zeroback -- schema definition, queries, mutations, actions, HTTP routes, cron jobs, scheduling, and file storage running on Cloudflare Workers + Durable Objects + SQLite.

## Installation

```bash
npm install @zeroback/server
```

## Usage

Define your schema and functions:

```ts
// zeroback/schema.ts
import { defineSchema, defineTable, v } from "@zeroback/server"

export default defineSchema({
  tasks: defineTable({
    text: v.string(),
    completed: v.boolean(),
  }).index("by_completed", ["completed"]),
})
```

```ts
// zeroback/tasks.ts
import { query, mutation } from "./_generated/server"
import { v } from "@zeroback/server"

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").collect()
  },
})

export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("tasks", { text: args.text, completed: false })
  },
})
```

## Documentation

Full documentation at [zeroback.dev](https://zeroback.dev/getting-started/).

## Part of the Zeroback monorepo

[github.com/zerodeploy-dev/zeroback](https://github.com/zerodeploy-dev/zeroback)

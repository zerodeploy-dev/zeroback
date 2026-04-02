---
title: Seeding Data
description: Populate your database with initial data using a seed mutation and the CLI.
---

Zeroback doesn't have a dedicated seed command — instead, you write a regular mutation and run it with the CLI. This keeps seeding type-safe, transactional, and composable with the rest of your code.

## 1. Create a seed file

Add a file in your `zeroback/` directory:

```ts
// zeroback/seed.ts
import { mutation } from "./_generated/server"

export const run = mutation(async ({ db }) => {
  // Guard against re-seeding
  const existing = await db.query("tasks").first()
  if (existing) {
    console.log("Already seeded, skipping.")
    return "already seeded"
  }

  await db.insert("tasks", { text: "Buy groceries", completed: false })
  await db.insert("tasks", { text: "Walk the dog", completed: false })
  await db.insert("tasks", { text: "Read a book", completed: true })

  return "seeded 3 tasks"
})
```

## 2. Run it

Make sure the dev server is running:

```bash
zeroback dev
```

Then in another terminal:

```bash
zeroback run seed:run
```

The function name follows the pattern `filename:exportName`.

## Passing arguments

You can pass JSON arguments to your seed function:

```ts
// zeroback/seed.ts
import { mutation } from "./_generated/server"

export const run = mutation(async ({ db }, { count }: { count: number }) => {
  for (let i = 0; i < count; i++) {
    await db.insert("tasks", {
      text: `Task ${i + 1}`,
      completed: false,
    })
  }
  return `seeded ${count} tasks`
})
```

```bash
zeroback run seed:run '{"count": 10}'
```

## Seeding a deployed instance

By default, `zeroback run` targets `http://localhost:8788`. To seed a deployed instance, pass its URL:

```bash
zeroback run seed:run --url https://your-app.your-subdomain.workers.dev
```

## Tips

- **Always guard against re-seeding** so the script is safe to run multiple times.
- Seed functions are regular mutations — they're **transactional** and **type-safe**.
- You can create multiple exports for different scenarios (e.g. `seed:users`, `seed:products`).
- For large datasets, split inserts across multiple mutations to avoid transaction size limits.

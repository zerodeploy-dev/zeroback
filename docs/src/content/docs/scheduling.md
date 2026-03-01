---
title: Scheduling
description: Schedule one-off functions and recurring cron jobs backed by Durable Object alarms.
sidebar:
  badge:
    text: Beta
    variant: note
---

Zeroback provides two mechanisms for running functions in the future: the **Scheduler** for one-off scheduled calls, and **Cron Jobs** for recurring schedules.

## Scheduler

The scheduler is available as `ctx.scheduler` in mutations and actions. It lets you schedule a function to run at a specific time or after a delay.

Backed by SQLite + Cloudflare Durable Object Alarms.

### `scheduler.runAfter(delayMs, fnName, args?)`

Schedule a function to run after a delay.

```ts
scheduler.runAfter(
  delayMs: number,
  fnName: string,
  args?: unknown
): Promise<string>
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `delayMs` | `number` | — | Delay in milliseconds |
| `fnName` | `string` | — | Function to call (e.g., `"tasks:create"`) |
| `args` | `unknown` | `undefined` | Arguments to pass to the function |

**Returns:** A job ID (string) that can be used to cancel the scheduled job.

```ts
export const scheduleReminder = mutation({
  args: { taskId: v.string(), delayMs: v.number() },
  handler: async (ctx, args) => {
    const jobId = await ctx.scheduler.runAfter(
      args.delayMs,
      "notifications:sendReminder",
      { taskId: args.taskId }
    );
    return jobId;
  },
});
```

### `scheduler.runAt(timestamp, fnName, args?)`

Schedule a function to run at a specific time.

```ts
scheduler.runAt(
  timestamp: number,
  fnName: string,
  args?: unknown
): Promise<string>
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `timestamp` | `number` | — | Unix timestamp in milliseconds |
| `fnName` | `string` | — | Function to call |
| `args` | `unknown` | `undefined` | Arguments to pass |

**Returns:** A job ID.

```ts
export const scheduleAtTime = mutation({
  args: { taskId: v.string(), runAt: v.number() },
  handler: async (ctx, args) => {
    return await ctx.scheduler.runAt(
      args.runAt,
      "tasks:processTask",
      { taskId: args.taskId }
    );
  },
});
```

### `scheduler.cancel(id)`

Cancel a previously scheduled job.

```ts
scheduler.cancel(id: string): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | The job ID returned by `runAfter` or `runAt` |

```ts
export const cancelJob = mutation({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    await ctx.scheduler.cancel(args.jobId);
  },
});
```

## Cron Jobs

Cron jobs run functions on recurring schedules. See [Functions > Cron Jobs](functions.md#cron-jobs) for the full API reference.

Quick example:

```ts
// zeroback/crons.ts
import { cronJobs } from "@zeroback/server";

const crons = cronJobs();

crons.interval("cleanup", { minutes: 30 }, "tasks:cleanupDone");
crons.daily("digest", { hourUTC: 9 }, "email:sendDigest");
crons.cron("nightly", "0 3 * * *", "jobs:nightly");

export default crons;
```

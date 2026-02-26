import { query, mutation, action, internalQuery, internalMutation } from "./_generated/server";
import { v } from "@vex/values";

export const list = query({
  args: {
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .order("desc")
      .take(100);
  },
});

export const listPaginated = query({
  args: {
    channel: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: args.numItems ?? 10 });
  },
});

export const send = mutation({
  args: {
    body: v.string(),
    author: v.string(),
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
  },
});

export const sendViaAction = action({
  args: {
    body: v.string(),
    author: v.string(),
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation("messages:send", args);
    const messages = await ctx.runQuery("messages:list", { channel: args.channel });
    return { sent: true, count: messages.length };
  },
});

// Internal function — cannot be called from clients, only from server-side code
export const countMessages = internalQuery({
  args: {
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .collect();
    return messages.length;
  },
});

export const internalSend = internalMutation({
  args: {
    body: v.string(),
    author: v.string(),
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
  },
});

// Public action that calls internal functions
export const sendViaInternal = action({
  args: {
    body: v.string(),
    author: v.string(),
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation("messages:internalSend", args);
    const count = await ctx.runQuery("messages:countMessages", { channel: args.channel });
    return { sent: true, count };
  },
});

// Internal mutation used by cron job — deletes messages in a specific channel
export const cleanupOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", "cron-test"))
      .collect();
    let deleted = 0;
    for (const msg of old) {
      await ctx.db.delete(msg._id);
      deleted++;
    }
    return deleted;
  },
});

export const scheduleSend = mutation({
  args: {
    body: v.string(),
    author: v.string(),
    channel: v.string(),
    delayMs: v.number(),
  },
  handler: async (ctx, args) => {
    const jobId = await ctx.scheduler.runAfter(args.delayMs, "messages:send", {
      body: args.body,
      author: args.author,
      channel: args.channel,
    });
    return jobId;
  },
});

export const cancelScheduled = mutation({
  args: {
    jobId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.cancel(args.jobId);
  },
});

// Query with return value validator
export const countByChannel = query({
  args: { channel: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .collect();
    return messages.length;
  },
});

// Mutation that accepts a v.record() arg
export const sendWithMetadata = mutation({
  args: {
    body: v.string(),
    author: v.string(),
    channel: v.string(),
    metadata: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      body: args.body,
      author: args.author,
      channel: args.channel,
    });
    return { metadataKeys: Object.keys(args.metadata) };
  },
});

// Mutation that uses v.float64() and v.int64() validators
export const sendWithScore = mutation({
  args: {
    body: v.string(),
    author: v.string(),
    channel: v.string(),
    score: v.float64(),
    priority: v.int64(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      body: args.body,
      author: args.author,
      channel: args.channel,
    });
    return { score: args.score, priority: args.priority };
  },
});

// Action that calls another action via ctx.runAction
export const sendAndCount = action({
  args: {
    body: v.string(),
    author: v.string(),
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    // Call sendViaAction (which itself calls runMutation + runQuery)
    const inner = await ctx.runAction("messages:sendViaAction", args);
    return { innerResult: inner, calledFrom: "sendAndCount" };
  },
});

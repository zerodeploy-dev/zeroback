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

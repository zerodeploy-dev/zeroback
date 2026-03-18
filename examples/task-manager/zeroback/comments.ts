import { query, mutation } from "./_generated/server";
import { v } from "@zeroback/server";

export const listByTask = query({
  args: {
    taskId: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("comments")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: args.numItems ?? 20 });
  },
});

export const add = mutation({
  args: {
    body: v.string(),
    author: v.string(),
    taskId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("comments", args);
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

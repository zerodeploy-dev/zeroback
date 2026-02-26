import { query } from "../_generated/server";
import { v } from "@vex/values";

export const messageCount = query({
  args: {
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", args.channel))
      .collect();
    return { channel: args.channel, count: messages.length };
  },
});

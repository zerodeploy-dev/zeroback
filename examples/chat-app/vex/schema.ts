import { defineSchema, defineTable } from "@vex/server";
import { v } from "@vex/values";

export const schema = defineSchema({
  messages: defineTable({
    body: v.string(),
    author: v.string(),
    channel: v.string(),
  }).index("by_channel", ["channel"]),
});

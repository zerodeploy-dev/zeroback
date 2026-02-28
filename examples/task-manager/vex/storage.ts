import { query, mutation, action } from "./_generated/server";
import { v } from "@vex/values";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getFileUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const getFileMetadata = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getMetadata(args.storageId);
  },
});

export const deleteFile = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId);
  },
});

export const storeFromAction = action({
  args: { content: v.string(), contentType: v.string() },
  handler: async (ctx, args) => {
    const blob = new Blob([args.content], { type: args.contentType });
    return await ctx.storage.store(blob);
  },
});

import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { v } from "@zeroback/values";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const listByProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);
  },
});

export const listByStatus = query({
  args: { projectId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", args.status),
      )
      .order("desc")
      .collect();
  },
});

export const listPaginated = query({
  args: {
    projectId: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: args.numItems ?? 10 });
  },
});

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_id", (q) => q.eq("_id", args.id))
      .first();
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_id")
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const countByProject = query({
  args: { projectId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return tasks.length;
  },
});

export const search = query({
  args: { projectId: v.string(), priority: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("priority"), args.priority))
      .collect();
  },
});

export const searchByTitle = query({
  args: { query: v.string(), projectId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let q = ctx.db.query("tasks").search("title", args.query);
    if (args.projectId) {
      q = q.filter((f) => f.eq(f.field("projectId"), args.projectId));
    }
    return await q.take(10);
  },
});

export const listByProjectCompleted = query({
  args: { projectId: v.string(), isCompleted: v.boolean() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_project_completed", (q) =>
        q.eq("projectId", args.projectId).eq("isCompleted", args.isCompleted),
      )
      .order("desc")
      .collect();
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    title: v.string(),
    status: v.string(),
    priority: v.string(),
    projectId: v.string(),
    description: v.optional(v.string()),
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    labels: v.optional(v.array(v.string())),
    isCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("tasks", args);
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    title: v.optional(v.string()),
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    description: v.optional(v.string()),
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    labels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const createWithMetadata = mutation({
  args: {
    title: v.string(),
    status: v.string(),
    priority: v.string(),
    projectId: v.string(),
    metadata: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) => {
    const { metadata, ...taskData } = args;
    await ctx.db.insert("tasks", taskData);
    return { metadataKeys: Object.keys(metadata) };
  },
});

export const scheduleCreate = mutation({
  args: {
    title: v.string(),
    status: v.string(),
    priority: v.string(),
    projectId: v.string(),
    delayMs: v.number(),
  },
  handler: async (ctx, args) => {
    const { delayMs, ...taskData } = args;
    return await ctx.scheduler.runAfter(delayMs, "tasks:create", taskData);
  },
});

export const cancelScheduled = mutation({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    await ctx.scheduler.cancel(args.jobId);
  },
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const createViaAction = action({
  args: {
    title: v.string(),
    status: v.string(),
    priority: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation("tasks:create", args);
    const tasks = await ctx.runQuery("tasks:listByProject", {
      projectId: args.projectId,
    });
    return { created: true, count: tasks.length };
  },
});

export const createViaInternal = action({
  args: {
    title: v.string(),
    status: v.string(),
    priority: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation("tasks:createInternal", args);
    const count = await ctx.runQuery("tasks:countInternal", {
      projectId: args.projectId,
    });
    return { created: true, count };
  },
});

export const createAndCount = action({
  args: {
    title: v.string(),
    status: v.string(),
    priority: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const inner = await ctx.runAction("tasks:createViaAction", args);
    return { innerResult: inner, calledFrom: "createAndCount" };
  },
});

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

export const countInternal = internalQuery({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return tasks.length;
  },
});

export const createInternal = internalMutation({
  args: {
    title: v.string(),
    status: v.string(),
    priority: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("tasks", args);
  },
});

export const cleanupDone = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", "cron-cleanup"))
      .collect();
    for (const task of tasks) {
      await ctx.db.delete(task._id);
    }
  },
});

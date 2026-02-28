import { query } from "../_generated/server";
import { v } from "@zeroback/values";

export const taskStats = query({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return {
      projectId: args.projectId,
      total: tasks.length,
      todo: tasks.filter((t: any) => t.status === "todo").length,
      inProgress: tasks.filter((t: any) => t.status === "in_progress").length,
      done: tasks.filter((t: any) => t.status === "done").length,
    };
  },
});

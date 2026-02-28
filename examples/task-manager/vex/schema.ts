import { defineSchema, defineTable } from "@vex/server";
import { v } from "@vex/values";

export const schema = defineSchema({
  projects: defineTable({
    name: v.string(),
    description: v.string(),
    color: v.string(),
  }),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(),
    priority: v.string(),
    projectId: v.string(),
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    labels: v.optional(v.array(v.string())),
  })
    .index("by_project", ["projectId"])
    .index("by_status", ["status"])
    .index("by_project_status", ["projectId", "status"])
    .searchIndex("search_title", { searchField: "title" }),

  comments: defineTable({
    body: v.string(),
    author: v.string(),
    taskId: v.string(),
  }).index("by_task", ["taskId"]),
});

import { defineSchema, defineTable, v } from "@zeroback/server";

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
    projectId: v.id("projects"),
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    labels: v.optional(v.array(v.string())),
    isCompleted: v.optional(v.boolean()),
  })
    .index("by_project", ["projectId"])
    .index("by_status", ["status"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_project_completed", ["projectId", "isCompleted"])
    .searchIndex("search_title", { searchField: "title" }),

  comments: defineTable({
    body: v.string(),
    author: v.string(),
    taskId: v.id("tasks"),
  }).index("by_task", ["taskId"]),
});

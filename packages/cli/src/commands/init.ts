import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import * as path from "path";
import { prepareWorkerDir } from "./prepare.js";
import type { RuntimeMode } from "./prepare.js";

export async function init(projectDir: string = ".", mode: RuntimeMode = "do"): Promise<void> {
  console.log(`▲ zeroback init${mode === "d1" ? " --mode d1" : ""}\n`);

  const resolved = path.resolve(projectDir);
  const vexDir = path.join(resolved, "zeroback");
  const generatedDir = path.join(vexDir, "_generated");

  if (existsSync(vexDir)) {
    console.log("  zeroback/ directory already exists, skipping scaffolding.\n");
    return;
  }

  mkdirSync(generatedDir, { recursive: true });

  // zeroback/schema.ts
  writeFileSync(
    path.join(vexDir, "schema.ts"),
    `import { defineSchema, defineTable, v } from "@zeroback/server"

export const schema = defineSchema({
  tasks: defineTable({
    text: v.string(),
    isCompleted: v.boolean(),
  }),
})
`
  );

  // zeroback/tasks.ts — example function file
  writeFileSync(
    path.join(vexDir, "tasks.ts"),
    `import { query, mutation, v } from "./_generated/server"

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").order("desc").take(50)
  },
})

export const create = mutation({
  args: {
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("tasks", { text: args.text, isCompleted: false })
  },
})

export const toggle = mutation({
  args: {
    id: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id)
    if (!task) throw new Error("Task not found")
    await ctx.db.patch(args.id, { isCompleted: !task.isCompleted })
  },
})
`
  );

  // zeroback/_generated/server.ts — stub so imports work before first codegen run
  writeFileSync(
    path.join(generatedDir, "server.ts"),
    `import { createQueryFactory, createMutationFactory } from "@zeroback/server";

export const query = createQueryFactory<any>();
export const mutation = createMutationFactory<any>();
`
  );

  // Scaffold wrangler.toml + .zeroback/entry.ts
  prepareWorkerDir(resolved, mode);

  // Add .zeroback/ to .gitignore (but allow .zeroback/entry.ts to be committed)
  const gitignorePath = path.join(resolved, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".zeroback/")) {
      appendFileSync(gitignorePath, "\n.zeroback/*\n!.zeroback/entry.ts\n");
    }
  } else {
    writeFileSync(gitignorePath, "node_modules/\n.zeroback/*\n!.zeroback/entry.ts\n.wrangler/\n");
    console.log("  ✓ .gitignore");
  }

  console.log("  ✓ zeroback/schema.ts");
  console.log("  ✓ zeroback/tasks.ts");
  console.log("  ✓ zeroback/_generated/server.ts");
  console.log(`
Next steps:
  1. Install dependencies: bun add @zeroback/server
  2. Run 'zeroback dev' to start development
  3. Edit zeroback/schema.ts to define your tables
  4. Edit zeroback/tasks.ts to write your functions
`);
}

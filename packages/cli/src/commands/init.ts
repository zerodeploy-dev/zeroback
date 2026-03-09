import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import { execSync } from "child_process";
import * as path from "path";
import { prepareWorkerDir } from "./prepare.js";
import { detectPkgInstall } from "./pkg-manager.js";

export async function init(projectDir: string = "."): Promise<void> {
  console.log("▲ zeroback init\n");

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
    `import { defineSchema, defineTable } from "@zeroback/server";
import { v } from "@zeroback/values";

export const schema = defineSchema({
  tasks: defineTable({
    text: v.string(),
    isCompleted: v.boolean(),
  }),
});
`
  );

  // zeroback/tasks.ts — example function file
  writeFileSync(
    path.join(vexDir, "tasks.ts"),
    `import { query, mutation } from "./_generated/server";
import { v } from "@zeroback/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").collect();
  },
});

export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("tasks", { text: args.text, isCompleted: false });
  },
});

export const toggle = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (task) {
      await ctx.db.patch(args.id, { isCompleted: !task.isCompleted });
    }
  },
});
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
  prepareWorkerDir(resolved);

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

  // Auto-install backend dependencies
  const installCmd = detectPkgInstall(resolved)
  const deps = "@zeroback/server @zeroback/values @zeroback/runtime"
  console.log(`\n  Installing dependencies...\n`)
  try {
    execSync(`${installCmd} ${deps}`, { cwd: resolved, stdio: "inherit" })
    console.log(`\n  ✓ Installed ${deps}`)
  } catch {
    console.log(`\n  ⚠ Could not install automatically. Run manually:\n    ${installCmd} ${deps}\n`)
  }

  console.log(`
Next steps:
  1. Run 'zeroback dev' to start development
  2. Edit zeroback/schema.ts to define your tables
  3. Edit zeroback/tasks.ts to write your functions
`);
}

import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import * as path from "path";
import { WRANGLER_TEMPLATE } from "./prepare.js";

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
  messages: defineTable({
    body: v.string(),
    author: v.string(),
  }),
});
`
  );

  // zeroback/messages.ts — example function file
  writeFileSync(
    path.join(vexDir, "messages.ts"),
    `import { query, mutation } from "./_generated/server";
import { v } from "@zeroback/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("messages").order("desc").take(50);
  },
});

export const send = mutation({
  args: {
    body: v.string(),
    author: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
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

  // wrangler.toml at project root
  const wranglerPath = path.join(resolved, "wrangler.toml");
  if (!existsSync(wranglerPath)) {
    writeFileSync(wranglerPath, WRANGLER_TEMPLATE);
    console.log("  ✓ wrangler.toml");
  }

  // Add .zeroback/ to .gitignore
  const gitignorePath = path.join(resolved, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".zeroback/")) {
      appendFileSync(gitignorePath, "\n.zeroback/\n");
    }
  } else {
    writeFileSync(gitignorePath, "node_modules/\n.zeroback/\n.wrangler/\n");
    console.log("  ✓ .gitignore");
  }

  console.log("  ✓ zeroback/schema.ts");
  console.log("  ✓ zeroback/messages.ts");
  console.log("  ✓ zeroback/_generated/server.ts");
  console.log(`
Next steps:
  1. Run 'zeroback dev' to start development
  2. Edit zeroback/schema.ts to define your tables
  3. Edit zeroback/messages.ts to write your functions
`);
}

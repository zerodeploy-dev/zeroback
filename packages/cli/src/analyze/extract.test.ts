import { describe, it, expect } from "vitest";
import { extractSchema, extractFunctions } from "./extract";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import * as path from "path";
import * as os from "os";

function withTempSchema(source: string, fn: (schemaPath: string) => void): void {
  const dir = mkdirSync(path.join(os.tmpdir(), `vex-test-${Date.now()}`), { recursive: true }) as string;
  const schemaPath = path.join(dir, "schema.ts");
  writeFileSync(schemaPath, source);
  try {
    fn(schemaPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withTempVexDir(files: Record<string, string>, fn: (vexDir: string) => void): void {
  const dir = mkdirSync(path.join(os.tmpdir(), `vex-test-${Date.now()}`), { recursive: true }) as string;
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("extractSchema", () => {
  it("extracts v.union with literals", () => {
    withTempSchema(`
      import { defineSchema, defineTable } from "@vex/server";
      import { v } from "@vex/values";
      export default defineSchema({
        items: defineTable({
          status: v.union(v.literal("a"), v.literal("b")),
        }),
      });
    `, (schemaPath) => {
      const schema = extractSchema(schemaPath);
      expect(schema.tables.items.fields.status).toEqual({
        type: "union",
        value: [
          { type: "literal", value: "a" },
          { type: "literal", value: "b" },
        ],
      });
    });
  });

  it("extracts v.union with mixed types", () => {
    withTempSchema(`
      import { defineSchema, defineTable } from "@vex/server";
      import { v } from "@vex/values";
      export default defineSchema({
        items: defineTable({
          val: v.union(v.string(), v.number()),
        }),
      });
    `, (schemaPath) => {
      const schema = extractSchema(schemaPath);
      expect(schema.tables.items.fields.val).toEqual({
        type: "union",
        value: [{ type: "string" }, { type: "number" }],
      });
    });
  });

  it("extracts v.id with table name", () => {
    withTempSchema(`
      import { defineSchema, defineTable } from "@vex/server";
      import { v } from "@vex/values";
      export default defineSchema({
        comments: defineTable({
          taskId: v.id("tasks"),
        }),
      });
    `, (schemaPath) => {
      const schema = extractSchema(schemaPath);
      expect(schema.tables.comments.fields.taskId).toEqual({
        type: "id",
        tableName: "tasks",
      });
    });
  });

  it("extracts v.id without argument as unknown", () => {
    withTempSchema(`
      import { defineSchema, defineTable } from "@vex/server";
      import { v } from "@vex/values";
      export default defineSchema({
        items: defineTable({
          ref: v.id(),
        }),
      });
    `, (schemaPath) => {
      const schema = extractSchema(schemaPath);
      expect(schema.tables.items.fields.ref).toEqual({
        type: "id",
        tableName: "unknown",
      });
    });
  });

  it("extracts basic types (regression)", () => {
    withTempSchema(`
      import { defineSchema, defineTable } from "@vex/server";
      import { v } from "@vex/values";
      export default defineSchema({
        items: defineTable({
          name: v.string(),
          count: v.number(),
          active: v.boolean(),
          tags: v.array(v.string()),
          meta: v.optional(v.string()),
          kind: v.literal("task"),
          data: v.record(v.string(), v.any()),
          nested: v.object({ x: v.number() }),
        }),
      });
    `, (schemaPath) => {
      const schema = extractSchema(schemaPath);
      const f = schema.tables.items.fields;
      expect(f.name).toEqual({ type: "string" });
      expect(f.count).toEqual({ type: "number" });
      expect(f.active).toEqual({ type: "boolean" });
      expect(f.tags).toEqual({ type: "array", value: { type: "string" } });
      expect(f.meta).toEqual({ type: "optional", value: { type: "string" } });
      expect(f.kind).toEqual({ type: "literal", value: "task" });
      expect(f.data).toEqual({ type: "record", keys: { type: "string" }, values: { type: "any" } });
      expect(f.nested).toEqual({ type: "object", value: { x: { type: "number" } } });
    });
  });
});

describe("extractFunctions", () => {
  it("extracts function args with v.union", () => {
    withTempVexDir({
      "tasks.ts": `
        import { query } from "./server";
        import { v } from "@vex/values";
        export const get = query({
          args: { status: v.union(v.literal("open"), v.literal("closed")) },
          handler: async (ctx, args) => {},
        });
      `,
    }, (vexDir) => {
      const manifest = extractFunctions(vexDir);
      const fn = manifest["tasks:get"];
      expect(fn).toBeDefined();
      expect(fn.args).toEqual({
        type: "object",
        value: {
          status: {
            type: "union",
            value: [
              { type: "literal", value: "open" },
              { type: "literal", value: "closed" },
            ],
          },
        },
      });
    });
  });
});

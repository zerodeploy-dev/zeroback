import { existsSync, mkdirSync, writeFileSync } from "fs";
import * as path from "path";

export const WRANGLER_TEMPLATE = `name = "zeroback-backend"
main = ".zeroback/entry.ts"
compatibility_date = "2024-09-23"

[durable_objects]
bindings = [{ name = "ZEROBACK_DO", class_name = "ZerobackDO" }]

[observability]
enabled = true

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ZerobackDO"]

# Uncomment to enable file storage (requires an R2 bucket):
# [[r2_buckets]]
# binding = "ZEROBACK_STORAGE"
# bucket_name = "my-zeroback-storage"
`;

export const ENTRY_TEMPLATE = `import { createZerobackDO, workerHandler } from "@zeroback/runtime"
import { functions, schema, httpRouter, cronJobsDef } from "../zeroback/_generated/manifest"

export const ZerobackDO = createZerobackDO({ functions, schema, httpRouter, cronJobsDef })
export default workerHandler
`;

/**
 * Prepare the .zeroback/ worker directory:
 * 1. Ensure the .zeroback/ output directory exists
 * 2. Scaffold wrangler.toml at project root if missing
 * 3. Scaffold .zeroback/entry.ts if missing
 *
 * Returns the absolute path to the .zeroback/ directory.
 */
export function prepareWorkerDir(projectDir: string = "."): string {
  const resolved = path.resolve(projectDir);
  const dotZeroback = path.join(resolved, ".zeroback");
  mkdirSync(dotZeroback, { recursive: true });

  // Scaffold wrangler.toml at project root if missing
  const wranglerPath = path.join(resolved, "wrangler.toml");
  if (!existsSync(wranglerPath)) {
    writeFileSync(wranglerPath, WRANGLER_TEMPLATE);
    console.log("  ✓ Created wrangler.toml");
  }

  // Scaffold .zeroback/entry.ts if missing
  const entryPath = path.join(dotZeroback, "entry.ts");
  if (!existsSync(entryPath)) {
    writeFileSync(entryPath, ENTRY_TEMPLATE);
    console.log("  ✓ Created .zeroback/entry.ts");
  }

  return dotZeroback;
}

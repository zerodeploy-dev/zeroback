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

/**
 * Prepare the .zeroback/ worker directory:
 * 1. Ensure the .zeroback/ output directory exists
 * 2. Scaffold wrangler.toml at project root if missing
 *
 * Returns the absolute path to the .zeroback/ directory.
 */
export function prepareWorkerDir(): string {
  const dotZeroback = path.resolve(".zeroback");
  mkdirSync(dotZeroback, { recursive: true });

  // Scaffold wrangler.toml at project root if missing
  const wranglerPath = path.resolve("wrangler.toml");
  if (!existsSync(wranglerPath)) {
    writeFileSync(wranglerPath, WRANGLER_TEMPLATE);
    console.log("  ✓ Created wrangler.toml");
  }

  return dotZeroback;
}

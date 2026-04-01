import { existsSync, mkdirSync, writeFileSync } from "fs";
import * as path from "path";

function wranglerTemplate(projectName: string): string {
  return `name = "${projectName}"
main = ".zeroback/entry.ts"
compatibility_date = "2026-02-24"

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

# Custom domain: uncomment and set your domain to serve traffic on it
# routes = [{ pattern = "api.example.com", custom_domain = true }]

# Environments: uncomment to configure separate staging/production deploys
# [env.production]
# name = "${projectName}-production"
# routes = [{ pattern = "api.example.com", custom_domain = true }]
#
# [env.staging]
# name = "${projectName}-staging"
`
}

export const ENTRY_TEMPLATE = `import { createZerobackDO, workerHandler } from "@zeroback/server/runtime"
import { functions, schema, httpRouter, cronJobsDef, authDef } from "../zeroback/_generated/manifest"

export const ZerobackDO = createZerobackDO({ functions, schema, httpRouter, cronJobsDef, authDef: authDef ?? undefined })
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
    const projectName = path.basename(resolved).replace(/[^a-z0-9-]/gi, "-").toLowerCase()
    writeFileSync(wranglerPath, wranglerTemplate(projectName));
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

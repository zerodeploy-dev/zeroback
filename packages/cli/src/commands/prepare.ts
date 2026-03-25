import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";

export type RuntimeMode = "do" | "d1"

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

function wranglerD1Template(projectName: string): string {
  return `name = "${projectName}"
main = ".zeroback/entry.ts"
compatibility_date = "2026-02-24"

# D1 database — create with: wrangler d1 create zeroback-db
[[d1_databases]]
binding = "DB"
database_name = "zeroback-db"
database_id = "<run 'wrangler d1 create zeroback-db' and paste the ID here>"

[observability]
enabled = true

# Cron trigger for scheduled jobs (runs every minute)
[triggers]
crons = ["* * * * *"]

# Uncomment to enable file storage (requires an R2 bucket):
# [[r2_buckets]]
# binding = "ZEROBACK_STORAGE"
# bucket_name = "my-zeroback-storage"

# Custom domain: uncomment and set your domain to serve traffic on it
# routes = [{ pattern = "api.example.com", custom_domain = true }]
`
}

export const ENTRY_TEMPLATE = `import { createZerobackDO, workerHandler } from "@zeroback/server/runtime"
import { functions, schema, httpRouter, cronJobsDef } from "../zeroback/_generated/manifest"

export const ZerobackDO = createZerobackDO({ functions, schema, httpRouter, cronJobsDef })
export default workerHandler
`;

export const ENTRY_D1_TEMPLATE = `import { createD1Handler } from "@zeroback/server/runtime"
import { functions, schema, httpRouter, cronJobsDef } from "../zeroback/_generated/manifest"

const handler = createD1Handler({ functions, schema, httpRouter, cronJobsDef })

export default {
  fetch: handler.fetch,
  scheduled: handler.scheduled,
}
`;

/**
 * Detect runtime mode from wrangler.toml.
 * Returns "d1" if a [[d1_databases]] binding is present, otherwise "do".
 */
export function detectMode(projectDir: string = "."): RuntimeMode {
  const wranglerPath = path.join(path.resolve(projectDir), "wrangler.toml")
  if (!existsSync(wranglerPath)) return "do"
  const content = readFileSync(wranglerPath, "utf-8")
  if (content.includes("[[d1_databases]]")) return "d1"
  return "do"
}

/**
 * Prepare the .zeroback/ worker directory:
 * 1. Ensure the .zeroback/ output directory exists
 * 2. Scaffold wrangler.toml at project root if missing
 * 3. Scaffold .zeroback/entry.ts if missing
 *
 * Returns the absolute path to the .zeroback/ directory.
 */
export function prepareWorkerDir(projectDir: string = ".", mode: RuntimeMode = "do"): string {
  const resolved = path.resolve(projectDir);
  const dotZeroback = path.join(resolved, ".zeroback");
  mkdirSync(dotZeroback, { recursive: true });

  // Scaffold wrangler.toml at project root if missing
  const wranglerPath = path.join(resolved, "wrangler.toml");
  if (!existsSync(wranglerPath)) {
    const projectName = path.basename(resolved).replace(/[^a-z0-9-]/gi, "-").toLowerCase()
    const template = mode === "d1" ? wranglerD1Template(projectName) : wranglerTemplate(projectName)
    writeFileSync(wranglerPath, template);
    console.log(`  ✓ Created wrangler.toml (${mode} mode)`);
  }

  // Scaffold .zeroback/entry.ts if missing
  const entryPath = path.join(dotZeroback, "entry.ts");
  if (!existsSync(entryPath)) {
    const template = mode === "d1" ? ENTRY_D1_TEMPLATE : ENTRY_TEMPLATE
    writeFileSync(entryPath, template);
    console.log("  ✓ Created .zeroback/entry.ts");
  }

  return dotZeroback;
}

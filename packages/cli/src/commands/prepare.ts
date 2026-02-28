import { existsSync, mkdirSync, cpSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export const WRANGLER_TEMPLATE = `name = "vex-backend"
main = ".vex/src/index.ts"
compatibility_date = "2024-09-23"

[durable_objects]
bindings = [{ name = "VEX_DO", class_name = "VexDO" }]

[observability]
enabled = true

[[migrations]]
tag = "v1"
new_sqlite_classes = ["VexDO"]

# Uncomment to enable file storage (requires an R2 bucket):
# [[r2_buckets]]
# binding = "VEX_STORAGE"
# bucket_name = "my-vex-storage"
`;

/**
 * Resolve the path to the embedded runtime source files shipped with the CLI package.
 * Works from both dist/ (compiled) and src/ (development).
 */
function findRuntimeDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  // From dist/commands/prepare.js → ../../runtime/src
  // From src/commands/prepare.ts → ../../runtime/src
  const candidate = path.resolve(thisDir, "../../runtime/src");
  if (existsSync(candidate)) {
    return candidate;
  }

  throw new Error(
    `Could not find embedded runtime files. Expected at: ${candidate}`
  );
}

/**
 * Prepare the .vex/ worker directory:
 * 1. Copy runtime source files from the CLI package into .vex/src/
 * 2. Scaffold wrangler.toml at project root if missing
 *
 * Returns the absolute path to the .vex/ directory.
 */
export function prepareWorkerDir(): string {
  const dotVex = path.resolve(".vex");
  const dotVexSrc = path.join(dotVex, "src");

  // Always copy runtime files (ensures they're up to date)
  const runtimeDir = findRuntimeDir();
  mkdirSync(dotVexSrc, { recursive: true });
  cpSync(runtimeDir, dotVexSrc, { recursive: true });

  // Scaffold wrangler.toml at project root if missing
  const wranglerPath = path.resolve("wrangler.toml");
  if (!existsSync(wranglerPath)) {
    writeFileSync(wranglerPath, WRANGLER_TEMPLATE);
    console.log("  ✓ Created wrangler.toml");
  }

  return dotVex;
}

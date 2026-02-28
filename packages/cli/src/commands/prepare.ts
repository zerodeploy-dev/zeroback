import { existsSync, mkdirSync, cpSync, writeFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export const WRANGLER_TEMPLATE = `name = "zeroback-backend"
main = ".zeroback/src/index.ts"
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
 * Prepare the .zeroback/ worker directory:
 * 1. Copy runtime source files from the CLI package into .zeroback/src/
 * 2. Scaffold wrangler.toml at project root if missing
 *
 * Returns the absolute path to the .zeroback/ directory.
 */
export function prepareWorkerDir(): string {
  const dotZeroback = path.resolve(".zeroback");
  const dotZerobackSrc = path.join(dotZeroback, "src");

  // Always copy runtime files (ensures they're up to date)
  const runtimeDir = findRuntimeDir();
  mkdirSync(dotZerobackSrc, { recursive: true });
  cpSync(runtimeDir, dotZerobackSrc, { recursive: true });

  // Scaffold wrangler.toml at project root if missing
  const wranglerPath = path.resolve("wrangler.toml");
  if (!existsSync(wranglerPath)) {
    writeFileSync(wranglerPath, WRANGLER_TEMPLATE);
    console.log("  ✓ Created wrangler.toml");
  }

  return dotZeroback;
}

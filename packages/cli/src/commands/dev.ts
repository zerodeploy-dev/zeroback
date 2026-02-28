import * as chokidar from "chokidar";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";
import { extractFunctions, extractSchema } from "../analyze/extract.js";
import { generateApi } from "../codegen/api.js";
import { generateServer } from "../codegen/server.js";
import { generateDataModel } from "../codegen/dataModel.js";
import { bundle } from "../build/bundle.js";
import { existsSync, mkdirSync } from "fs";
import { prepareWorkerDir } from "./prepare.js";

export interface DevConfig {
  functionsDir?: string;
  port?: number;
}

export async function buildAndGenerate(functionsDir: string): Promise<void> {
  // 1. Analyze
  const schemaPath = path.join(functionsDir, "schema.ts");
  const schema = existsSync(schemaPath) ? extractSchema(schemaPath) : { tables: {} };
  const manifest = extractFunctions(functionsDir);

  const fnCount = Object.keys(manifest).length;
  const tableCount = Object.keys(schema.tables).length;

  // 2. Codegen
  const generatedDir = path.join(functionsDir, "_generated");
  mkdirSync(generatedDir, { recursive: true });
  generateApi(manifest, path.join(generatedDir, "api.ts"));
  generateServer(schema, path.join(generatedDir, "server.ts"));
  generateDataModel(schema, path.join(generatedDir, "dataModel.ts"));

  // 3. Generate _generated/manifest.ts with functions + schema
  await bundle(functionsDir, schema);

  console.log(`  ✓ Bundled ${fnCount} functions, ${tableCount} tables`);
}

export async function dev(config: DevConfig = {}): Promise<void> {
  const functionsDir = path.resolve(config.functionsDir || "./zeroback");
  const workerDir = prepareWorkerDir();
  const port = config.port || 8788;

  console.log("▲ zeroback dev\n");

  if (!existsSync(functionsDir)) {
    console.error(`Error: ${functionsDir} not found. Create a zeroback/ directory with your functions.`);
    process.exit(1);
  }

  // Initial build
  try {
    await buildAndGenerate(functionsDir);
  } catch (e) {
    console.error("  ✗", e instanceof Error ? e.message : e);
  }

  // Start wrangler
  console.log(`  ⠋ Starting wrangler on port ${port}...`);
  const wrangler = startWrangler(port);

  // Watch for changes
  const watcher = chokidar.watch(functionsDir, {
    ignoreInitial: true,
    ignored: ["**/_generated/**", "**/node_modules/**"],
  });

  watcher.on("all", async (event, filePath) => {
    console.log(`\n  ↺ ${event} ${path.relative(process.cwd(), filePath)}`);
    try {
      await buildAndGenerate(functionsDir);
    } catch (e) {
      console.error("  ✗", e instanceof Error ? e.message : e);
    }
  });

  // Handle shutdown
  const cleanup = () => {
    wrangler?.kill();
    watcher.close();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function startWrangler(port: number): ChildProcess {
  const child = spawn("bunx", ["wrangler", "dev", "--port", String(port), "--persist-to", ".wrangler/state"], {
    stdio: "inherit",
    shell: true,
  });

  child.on("error", (err) => {
    console.error("Failed to start wrangler:", err.message);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Wrangler exited with code ${code}`);
    }
  });

  return child;
}

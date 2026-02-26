import * as chokidar from "chokidar";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";
import { extractFunctions, extractSchema } from "../analyze/extract";
import { generateApi } from "../codegen/api";
import { generateServer } from "../codegen/server";
import { generateDataModel } from "../codegen/dataModel";
import { bundle } from "../build/bundle";
import { existsSync, mkdirSync, copyFileSync } from "fs";

export interface DevConfig {
  vexDir?: string;
  workerDir?: string;
  port?: number;
}

export async function dev(config: DevConfig = {}): Promise<void> {
  const vexDir = path.resolve(config.vexDir || "./vex");
  const workerDir = path.resolve(config.workerDir || findWorkerDir());
  const port = config.port || 8788;

  console.log("▲ vex dev\n");

  if (!existsSync(vexDir)) {
    console.error(`Error: ${vexDir} not found. Create a vex/ directory with your functions.`);
    process.exit(1);
  }

  const buildAndGenerate = async () => {
    try {
      // 1. Analyze
      const schemaPath = path.join(vexDir, "schema.ts");
      const schema = existsSync(schemaPath) ? extractSchema(schemaPath) : { tables: {} };
      const manifest = extractFunctions(vexDir);

      const fnCount = Object.keys(manifest).length;
      const tableCount = Object.keys(schema.tables).length;

      // 2. Codegen
      const generatedDir = path.join(vexDir, "_generated");
      mkdirSync(generatedDir, { recursive: true });
      generateApi(manifest, path.join(generatedDir, "api.ts"));
      generateServer(schema, path.join(generatedDir, "server.ts"));
      generateDataModel(schema, path.join(generatedDir, "dataModel.ts"));

      // 3. Bundle user functions + schema
      const outfile = path.join(workerDir, "src/_functions.generated.ts");
      await bundle(vexDir, outfile, schema);

      console.log(`  ✓ Bundled ${fnCount} functions, ${tableCount} tables`);
    } catch (e) {
      console.error("  ✗", e instanceof Error ? e.message : e);
    }
  };

  // Initial build
  await buildAndGenerate();

  // Start wrangler
  console.log(`  ⠋ Starting wrangler on port ${port}...`);
  const wrangler = startWrangler(workerDir, port);

  // Watch for changes
  const watcher = chokidar.watch(vexDir, {
    ignoreInitial: true,
    ignored: ["**/_generated/**", "**/node_modules/**"],
  });

  watcher.on("all", async (event, filePath) => {
    console.log(`\n  ↺ ${event} ${path.relative(process.cwd(), filePath)}`);
    await buildAndGenerate();
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

function startWrangler(workerDir: string, port: number): ChildProcess {
  const child = spawn("npx", ["wrangler", "dev", "--port", String(port), "--persist-to", "../../.wrangler/state"], {
    cwd: workerDir,
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

function findWorkerDir(): string {
  // Look for tenant-backend relative to common project structures
  const candidates = [
    "./cloudflare/tenant-backend",
    "../cloudflare/tenant-backend",
    "../../cloudflare/tenant-backend",
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(path.join(resolved, "wrangler.toml"))) {
      return resolved;
    }
  }

  // Default
  return path.resolve("./cloudflare/tenant-backend");
}

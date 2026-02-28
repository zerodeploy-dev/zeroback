import * as path from "path";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { buildAndGenerate } from "./dev.js";
import { prepareWorkerDir } from "./prepare.js";

export interface DeployOptions {
  vexDir?: string;
  dryRun?: boolean;
  wranglerArgs?: string[];
}

export async function deploy(options: DeployOptions = {}): Promise<void> {
  const vexDir = path.resolve(options.vexDir || "./vex");
  const workerDir = prepareWorkerDir();

  console.log("▲ vex deploy\n");

  if (!existsSync(vexDir)) {
    console.error(`Error: ${vexDir} not found.`);
    process.exit(1);
  }

  // Phase 1: Codegen
  try {
    await buildAndGenerate(vexDir, workerDir);
  } catch (e) {
    console.error("  ✗ Codegen failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (options.dryRun) {
    console.log("\n  ⊘ Dry run: skipping wrangler deploy\n");
    return;
  }

  // Phase 2: Deploy via wrangler
  if (!existsSync(path.resolve("wrangler.toml"))) {
    console.error("  ✗ No wrangler.toml found at project root.");
    process.exit(1);
  }

  const exitCode = await runWrangler(options.wranglerArgs || []);
  if (exitCode === 0) {
    console.log("\n  ✓ Deployed successfully\n");
  } else {
    process.exit(exitCode);
  }
}

function runWrangler(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("bunx", ["wrangler", "deploy", ...args], {
      stdio: "inherit",
      shell: true,
    });
    child.on("error", (err) => {
      console.error("  ✗ Failed to start wrangler:", err.message);
      resolve(1);
    });
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

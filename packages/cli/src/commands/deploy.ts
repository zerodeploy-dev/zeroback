import * as path from "path";
import { spawn, execFileSync } from "child_process";
import { existsSync } from "fs";
import { buildAndGenerate } from "./dev.js";
import { prepareWorkerDir } from "./prepare.js";
import { detectPkgRunner } from "./pkg-manager.js";

export interface DeployOptions {
  functionsDir?: string;
  dryRun?: boolean;
  wranglerArgs?: string[];
}

export async function deploy(options: DeployOptions = {}): Promise<void> {
  const functionsDir = path.resolve(options.functionsDir || "./zeroback");
  const workerDir = prepareWorkerDir();

  console.log("▲ zeroback deploy\n");

  if (!existsSync(functionsDir)) {
    console.error(`Error: ${functionsDir} not found.`);
    process.exit(1);
  }

  // Phase 1: Codegen
  try {
    await buildAndGenerate(functionsDir);
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

  const runner = detectPkgRunner();
  await checkWranglerAuth(runner);

  const exitCode = await runWrangler(runner, options.wranglerArgs || []);
  if (exitCode === 0) {
    console.log("\n  ✓ Deployed successfully\n");
  } else {
    process.exit(exitCode);
  }
}

async function checkWranglerAuth(runner: string): Promise<void> {
  // Skip check if user has an API token set (CI/CD environments)
  if (process.env.CLOUDFLARE_API_TOKEN) return

  try {
    execFileSync(runner, ["wrangler", "whoami"], { stdio: "pipe", shell: true })
  } catch {
    console.error("  ✗ Not logged in to Cloudflare.\n")
    console.error("  To authenticate, either:")
    console.error("    • Run `wrangler login` to log in via your browser")
    console.error("    • Set the CLOUDFLARE_API_TOKEN environment variable (for CI/CD)\n")
    process.exit(1)
  }
}

function runWrangler(runner: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(runner, ["wrangler", "deploy", ...args], {
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

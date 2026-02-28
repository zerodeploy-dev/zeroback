import { spawn, execSync, type ChildProcess } from "child_process";
import { rmSync } from "fs";
import * as path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXAMPLE_DIR = path.resolve(ROOT, "examples/task-manager");
const PORT = 8788;

let proc: ChildProcess | null = null;

function killPort() {
  try {
    execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null`, { stdio: "ignore" });
  } catch {}
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      if (res.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`vex dev did not become healthy within ${timeoutMs}ms`);
}

async function resetData() {
  const res = await fetch(`http://localhost:${PORT}/__dev/reset`, { method: "POST" });
  if (!res.ok) throw new Error(`/__dev/reset failed: ${res.status}`);
}

export async function setup() {
  killPort();

  const cliEntry = path.join(ROOT, "packages/cli/src/index.ts");
  proc = spawn("npx", ["tsx", cliEntry, "dev"], {
    cwd: EXAMPLE_DIR,
    stdio: "ignore",
    shell: true,
  });

  await waitForHealth();
  await resetData();
}

export async function teardown() {
  if (proc) {
    try { proc.kill("SIGTERM"); } catch {}
    proc = null;
  }
  await sleep(200);
  killPort();
  await sleep(200);

  // Clean up generated files
  rmSync(path.join(EXAMPLE_DIR, ".vex"), { recursive: true, force: true });
  rmSync(path.join(EXAMPLE_DIR, ".wrangler"), { recursive: true, force: true });
}

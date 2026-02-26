import { spawn, execSync, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const WRANGLER_STATE = path.join(ROOT, ".wrangler/state");
const PORT = 8788;
const VEX_DIR = path.resolve(ROOT, "examples/chat-app/vex");

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

export async function setup() {
  killPort();

  if (fs.existsSync(WRANGLER_STATE)) {
    fs.rmSync(WRANGLER_STATE, { recursive: true, force: true });
  }

  const cliEntry = path.join(ROOT, "packages/cli/src/index.ts");
  proc = spawn("npx", ["tsx", cliEntry, "dev", VEX_DIR], {
    cwd: ROOT,
    stdio: "ignore",
    shell: true,
  });

  await waitForHealth();
}

export async function teardown() {
  if (proc) {
    try { proc.kill("SIGTERM"); } catch {}
    proc = null;
  }
  await sleep(200);
  killPort();
  await sleep(200);
}

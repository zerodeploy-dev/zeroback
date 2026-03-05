import * as fs from "fs";
import * as path from "path";

export function reset(): void {
  const stateDir = path.resolve(".wrangler/state");
  if (!fs.existsSync(stateDir)) {
    console.log("No local state found — nothing to reset.");
    return;
  }
  fs.rmSync(stateDir, { recursive: true });
  console.log("Local database reset. Restart `zeroback dev` to start fresh.");
}

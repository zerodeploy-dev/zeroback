import { existsSync } from "fs"
import { resolve } from "path"

/**
 * Detect the package manager runner (npx, bunx, pnpx) based on
 * the lock file present in the project root.
 */
export function detectPkgRunner(): string {
  const cwd = process.cwd()
  if (existsSync(resolve(cwd, "bun.lockb")) || existsSync(resolve(cwd, "bun.lock"))) return "bunx"
  if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) return "pnpx"
  return "npx"
}

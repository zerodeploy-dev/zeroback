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

/**
 * Detect the package manager install command (bun add, pnpm add, npm install)
 * based on the lock file present in the project root.
 */
export function detectPkgInstall(cwd?: string): string {
  const dir = cwd ?? process.cwd()
  if (existsSync(resolve(dir, "bun.lockb")) || existsSync(resolve(dir, "bun.lock"))) return "bun add"
  if (existsSync(resolve(dir, "pnpm-lock.yaml"))) return "pnpm add"
  if (existsSync(resolve(dir, "yarn.lock"))) return "yarn add"
  return "npm install"
}

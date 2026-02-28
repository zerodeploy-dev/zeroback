#!/usr/bin/env bun
import { execSync } from "node:child_process"

const packages = [
  "packages/values",
  "packages/server",
  "packages/runtime",
  "packages/client",
  "packages/react",
  "packages/solid",
  "packages/cli",
]

function run(cmd, opts) {
  console.log(`> ${cmd}`)
  execSync(cmd, { stdio: "inherit", ...opts })
}

// Build all packages
console.log("Building all packages...\n")
run("bun run build")

// Publish in dependency order
for (const pkg of packages) {
  console.log(`\nPublishing ${pkg}...`)
  run(`bun publish --access public ${process.argv.slice(2).join(" ")}`, {
    cwd: pkg,
  })
}

console.log("\nAll packages published successfully!")

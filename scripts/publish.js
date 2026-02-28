#!/usr/bin/env bun
import { execSync } from "node:child_process"
import { readFileSync, unlinkSync } from "node:fs"

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
  return execSync(cmd, { stdio: "inherit", ...opts })
}

function exec(cmd, opts) {
  return execSync(cmd, { encoding: "utf-8", ...opts }).trim()
}

function isPublished(name, version) {
  try {
    execSync(`npm view ${name}@${version} version`, { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

// Build all packages
console.log("Building all packages...\n")
run("bun run build")

const isCI = !!process.env.CI
const extraArgs = process.argv.slice(2).join(" ")

// Publish in dependency order
for (const pkg of packages) {
  const manifest = JSON.parse(readFileSync(`${pkg}/package.json`, "utf-8"))
  const { name, version } = manifest

  if (isPublished(name, version)) {
    console.log(`\nSkipping ${name}@${version} (already published)`)
    continue
  }

  console.log(`\nPublishing ${name}@${version}...`)
  if (isCI) {
    // bun pack resolves workspace:^ to real versions in the tarball
    run("bun pack", { cwd: pkg })
    const tarball = exec("ls *.tgz", { cwd: pkg })
    // npm publish handles OIDC trusted publishing (provenance is automatic)
    run(`npm publish ${tarball} --access public ${extraArgs}`.trim(), {
      cwd: pkg,
    })
    unlinkSync(`${pkg}/${tarball}`)
  } else {
    // Locally: bun publish resolves workspace:^ and publishes in one step
    run(`bun publish --access public ${extraArgs}`.trim(), {
      cwd: pkg,
    })
  }
}

console.log("\nAll packages published successfully!")

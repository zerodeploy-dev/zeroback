#!/usr/bin/env bun
import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const packages = [
  "packages/values",
  "packages/server",
  "packages/client",
  "packages/react",
  "packages/solid",
  "packages/cli",
]

function run(cmd, opts) {
  console.log(`> ${cmd}`)
  return execSync(cmd, { stdio: "inherit", ...opts })
}

function isPublished(name, version) {
  try {
    execSync(`npm view ${name}@${version} version`, { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

// Build a map of package name -> version for workspace resolution
const versionMap = {}
for (const pkg of packages) {
  const manifest = JSON.parse(readFileSync(`${pkg}/package.json`, "utf-8"))
  versionMap[manifest.name] = manifest.version
}

function resolveWorkspaceDeps(pkgDir) {
  const pkgPath = `${pkgDir}/package.json`
  const original = readFileSync(pkgPath, "utf-8")
  const manifest = JSON.parse(original)

  for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = manifest[depType]
    if (!deps) continue
    for (const [dep, ver] of Object.entries(deps)) {
      if (typeof ver === "string" && ver.startsWith("workspace:")) {
        if (versionMap[dep]) {
          deps[dep] = `^${versionMap[dep]}`
        }
      }
    }
  }

  writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + "\n")
  return original
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
    // Resolve workspace:^ to real versions, publish with npm, then restore
    const original = resolveWorkspaceDeps(pkg)
    try {
      run(`npm publish --access public ${extraArgs}`.trim(), { cwd: pkg })
    } finally {
      writeFileSync(`${pkg}/package.json`, original)
    }
  } else {
    // Locally: bun publish resolves workspace:^ automatically
    run(`bun publish --access public ${extraArgs}`.trim(), { cwd: pkg })
  }
}

console.log("\nAll packages published successfully!")

import { describe, it, expect } from "vitest"
import { generateApi } from "./api"
import { readFileSync, mkdirSync, rmSync } from "fs"
import * as path from "path"
import * as os from "os"
import type { FunctionManifest } from "@zeroback/server"

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdirSync(path.join(os.tmpdir(), `zeroback-api-test-${Date.now()}`), { recursive: true }) as string
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("generateApi", () => {
  it("uses returns type from manifest instead of any", () => {
    withTempDir((dir) => {
      const outputPath = path.join(dir, "api.ts")
      const manifest: FunctionManifest = {
        "tasks:list": {
          type: "query",
          isInternal: false,
          args: { type: "object", value: {} },
          returnsTypeString: "{ _id: string, text: string, isCompleted: boolean }[]",
        },
      }
      generateApi(manifest, outputPath)
      const content = readFileSync(outputPath, "utf-8")
      expect(content).toContain("{ _id: string, text: string, isCompleted: boolean }[]")
      expect(content).not.toContain(", any>")
    })
  })

  it("falls back to any when returnsTypeString is unknown", () => {
    withTempDir((dir) => {
      const outputPath = path.join(dir, "api.ts")
      const manifest: FunctionManifest = {
        "tasks:list": {
          type: "query",
          isInternal: false,
          args: { type: "object", value: {} },
          returnsTypeString: "unknown",
        },
      }
      generateApi(manifest, outputPath)
      const content = readFileSync(outputPath, "utf-8")
      expect(content).toContain(", any>")
    })
  })

  it("uses number returns type", () => {
    withTempDir((dir) => {
      const outputPath = path.join(dir, "api.ts")
      const manifest: FunctionManifest = {
        "tasks:count": {
          type: "query",
          isInternal: false,
          args: { type: "object", value: { projectId: { type: "string" } } },
          returnsTypeString: "number",
        },
      }
      generateApi(manifest, outputPath)
      const content = readFileSync(outputPath, "utf-8")
      expect(content).toContain(", number>")
    })
  })

  it("uses null returns type for mutations", () => {
    withTempDir((dir) => {
      const outputPath = path.join(dir, "api.ts")
      const manifest: FunctionManifest = {
        "tasks:create": {
          type: "mutation",
          isInternal: false,
          args: { type: "object", value: { text: { type: "string" } } },
          returnsTypeString: "null",
        },
      }
      generateApi(manifest, outputPath)
      const content = readFileSync(outputPath, "utf-8")
      expect(content).toContain(", null>")
    })
  })
})

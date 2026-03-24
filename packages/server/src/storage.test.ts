import { describe, it, expect, vi } from "vitest"
import { StorageReader, StorageWriter, StorageActions } from "./storage"
import type { StorageOps } from "./storage"

function makeMockOps(): StorageOps {
  return {
    generateUploadUrl: vi.fn().mockResolvedValue("https://upload.example.com/abc"),
    getUrl: vi.fn().mockResolvedValue("https://files.example.com/abc"),
    getMetadata: vi.fn().mockResolvedValue({
      storageId: "abc",
      sha256: "deadbeef",
      contentType: "image/png",
      size: 1024,
    }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue("new-storage-id"),
  }
}

describe("StorageReader", () => {
  it("getUrl delegates to ops", async () => {
    const ops = makeMockOps()
    const reader = new StorageReader(ops)
    const url = await reader.getUrl("abc")
    expect(ops.getUrl).toHaveBeenCalledWith("abc")
    expect(url).toBe("https://files.example.com/abc")
  })

  it("getUrl returns null when not found", async () => {
    const ops = makeMockOps()
    ;(ops.getUrl as any).mockResolvedValue(null)
    const reader = new StorageReader(ops)
    expect(await reader.getUrl("missing")).toBeNull()
  })

  it("getMetadata delegates to ops", async () => {
    const ops = makeMockOps()
    const reader = new StorageReader(ops)
    const meta = await reader.getMetadata("abc")
    expect(ops.getMetadata).toHaveBeenCalledWith("abc")
    expect(meta).toEqual({
      storageId: "abc",
      sha256: "deadbeef",
      contentType: "image/png",
      size: 1024,
    })
  })

  it("getMetadata returns null when not found", async () => {
    const ops = makeMockOps()
    ;(ops.getMetadata as any).mockResolvedValue(null)
    const reader = new StorageReader(ops)
    expect(await reader.getMetadata("missing")).toBeNull()
  })
})

describe("StorageWriter", () => {
  it("inherits getUrl and getMetadata from StorageReader", async () => {
    const ops = makeMockOps()
    const writer = new StorageWriter(ops)
    expect(await writer.getUrl("abc")).toBe("https://files.example.com/abc")
    expect(await writer.getMetadata("abc")).toBeDefined()
  })

  it("generateUploadUrl delegates to ops", async () => {
    const ops = makeMockOps()
    const writer = new StorageWriter(ops)
    const url = await writer.generateUploadUrl()
    expect(ops.generateUploadUrl).toHaveBeenCalled()
    expect(url).toBe("https://upload.example.com/abc")
  })

  it("delete delegates to ops.deleteFile", async () => {
    const ops = makeMockOps()
    const writer = new StorageWriter(ops)
    await writer.delete("abc")
    expect(ops.deleteFile).toHaveBeenCalledWith("abc")
  })
})

describe("StorageActions", () => {
  it("inherits all StorageWriter methods", async () => {
    const ops = makeMockOps()
    const actions = new StorageActions(ops)
    expect(await actions.getUrl("abc")).toBe("https://files.example.com/abc")
    expect(await actions.generateUploadUrl()).toBe("https://upload.example.com/abc")
  })

  it("store delegates to ops.store", async () => {
    const ops = makeMockOps()
    const actions = new StorageActions(ops)
    const blob = new Blob(["hello"], { type: "text/plain" })
    const id = await actions.store(blob)
    expect(ops.store).toHaveBeenCalledWith(blob)
    expect(id).toBe("new-storage-id")
  })
})

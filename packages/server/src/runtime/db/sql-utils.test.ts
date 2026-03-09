import { describe, it, expect } from "vitest"
import { sqlChunks, sqlRowChunks, sqlPlaceholders } from "./sql-utils"

describe("sqlPlaceholders", () => {
  it("generates comma-separated question marks", () => {
    expect(sqlPlaceholders(1)).toBe("?")
    expect(sqlPlaceholders(3)).toBe("?, ?, ?")
    expect(sqlPlaceholders(5)).toBe("?, ?, ?, ?, ?")
  })

  it("returns empty string for 0", () => {
    expect(sqlPlaceholders(0)).toBe("")
  })
})

describe("sqlChunks", () => {
  it("returns single chunk for small arrays", () => {
    const items = [1, 2, 3]
    const chunks = sqlChunks(items)
    expect(chunks).toEqual([[1, 2, 3]])
  })

  it("returns empty array for empty input", () => {
    expect(sqlChunks([])).toEqual([])
  })

  it("splits based on MAX_PARAMS (100)", () => {
    const items = Array.from({ length: 250 }, (_, i) => i)
    const chunks = sqlChunks(items)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(100)
    expect(chunks[1]).toHaveLength(100)
    expect(chunks[2]).toHaveLength(50)
  })

  it("reserves params reducing chunk size", () => {
    const items = Array.from({ length: 150 }, (_, i) => i)
    const chunks = sqlChunks(items, 50)
    // chunkSize = 100 - 50 = 50
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(50)
    expect(chunks[1]).toHaveLength(50)
    expect(chunks[2]).toHaveLength(50)
  })

  it("ensures minimum chunk size of 1", () => {
    const items = [1, 2, 3]
    const chunks = sqlChunks(items, 200) // reservedParams > MAX_PARAMS
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual([1])
  })
})

describe("sqlRowChunks", () => {
  it("splits based on params per item", () => {
    const items = Array.from({ length: 10 }, (_, i) => i)
    // 100 / 20 = 5 items per chunk
    const chunks = sqlRowChunks(items, 20)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(5)
    expect(chunks[1]).toHaveLength(5)
  })

  it("handles single-param items like sqlChunks", () => {
    const items = Array.from({ length: 250 }, (_, i) => i)
    const chunks = sqlRowChunks(items, 1)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(100)
  })

  it("returns empty array for empty input", () => {
    expect(sqlRowChunks([], 5)).toEqual([])
  })

  it("ensures minimum chunk size of 1", () => {
    const items = [1, 2, 3]
    const chunks = sqlRowChunks(items, 200) // paramsPerItem > MAX_PARAMS
    expect(chunks).toHaveLength(3)
  })
})

import { describe, it, expect } from "vitest"
import { convertOldIdToTypeId, buildIdMappings } from "./migrateIds"
import { fromString, toUUID } from "typeid-js"

describe("convertOldIdToTypeId", () => {
  it("converts table:ULID to TypeID format", () => {
    const oldId = "posts:01ARZ3NDEKTSV4RRFFQ69G5FAV"
    const newId = convertOldIdToTypeId(oldId, "posts")
    expect(newId).toMatch(/^posts_[0-9a-hjkmnp-tv-z]{26}$/)
  })

  it("uses custom prefix", () => {
    const oldId = "customers:01ARZ3NDEKTSV4RRFFQ69G5FAV"
    const newId = convertOldIdToTypeId(oldId, "cus")
    expect(newId).toMatch(/^cus_[0-9a-hjkmnp-tv-z]{26}$/)
  })

  it("preserves timestamp from ULID", () => {
    // ULID "01ARZ3NDEKTSV4RRFFQ69G5FAV" has a specific timestamp
    // Decode it manually: Crockford base32 first 10 chars = timestamp
    const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    const ulidStr = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
    let oldTimestamp = 0
    for (let i = 0; i < 10; i++) {
      oldTimestamp = oldTimestamp * 32 + CROCKFORD.indexOf(ulidStr[i])
    }

    const oldId = `posts:${ulidStr}`
    const newId = convertOldIdToTypeId(oldId, "posts")

    // Extract timestamp from new TypeID's UUIDv7
    const uuid = toUUID(fromString(newId))
    const hex = uuid.replace(/-/g, "")
    const newTimestamp = parseInt(hex.slice(0, 12), 16)

    expect(newTimestamp).toBe(oldTimestamp)
  })
})

describe("buildIdMappings", () => {
  it("builds old->new ID mapping for a set of IDs", () => {
    const oldIds = [
      "posts:01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "posts:01BX5ZZKBKACTAV9WEVGEMMVRZ",
    ]
    const mapping = buildIdMappings(oldIds, "posts")
    expect(mapping.size).toBe(2)
    for (const [oldId, newId] of mapping) {
      expect(oldId).toMatch(/^posts:/)
      expect(newId).toMatch(/^posts_/)
    }
  })
})

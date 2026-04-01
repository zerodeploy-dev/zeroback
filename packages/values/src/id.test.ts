import { describe, it, expect } from "vitest"
import { tableFromId, suffixFromId } from "./id"

describe("tableFromId", () => {
  it("extracts table name from TypeID", () => {
    expect(tableFromId("posts_01h455vb4pex5vsknk084sn02q")).toBe("posts")
  })

  it("extracts multi-word table name", () => {
    expect(tableFromId("blogposts_01h455vb4pex5vsknk084sn02q")).toBe("blogposts")
  })

  it("returns empty string if no underscore", () => {
    expect(tableFromId("nounderscore")).toBe("")
  })
})

describe("suffixFromId", () => {
  it("extracts base32 suffix from TypeID", () => {
    expect(suffixFromId("posts_01h455vb4pex5vsknk084sn02q")).toBe("01h455vb4pex5vsknk084sn02q")
  })

  it("returns full string if no underscore", () => {
    expect(suffixFromId("nounderscore")).toBe("nounderscore")
  })
})

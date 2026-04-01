/** Extract the table name (prefix) from a TypeID ("prefix_base32suffix"). */
export function tableFromId(id: string): string {
  const idx = id.lastIndexOf("_")
  return idx >= 0 ? id.slice(0, idx) : ""
}

/** Extract the base32 suffix from a TypeID ("prefix_base32suffix"). */
export function suffixFromId(id: string): string {
  const idx = id.lastIndexOf("_")
  return idx >= 0 ? id.slice(idx + 1) : id
}

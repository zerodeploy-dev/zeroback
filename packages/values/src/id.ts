/** Extract the table name from a Zeroback document ID ("table:ulid"). */
export function tableFromId(id: string): string {
  const idx = id.indexOf(":");
  return idx >= 0 ? id.slice(0, idx) : "";
}

/** Extract the ULID part from a Zeroback document ID ("table:ulid"). */
export function ulidFromId(id: string): string {
  const idx = id.indexOf(":");
  return idx >= 0 ? id.slice(idx + 1) : id;
}

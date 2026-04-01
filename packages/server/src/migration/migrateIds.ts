import { fromUUID } from "typeid-js"
import type { SchemaJSON } from "../types.js"
import type { SqlApi } from "../runtime/types.js"

/**
 * Decode a ULID's 48-bit timestamp (Crockford base32, first 10 chars).
 */
function ulidTimestamp(ulid: string): number {
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let timestamp = 0
  for (let i = 0; i < 10; i++) {
    timestamp = timestamp * 32 + CROCKFORD.indexOf(ulid[i].toUpperCase())
  }
  return timestamp
}

/**
 * Build a UUIDv7 string with the same 48-bit ms timestamp as the given ULID.
 * Random bits are freshly generated.
 */
function ulidTimestampToUuidV7(ulid: string): string {
  const ms = ulidTimestamp(ulid)
  const tsHex = ms.toString(16).padStart(12, "0")

  const randA = Math.floor(Math.random() * 0x1000).toString(16).padStart(3, "0")
  const randBHigh = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0")
  const randBLow = Math.floor(Math.random() * 0x1000000000000).toString(16).padStart(12, "0")

  // UUIDv7: tttttttt-tttt-7rrr-Nrrr-rrrrrrrrrrrr
  const variantNibble = (0x8 | (parseInt(randBHigh[0], 16) & 0x3)).toString(16)

  return [
    tsHex.slice(0, 8),
    tsHex.slice(8, 12),
    "7" + randA,
    variantNibble + randBHigh.slice(1, 4),
    randBLow,
  ].join("-")
}

/**
 * Convert an old-format ID ("table:ULID") to TypeID format ("prefix_base32suffix").
 * Preserves the 48-bit timestamp so _creationTime is unchanged.
 */
export function convertOldIdToTypeId(oldId: string, prefix: string): string {
  const colonIdx = oldId.indexOf(":")
  const ulid = colonIdx >= 0 ? oldId.slice(colonIdx + 1) : oldId
  const uuid = ulidTimestampToUuidV7(ulid)
  return fromUUID(uuid, prefix).toString()
}

/**
 * Build a mapping of old IDs to new TypeIDs for a set of old IDs.
 */
export function buildIdMappings(
  oldIds: string[],
  prefix: string
): Map<string, string> {
  const mapping = new Map<string, string>()
  for (const oldId of oldIds) {
    mapping.set(oldId, convertOldIdToTypeId(oldId, prefix))
  }
  return mapping
}

export type MigrateOptions = {
  sql: SqlApi
  schema: SchemaJSON
  dryRun?: boolean
}

/**
 * Migrate all IDs from old "table:ULID" format to TypeID format.
 * Updates _id primary keys and v.id() foreign key references.
 * Preserves _creationTime by copying the 48-bit ULID timestamp into UUIDv7.
 */
export function migrateIds(options: MigrateOptions): void {
  const { sql, schema, dryRun } = options

  const prefixMap = new Map<string, string>()
  for (const [tableName, table] of Object.entries(schema.tables)) {
    prefixMap.set(tableName, table.idPrefix ?? tableName)
  }

  const globalIdMap = new Map<string, string>()

  // Phase 1: Build ID mappings
  for (const [tableName] of Object.entries(schema.tables)) {
    const prefix = prefixMap.get(tableName)!
    const rows = sql.exec(`SELECT _id FROM "${tableName}"`).toArray() as { _id: string }[]

    for (const row of rows) {
      if (row._id.includes(":")) {
        const newId = convertOldIdToTypeId(row._id, prefix)
        globalIdMap.set(row._id, newId)
        if (dryRun) {
          console.log(`[dry-run] ${tableName}: ${row._id} → ${newId}`)
        }
      }
    }
  }

  if (dryRun) {
    console.log(`\n[dry-run] ${globalIdMap.size} IDs would be migrated.`)
    return
  }

  // Phase 2: Update _id primary keys
  for (const [tableName] of Object.entries(schema.tables)) {
    const rows = sql.exec(`SELECT _id FROM "${tableName}"`).toArray() as { _id: string }[]
    for (const row of rows) {
      const newId = globalIdMap.get(row._id)
      if (newId) {
        sql.exec(`UPDATE "${tableName}" SET _id = ? WHERE _id = ?`, newId, row._id)
      }
    }
  }

  // Phase 3: Update foreign key references (v.id() fields)
  for (const [tableName, table] of Object.entries(schema.tables)) {
    for (const [fieldName, fieldValidator] of Object.entries(table.fields)) {
      const isIdField =
        fieldValidator.type === "id" ||
        (fieldValidator.type === "optional" && (fieldValidator as any).value?.type === "id")

      if (isIdField) {
        const rows = sql.exec(
          `SELECT _id, "${fieldName}" FROM "${tableName}" WHERE "${fieldName}" IS NOT NULL`
        ).toArray() as Record<string, string>[]
        for (const row of rows) {
          const oldRef = row[fieldName]
          const newRef = globalIdMap.get(oldRef)
          if (newRef) {
            sql.exec(
              `UPDATE "${tableName}" SET "${fieldName}" = ? WHERE _id = ?`,
              newRef,
              row._id
            )
          }
        }
      }
    }
  }

  console.log(`Migrated ${globalIdMap.size} IDs successfully.`)
}

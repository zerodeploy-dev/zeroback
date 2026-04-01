import type { PropertyValidators, ObjectType, Validator } from "@zeroback/values"
import { v } from "@zeroback/values"
import type { TableDefinition, SchemaDefinition } from "./types.js"

const TYPEID_PREFIX_RE = /^[a-z]{1,63}$/

export function defineTable<F extends PropertyValidators>(fields: F): TableDefinition<ObjectType<F>> {
  const def: TableDefinition<ObjectType<F>> = {
    validator: v.object(fields) as unknown as Validator<ObjectType<F>>,
    _doc: {} as ObjectType<F>,
    indexes: [],
    searchIndexes: [],
    index(name: string, fields: string[]): TableDefinition<ObjectType<F>> {
      def.indexes.push({ name, fields })
      return def
    },
    searchIndex(name: string, opts: { searchField: string }): TableDefinition<ObjectType<F>> {
      def.searchIndexes.push({ name, searchField: opts.searchField })
      return def
    },
    idPrefix(prefix: string): TableDefinition<ObjectType<F>> {
      if (!TYPEID_PREFIX_RE.test(prefix)) {
        throw new Error(
          `Invalid idPrefix "${prefix}": must be 1-63 lowercase alpha characters`
        )
      }
      def._idPrefix = prefix
      return def
    },
  }
  return def
}

export function defineSchema<T extends Record<string, TableDefinition<unknown>>>(
  tables: T
): SchemaDefinition<T> {
  for (const [tableName, tableDef] of Object.entries(tables)) {
    if (!tableDef._idPrefix && !TYPEID_PREFIX_RE.test(tableName)) {
      throw new Error(
        `Table name "${tableName}" is not a valid TypeID prefix (must be 1-63 lowercase alpha characters). Use .idPrefix() to set a custom prefix.`
      )
    }
  }
  return { tables }
}

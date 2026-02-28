import type { PropertyValidators, ObjectType, Validator } from "@zeroback/values";
import type { TableDefinition, SchemaDefinition, TableIndex, SearchIndex } from "./types.js";

export function defineTable<F extends PropertyValidators>(fields: F): TableDefinition<ObjectType<F>> {
  const def: TableDefinition<ObjectType<F>> = {
    validator: {} as Validator<ObjectType<F>>,
    _doc: {} as ObjectType<F>,
    indexes: [],
    searchIndexes: [],
    index(name: string, fields: string[]): TableDefinition<ObjectType<F>> {
      def.indexes.push({ name, fields });
      return def;
    },
    searchIndex(name: string, opts: { searchField: string }): TableDefinition<ObjectType<F>> {
      def.searchIndexes.push({ name, searchField: opts.searchField });
      return def;
    },
  };
  return def;
}

export function defineSchema<T extends Record<string, TableDefinition<any>>>(
  tables: T
): SchemaDefinition<T> {
  return { tables };
}

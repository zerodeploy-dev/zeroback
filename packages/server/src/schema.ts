import type { PropertyValidators, ObjectType, Validator } from "@vex/values";
import type { TableDefinition, SchemaDefinition, TableIndex } from "./types.js";

export function defineTable<F extends PropertyValidators>(fields: F): TableDefinition<ObjectType<F>> {
  const def: TableDefinition<ObjectType<F>> = {
    validator: {} as Validator<ObjectType<F>>,
    _doc: {} as ObjectType<F>,
    indexes: [],
    index(name: string, fields: string[]): TableDefinition<ObjectType<F>> {
      def.indexes.push({ name, fields });
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

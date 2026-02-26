import * as fs from "fs";
import * as path from "path";
import type { SchemaJSON } from "@vex/server";

export function generateServer(schema: SchemaJSON, outputPath: string): void {
  const lines: string[] = [
    `import { createQueryFactory, createMutationFactory, createActionFactory, createInternalQueryFactory, createInternalMutationFactory, createInternalActionFactory } from "@vex/server";`,
    `import type { DataModelFromSchema, SchemaDefinition } from "@vex/server";`,
    "",
  ];

  const tables: Record<string, any> = {};

  for (const [tableName, table] of Object.entries(schema.tables)) {
    const fields: Record<string, string> = {};
    for (const [fieldName, field] of Object.entries(table.fields)) {
      fields[fieldName] = validatorTypeToTs(field);
    }
    tables[tableName] = fields;
  }

  lines.push(`export const schema = {`);
  for (const [tableName, table] of Object.entries(schema.tables)) {
    lines.push(`  ${tableName}: {`);
    for (const [fieldName, field] of Object.entries(table.fields)) {
      const fieldType = validatorTypeToTs(field);
      lines.push(`    ${fieldName}: null as any,`);
    }
    lines.push(`  },`);
  }
  lines.push(`} as const;`);
  lines.push("");

  const dataModelName = "DataModel";
  lines.push(`export type ${dataModelName} = {`);
  for (const [tableName, table] of Object.entries(schema.tables)) {
    lines.push(`  ${tableName}: {`);
    for (const [fieldName, field] of Object.entries(table.fields)) {
      lines.push(`    ${fieldName}: ${validatorTypeToTs(field)},`);
    }
    lines.push(`    _id: string,`);
    lines.push(`    _creationTime: number,`);
    lines.push(`  },`);
  }
  lines.push(`};`);
  lines.push("");

  lines.push(`export const query = createQueryFactory<${dataModelName}>();`);
  lines.push(`export const mutation = createMutationFactory<${dataModelName}>();`);
  lines.push(`export const action = createActionFactory<${dataModelName}>();`);
  lines.push(`export const internalQuery = createInternalQueryFactory<${dataModelName}>();`);
  lines.push(`export const internalMutation = createInternalMutationFactory<${dataModelName}>();`);
  lines.push(`export const internalAction = createInternalActionFactory<${dataModelName}>();`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n") + "\n");
}

function validatorTypeToTs(json: any): string {
  if (!json) return "unknown";

  switch (json.type) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "any": return "any";
    case "id": return "string";
    case "literal": return typeof json.value === "string" ? `"${json.value}"` : `${json.value}`;
    case "object": return "{ " + Object.entries(json.value || {}).map(([k, v]) => `${k}: ${validatorTypeToTs(v)}`).join(", ") + " }";
    case "array": return `${validatorTypeToTs(json.value)}[]`;
    case "union": return (json.value || []).map((v: any) => validatorTypeToTs(v)).join(" | ");
    case "optional": return `${validatorTypeToTs(json.value)} | undefined`;
    default: return "unknown";
  }
}

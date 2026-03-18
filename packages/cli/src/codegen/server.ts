import * as fs from "fs";
import * as path from "path";
import type { SchemaJSON } from "@zeroback/server";
import { validatorTypeToTs, quotePropertyName } from "./utils.js";

export function generateServer(schema: SchemaJSON, outputPath: string): void {
  const lines: string[] = [
    `import { createQueryFactory, createMutationFactory, createActionFactory, createInternalQueryFactory, createInternalMutationFactory, createInternalActionFactory, v } from "@zeroback/server";`,
    "",
    `export { v };`,
    "",
  ];

  lines.push(`export const schema = {`);
  for (const [tableName, table] of Object.entries(schema.tables)) {
    lines.push(`  ${quotePropertyName(tableName)}: {`);
    for (const [fieldName] of Object.entries(table.fields)) {
      lines.push(`    ${quotePropertyName(fieldName)}: null as any,`);
    }
    lines.push(`  },`);
  }
  lines.push(`} as const;`);
  lines.push("");

  const dataModelName = "DataModel";
  lines.push(`export type ${dataModelName} = {`);
  for (const [tableName, table] of Object.entries(schema.tables)) {
    lines.push(`  ${quotePropertyName(tableName)}: {`);
    for (const [fieldName, field] of Object.entries(table.fields)) {
      if ((field as any).type === "optional") {
        lines.push(`    ${quotePropertyName(fieldName)}?: ${validatorTypeToTs((field as any).value)},`);
      } else {
        lines.push(`    ${quotePropertyName(fieldName)}: ${validatorTypeToTs(field)},`);
      }
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

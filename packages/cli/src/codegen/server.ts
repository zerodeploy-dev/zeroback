import * as fs from "fs";
import * as path from "path";
import type { SchemaJSON } from "@zeroback/server";
import type { ValidatorJSON } from "@zeroback/values";
import { validatorTypeToTs, quotePropertyName } from "./utils.js";

function isOptionalValidator(v: ValidatorJSON): v is { type: "optional"; value: ValidatorJSON } {
  return v.type === "optional";
}

export function generateServer(schema: SchemaJSON, outputPath: string, hasAuth = false): void {
  const lines: string[] = [
    `import { createQueryFactory, createMutationFactory, createActionFactory, createInternalQueryFactory, createInternalMutationFactory, createInternalActionFactory, v } from "@zeroback/server";`,
  ];

  if (hasAuth) {
    lines.push(`import type { AuthCtx } from "@zeroback/server";`);
  }

  lines.push("");
  lines.push(`export { v };`);
  lines.push("");

  lines.push(`export const schema = {`);
  for (const [tableName, table] of Object.entries(schema.tables)) {
    lines.push(`  ${quotePropertyName(tableName)}: {`);
    for (const [fieldName] of Object.entries(table.fields)) {
      lines.push(`    ${quotePropertyName(fieldName)}: null as unknown,`);
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
      if (isOptionalValidator(field)) {
        lines.push(`    ${quotePropertyName(fieldName)}?: ${validatorTypeToTs(field.value)},`);
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

  const authParam = hasAuth ? `, AuthCtx` : ``;
  lines.push(`export const query = createQueryFactory<${dataModelName}${authParam}>();`);
  lines.push(`export const mutation = createMutationFactory<${dataModelName}${authParam}>();`);
  lines.push(`export const action = createActionFactory<${dataModelName}${authParam}>();`);
  lines.push(`export const internalQuery = createInternalQueryFactory<${dataModelName}${authParam}>();`);
  lines.push(`export const internalMutation = createInternalMutationFactory<${dataModelName}${authParam}>();`);
  lines.push(`export const internalAction = createInternalActionFactory<${dataModelName}${authParam}>();`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n") + "\n");
}

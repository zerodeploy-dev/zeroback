import * as fs from "fs";
import * as path from "path";
import type { SchemaJSON } from "@zeroback/server";
import type { ValidatorJSON } from "@zeroback/values";
import { validatorTypeToTs, quotePropertyName } from "./utils.js";

function isOptionalValidator(v: ValidatorJSON): v is { type: "optional"; value: ValidatorJSON } {
  return v.type === "optional";
}

export function generateDataModel(schema: SchemaJSON, outputPath: string): void {
  const lines: string[] = [
    `export type DataModel = {`,
  ];

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

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n") + "\n");
}

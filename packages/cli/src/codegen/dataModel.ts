import * as fs from "fs";
import * as path from "path";
import type { SchemaJSON } from "@zeroback/server";
import { validatorTypeToTs, quotePropertyName } from "./utils.js";

export function generateDataModel(schema: SchemaJSON, outputPath: string): void {
  const lines: string[] = [
    `export type DataModel = {`,
  ];

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

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n") + "\n");
}

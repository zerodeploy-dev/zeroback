import * as fs from "fs";
import * as path from "path";
import type { SchemaJSON } from "@vex/server";

export function generateDataModel(schema: SchemaJSON, outputPath: string): void {
  const lines: string[] = [
    `export type DataModel = {`,
  ];

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

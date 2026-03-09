import * as ts from "typescript";
import * as path from "path";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import type { ValidatorJSON } from "@zeroback/values";
import { validatorToTypeString as validatorTypeToTs } from "@zeroback/values";
import type { FunctionManifest, SchemaJSON } from "@zeroback/server";

export function extractFunctions(vexDir: string): FunctionManifest {
  const manifest: FunctionManifest = {};

  for (const { filePath, moduleName } of scanFunctionFiles(vexDir, vexDir)) {
    extractFunctionsFromFile(filePath, moduleName, manifest);
  }

  return manifest;
}

function scanFunctionFiles(dir: string, rootDir: string): { filePath: string; moduleName: string }[] {
  const results: { filePath: string; moduleName: string }[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith("_") || entry === "node_modules") continue;
    const fullPath = path.join(dir, entry);

    if (statSync(fullPath).isDirectory()) {
      results.push(...scanFunctionFiles(fullPath, rootDir));
      continue;
    }

    if (!entry.endsWith(".ts")) continue;
    if (entry === "schema.ts") continue;

    // Module name is the path relative to rootDir without extension, using forward slashes
    // e.g., "messages" or "users/auth"
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    const moduleName = relPath.replace(/\.ts$/, "");
    results.push({ filePath: fullPath, moduleName });
  }

  return results;
}

function extractFunctionsFromFile(filePath: string, moduleName: string, manifest: FunctionManifest): void {
  const sourceFile = ts.createSourceFile(
    path.basename(filePath),
    readFileSync(filePath, "utf-8"),
    ts.ScriptTarget.ESNext,
    true
  );

  function visit(node: ts.Node) {
    // Match: export const name = query({...}) or mutation({...})
    if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          const init = decl.initializer;
          if (init && ts.isCallExpression(init)) {
            const fnText = init.expression.getText(sourceFile);
            const fnTypeMap: Record<string, { type: "query" | "mutation" | "action"; isInternal: boolean }> = {
              query: { type: "query", isInternal: false },
              mutation: { type: "mutation", isInternal: false },
              action: { type: "action", isInternal: false },
              internalQuery: { type: "query", isInternal: true },
              internalMutation: { type: "mutation", isInternal: true },
              internalAction: { type: "action", isInternal: true },
            };
            const fnInfo = fnTypeMap[fnText];
            if (fnInfo) {
              const args = extractArgs(init, sourceFile);
              const returns = extractReturns(init, sourceFile);
              manifest[`${moduleName}:${name}`] = {
                type: fnInfo.type,
                isInternal: fnInfo.isInternal,
                args: args ?? { type: "object", value: {} },
                returnsTypeString: returns ? validatorTypeToTs(returns) : "unknown",
              };
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

export function extractSchema(schemaPath: string): SchemaJSON {
  const sourceFile = ts.createSourceFile(
    path.basename(schemaPath),
    readFileSync(schemaPath, "utf-8"),
    ts.ScriptTarget.ESNext,
    true
  );

  const schemaJSON: SchemaJSON = { tables: {} };

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const fnName = node.expression.getText(sourceFile);
      if (fnName === "defineSchema") {
        if (node.arguments.length > 0 && ts.isObjectLiteralExpression(node.arguments[0])) {
          for (const prop of node.arguments[0].properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
              const tableName = prop.name.text;
              if (prop.initializer && ts.isCallExpression(prop.initializer)) {
                const { fields, indexes, searchIndexes } = extractTableDef(prop.initializer, sourceFile);
                schemaJSON.tables[tableName] = { fields, indexes, searchIndexes: searchIndexes.length > 0 ? searchIndexes : undefined };
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return schemaJSON;
}

function extractTableDef(
  expr: ts.CallExpression,
  sf: ts.SourceFile
): { fields: Record<string, ValidatorJSON>; indexes: { name: string; fields: string[] }[]; searchIndexes: { name: string; searchField: string }[] } {
  const indexes: { name: string; fields: string[] }[] = [];
  const searchIndexes: { name: string; searchField: string }[] = [];

  // Walk the chain to find defineTable() and collect .index() / .searchIndex() calls
  let current: ts.Expression = expr;
  let defineTableCall: ts.CallExpression | null = null;

  while (ts.isCallExpression(current)) {
    const callee = current.expression;
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "index") {
      // This is a .index("name", ["field1", "field2"]) call
      const indexName = current.arguments[0] && ts.isStringLiteral(current.arguments[0])
        ? current.arguments[0].text
        : null;
      const indexFields = current.arguments[1] && ts.isArrayLiteralExpression(current.arguments[1])
        ? current.arguments[1].elements
            .filter((e): e is ts.StringLiteral => ts.isStringLiteral(e))
            .map((e) => e.text)
        : [];
      if (indexName && indexFields.length > 0) {
        indexes.push({ name: indexName, fields: indexFields });
      }
      current = callee.expression;
    } else if (ts.isPropertyAccessExpression(callee) && callee.name.text === "searchIndex") {
      // This is a .searchIndex("name", { searchField: "field" }) call
      const siName = current.arguments[0] && ts.isStringLiteral(current.arguments[0])
        ? current.arguments[0].text
        : null;
      let searchField: string | null = null;
      if (current.arguments[1] && ts.isObjectLiteralExpression(current.arguments[1])) {
        for (const prop of current.arguments[1].properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "searchField") {
            if (ts.isStringLiteral(prop.initializer)) {
              searchField = prop.initializer.text;
            }
          }
        }
      }
      if (siName && searchField) {
        searchIndexes.push({ name: siName, searchField });
      }
      current = callee.expression;
    } else {
      // This should be the defineTable(...) call
      defineTableCall = current;
      break;
    }
  }

  const fields = defineTableCall ? extractTableFields(defineTableCall, sf) : {};
  return { fields, indexes, searchIndexes };
}

function extractTableFields(callExpr: ts.CallExpression, sf: ts.SourceFile): Record<string, ValidatorJSON> {
  const fields: Record<string, ValidatorJSON> = {};

  if (callExpr.arguments.length > 0 && ts.isObjectLiteralExpression(callExpr.arguments[0])) {
    for (const prop of callExpr.arguments[0].properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const fieldName = prop.name.text;
        if (prop.initializer && ts.isCallExpression(prop.initializer)) {
          fields[fieldName] = extractValidator(prop.initializer, sf);
        }
      }
    }
  }

  return fields;
}

function extractValidator(callExpr: ts.CallExpression, sf: ts.SourceFile): ValidatorJSON {
  const fnName = callExpr.expression.getText(sf);

  switch (fnName) {
    case "v.string":
      return { type: "string" };
    case "v.number":
      return { type: "number" };
    case "v.boolean":
      return { type: "boolean" };
    case "v.null":
      return { type: "null" };
    case "v.any":
      return { type: "any" };
    case "v.id": {
      let tableName = "unknown";
      if (callExpr.arguments.length > 0 && ts.isStringLiteral(callExpr.arguments[0])) {
        tableName = callExpr.arguments[0].text;
      }
      return { type: "id", tableName };
    }
    case "v.object":
      if (callExpr.arguments.length > 0 && ts.isObjectLiteralExpression(callExpr.arguments[0])) {
        const value: Record<string, ValidatorJSON> = {};
        for (const prop of callExpr.arguments[0].properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            if (prop.initializer && ts.isCallExpression(prop.initializer)) {
              value[prop.name.text] = extractValidator(prop.initializer, sf);
            }
          }
        }
        return { type: "object", value };
      }
      return { type: "object", value: {} };
    case "v.array":
      if (callExpr.arguments.length > 0 && ts.isCallExpression(callExpr.arguments[0])) {
        return { type: "array", value: extractValidator(callExpr.arguments[0], sf) };
      }
      return { type: "array", value: { type: "any" } };
    case "v.optional":
      if (callExpr.arguments.length > 0 && ts.isCallExpression(callExpr.arguments[0])) {
        return { type: "optional", value: extractValidator(callExpr.arguments[0], sf) };
      }
      return { type: "optional", value: { type: "any" } };
    case "v.union": {
      const variants: ValidatorJSON[] = [];
      for (const arg of callExpr.arguments) {
        if (ts.isCallExpression(arg)) {
          variants.push(extractValidator(arg, sf));
        }
      }
      return { type: "union", value: variants };
    }
    case "v.literal":
      if (callExpr.arguments.length > 0) {
        const val = callExpr.arguments[0];
        if (ts.isStringLiteral(val)) return { type: "literal", value: val.text };
        if (ts.isNumericLiteral(val)) return { type: "literal", value: parseFloat(val.text) };
        if (ts.isToken(val) && val.kind === ts.SyntaxKind.TrueKeyword) return { type: "literal", value: true };
        if (ts.isToken(val) && val.kind === ts.SyntaxKind.FalseKeyword) return { type: "literal", value: false };
      }
      return { type: "any" };
    case "v.record":
      if (callExpr.arguments.length >= 2 && ts.isCallExpression(callExpr.arguments[0]) && ts.isCallExpression(callExpr.arguments[1])) {
        return { type: "record", keys: extractValidator(callExpr.arguments[0], sf), values: extractValidator(callExpr.arguments[1], sf) };
      }
      return { type: "record", keys: { type: "string" }, values: { type: "any" } };
    case "v.float64":
      return { type: "float64" };
    case "v.int64":
      return { type: "int64" };
    case "v.bytes":
      return { type: "bytes" };
    default:
      return { type: "any" };
  }
}

function extractArgs(callExpr: ts.CallExpression, sf: ts.SourceFile): ValidatorJSON | null {
  if (callExpr.arguments.length > 0 && ts.isObjectLiteralExpression(callExpr.arguments[0])) {
    for (const prop of callExpr.arguments[0].properties) {
      if (ts.isPropertyAssignment(prop) && prop.name && ts.isIdentifier(prop.name) && prop.name.text === "args") {
        if (prop.initializer && ts.isObjectLiteralExpression(prop.initializer)) {
          // args: { body: v.string(), ... } — parse as inline object
          const value: Record<string, ValidatorJSON> = {};
          for (const argProp of prop.initializer.properties) {
            if (ts.isPropertyAssignment(argProp) && ts.isIdentifier(argProp.name)) {
              if (argProp.initializer && ts.isCallExpression(argProp.initializer)) {
                value[argProp.name.text] = extractValidator(argProp.initializer, sf);
              }
            }
          }
          return { type: "object", value };
        }
      }
    }
  }
  return null;
}

function extractReturns(callExpr: ts.CallExpression, sf: ts.SourceFile): ValidatorJSON | null {
  if (callExpr.arguments.length > 0 && ts.isObjectLiteralExpression(callExpr.arguments[0])) {
    for (const prop of callExpr.arguments[0].properties) {
      if (ts.isPropertyAssignment(prop) && prop.name && ts.isIdentifier(prop.name) && prop.name.text === "returns") {
        if (prop.initializer && ts.isCallExpression(prop.initializer)) {
          return extractValidator(prop.initializer, sf);
        }
      }
    }
  }
  return null;
}

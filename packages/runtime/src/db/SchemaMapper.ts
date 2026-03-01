import { decodeTime } from "ulidx";
import type { ValidatorJSON, SchemaJSON } from "@zeroback/server";
import { ulidFromId } from "@zeroback/values";
import type { SqlApi } from "../types";

// ---------------------------------------------------------------------------
// Column metadata types
// ---------------------------------------------------------------------------

export type ColumnInfo = {
  name: string;
  sqlType: string;
  nullable: boolean;
  isJsonColumn: boolean; // object/array/union/record/any → JSON serialized
  isBoolean: boolean;    // boolean validator → INTEGER stored as 1/0
};

export type TableColumnInfo = {
  columns: Map<string, ColumnInfo>;
  orderedFieldNames: string[]; // user fields in schema order (for INSERT)
};

// ---------------------------------------------------------------------------
// Type mapping: ValidatorJSON → SQLite column type
// ---------------------------------------------------------------------------

export function validatorToSQLType(validator: ValidatorJSON): {
  sqlType: string;
  nullable: boolean;
  isJsonColumn: boolean;
} {
  switch (validator.type) {
    case "string":
      return { sqlType: "TEXT", nullable: false, isJsonColumn: false };
    case "number":
    case "float64":
      return { sqlType: "REAL", nullable: false, isJsonColumn: false };
    case "int64":
      return { sqlType: "INTEGER", nullable: false, isJsonColumn: false };
    case "boolean":
      return { sqlType: "INTEGER", nullable: false, isJsonColumn: false };
    case "id":
      return { sqlType: "TEXT", nullable: false, isJsonColumn: false };
    case "null":
      return { sqlType: "TEXT", nullable: true, isJsonColumn: false };
    case "bytes":
      return { sqlType: "BLOB", nullable: false, isJsonColumn: false };
    case "literal": {
      const v = validator.value;
      if (typeof v === "string") return { sqlType: "TEXT", nullable: false, isJsonColumn: false };
      if (typeof v === "number") return { sqlType: "REAL", nullable: false, isJsonColumn: false };
      if (typeof v === "boolean") return { sqlType: "INTEGER", nullable: false, isJsonColumn: false };
      return { sqlType: "TEXT", nullable: false, isJsonColumn: false };
    }
    case "optional": {
      const inner = validatorToSQLType(validator.value);
      return { ...inner, nullable: true };
    }
    case "object":
    case "array":
    case "union":
    case "record":
    case "any":
      return { sqlType: "TEXT", nullable: false, isJsonColumn: true };
    default:
      return { sqlType: "TEXT", nullable: false, isJsonColumn: true };
  }
}

function isBooleanValidator(v: ValidatorJSON): boolean {
  if (v.type === "boolean") return true;
  if (v.type === "optional") return isBooleanValidator(v.value);
  return false;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build column definition SQL fragments for a table schema. */
function buildColumnDefs(tableInfo: SchemaJSON["tables"][string]): string[] {
  const colDefs: string[] = [
    `_id TEXT PRIMARY KEY`,
    `_ts INTEGER NOT NULL`,
  ];
  for (const [fieldName, validatorJSON] of Object.entries(tableInfo.fields)) {
    const { sqlType, nullable } = validatorToSQLType(validatorJSON);
    const nullConstraint = nullable ? "" : " NOT NULL";
    colDefs.push(`"${fieldName}" ${sqlType}${nullConstraint}`);
  }
  return colDefs;
}

/** Drop all FTS tables and triggers associated with a content table. */
function dropFtsForTable(sql: SqlApi, tableName: string): void {
  const ftsNames = getExistingFtsTables(sql).filter((n) => n.startsWith(`${tableName}_`));
  for (const ftsName of ftsNames) {
    sql.exec(`DROP TRIGGER IF EXISTS "${ftsName}_ai"`);
    sql.exec(`DROP TRIGGER IF EXISTS "${ftsName}_ad"`);
    sql.exec(`DROP TABLE IF EXISTS "${ftsName}"`);
  }
}

// ---------------------------------------------------------------------------
// DDL generation
// ---------------------------------------------------------------------------

export function generateTableDDL(
  tableName: string,
  tableInfo: SchemaJSON["tables"][string]
): string[] {
  const stmts: string[] = [];

  const colDefs = buildColumnDefs(tableInfo);
  stmts.push(
    `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${colDefs.join(",\n  ")}\n)`
  );

  // User-defined indexes
  for (const index of tableInfo.indexes || []) {
    if (index.name === "by_id") continue;
    const indexCols = [...index.fields.map((f) => `"${f}"`), "_id"].join(", ");
    stmts.push(
      `CREATE INDEX IF NOT EXISTS "${tableName}_${index.name}" ON "${tableName}" (${indexCols})`
    );
  }

  // FTS5 search indexes
  for (const si of tableInfo.searchIndexes || []) {
    stmts.push(...generateSearchIndexDDL(tableName, si));
  }

  return stmts;
}

// ---------------------------------------------------------------------------
// FTS5 search index DDL
// ---------------------------------------------------------------------------

export function generateSearchIndexDDL(
  tableName: string,
  searchIndex: { name: string; searchField: string }
): string[] {
  const ftsTable = `${tableName}_${searchIndex.name}`;
  const field = searchIndex.searchField;
  const stmts: string[] = [];

  // FTS5 virtual table with external content
  stmts.push(
    `CREATE VIRTUAL TABLE IF NOT EXISTS "${ftsTable}" USING fts5("${field}", content="${tableName}", content_rowid=rowid)`
  );

  // AFTER INSERT trigger — sync new rows to FTS
  stmts.push(
    `CREATE TRIGGER IF NOT EXISTS "${ftsTable}_ai" AFTER INSERT ON "${tableName}" BEGIN INSERT INTO "${ftsTable}"(rowid, "${field}") VALUES (new.rowid, new."${field}"); END`
  );

  // AFTER DELETE trigger — remove deleted rows from FTS
  stmts.push(
    `CREATE TRIGGER IF NOT EXISTS "${ftsTable}_ad" AFTER DELETE ON "${tableName}" BEGIN INSERT INTO "${ftsTable}"("${ftsTable}", rowid, "${field}") VALUES ('delete', old.rowid, old."${field}"); END`
  );

  return stmts;
}

// ---------------------------------------------------------------------------
// Build column metadata from schema
// ---------------------------------------------------------------------------

export function buildTableColumns(
  schema: SchemaJSON
): Map<string, TableColumnInfo> {
  const result = new Map<string, TableColumnInfo>();

  for (const [tableName, tableInfo] of Object.entries(schema.tables)) {
    const columns = new Map<string, ColumnInfo>();
    const orderedFieldNames: string[] = [];

    // System columns
    columns.set("_id", { name: "_id", sqlType: "TEXT", nullable: false, isJsonColumn: false, isBoolean: false });
    columns.set("_ts", { name: "_ts", sqlType: "INTEGER", nullable: false, isJsonColumn: false, isBoolean: false });

    for (const [fieldName, validatorJSON] of Object.entries(tableInfo.fields)) {
      const { sqlType, nullable, isJsonColumn } = validatorToSQLType(validatorJSON);
      const isBoolean = isBooleanValidator(validatorJSON);
      columns.set(fieldName, { name: fieldName, sqlType, nullable, isJsonColumn, isBoolean });
      orderedFieldNames.push(fieldName);
    }

    result.set(tableName, { columns, orderedFieldNames });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Row serialization: JS doc → SQL params
// ---------------------------------------------------------------------------

/**
 * Convert a JS document to an array of SQL parameters matching column order:
 * [_id, _ts, ...userFields]
 */
export function docToSQLParams(
  doc: Record<string, unknown>,
  info: TableColumnInfo,
  commitTs: number
): unknown[] {
  const params: unknown[] = [
    doc._id,
    commitTs,
  ];

  for (const fieldName of info.orderedFieldNames) {
    const col = info.columns.get(fieldName)!;
    const value = doc[fieldName];

    if (value === undefined || value === null) {
      params.push(null);
    } else if (col.isJsonColumn) {
      params.push(JSON.stringify(value));
    } else if (col.isBoolean) {
      params.push(value ? 1 : 0);
    } else {
      params.push(value);
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// Row deserialization: SQL row → JS doc
// ---------------------------------------------------------------------------

/**
 * Convert a SQL row object to a JS document.
 * - Booleans: 1/0 → true/false
 * - JSON columns: JSON.parse
 * - Optional fields with null: omit key
 * - Excludes _ts (internal)
 */
export function sqlRowToDoc(
  row: Record<string, unknown>,
  info: TableColumnInfo
): Record<string, unknown> {
  const id = row._id as string;
  const ulidPart = ulidFromId(id);
  const doc: Record<string, unknown> = {
    _id: id,
    _creationTime: decodeTime(ulidPart),
  };

  for (const fieldName of info.orderedFieldNames) {
    const col = info.columns.get(fieldName)!;
    const value = row[fieldName];

    if (value === null || value === undefined) {
      if (!col.nullable) {
        doc[fieldName] = null;
      }
      // Optional fields with null → omit key (matches JSON.parse behavior)
      continue;
    }

    if (col.isJsonColumn) {
      doc[fieldName] = JSON.parse(value as string);
    } else if (col.isBoolean) {
      doc[fieldName] = value === 1 || value === true;
    } else {
      doc[fieldName] = value;
    }
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

type PragmaColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type PragmaIndexListEntry = {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

type PragmaIndexInfoEntry = {
  seqno: number;
  cid: number;
  name: string;
};

const SYSTEM_TABLES = new Set(["scheduled_jobs", "cron_jobs", "_storage"]);

function isSystemTable(name: string): boolean {
  return (
    SYSTEM_TABLES.has(name) ||
    name.startsWith("_migration_temp_") ||
    name.startsWith("_cf_") ||
    name.startsWith("sqlite_")
  );
}

function getExistingFtsTables(sql: SqlApi): string[] {
  const rows = sql
    .exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%fts5%'`)
    .toArray() as { name: string }[];
  return rows.map((r) => r.name);
}

function getExistingUserTables(sql: SqlApi): string[] {
  const ftsNames = new Set(getExistingFtsTables(sql));
  const rows = sql
    .exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .toArray() as { name: string }[];
  return rows.map((r) => r.name).filter((n) => !isSystemTable(n) && !ftsNames.has(n));
}

function getTableColumns(sql: SqlApi, tableName: string): PragmaColumnInfo[] {
  return sql.exec(`PRAGMA table_info("${tableName}")`).toArray() as unknown as PragmaColumnInfo[];
}

function getTableIndexes(sql: SqlApi, tableName: string): Map<string, string[]> {
  const indexes = new Map<string, string[]>();
  const list = sql.exec(`PRAGMA index_list("${tableName}")`).toArray() as unknown as PragmaIndexListEntry[];
  for (const entry of list) {
    if (entry.origin !== "c") continue; // skip auto-generated indexes (pk, unique constraints)
    const info = sql.exec(`PRAGMA index_info("${entry.name}")`).toArray() as unknown as PragmaIndexInfoEntry[];
    indexes.set(
      entry.name,
      info.sort((a, b) => a.seqno - b.seqno).map((i) => i.name)
    );
  }
  return indexes;
}

function computeDesiredIndexes(
  tableName: string,
  tableInfo: SchemaJSON["tables"][string]
): Map<string, string[]> {
  const indexes = new Map<string, string[]>();

  // User-defined indexes (matching generateTableDDL naming)
  for (const index of tableInfo.indexes || []) {
    if (index.name === "by_id") continue;
    indexes.set(`${tableName}_${index.name}`, [...index.fields, "_id"]);
  }

  return indexes;
}

function needsColumnChange(
  existing: PragmaColumnInfo,
  desiredType: string,
  desiredNullable: boolean
): boolean {
  if (existing.type.toUpperCase() !== desiredType.toUpperCase()) return true;
  const existingNullable = existing.notnull === 0;
  if (existingNullable !== desiredNullable) return true;
  return false;
}

function defaultValueForType(sqlType: string): string {
  switch (sqlType.toUpperCase()) {
    case "TEXT":
      return "''";
    case "REAL":
      return "0.0";
    case "INTEGER":
      return "0";
    case "BLOB":
      return "X''";
    default:
      return "''";
  }
}

function rebuildTable(
  sql: SqlApi,
  tableName: string,
  tableInfo: SchemaJSON["tables"][string]
): void {
  const tempName = `_migration_temp_${tableName}`;

  // 1. Drop leftover temp table
  sql.exec(`DROP TABLE IF EXISTS "${tempName}"`);

  // 2. Create temp table with new schema
  const colDefs = buildColumnDefs(tableInfo);
  sql.exec(`CREATE TABLE "${tempName}" (\n  ${colDefs.join(",\n  ")}\n)`);

  // 3. Copy data: common columns get values, new columns get defaults
  const existingCols = getTableColumns(sql, tableName);
  const existingColNames = new Set(existingCols.map((c) => c.name));

  const selectExprs: string[] = ["_id", "_ts"];
  const insertCols: string[] = ["_id", "_ts"];

  for (const [fieldName, validatorJSON] of Object.entries(tableInfo.fields)) {
    const { sqlType, nullable } = validatorToSQLType(validatorJSON);
    insertCols.push(`"${fieldName}"`);
    if (existingColNames.has(fieldName)) {
      selectExprs.push(`"${fieldName}"`);
    } else {
      // New column — use type-appropriate default
      selectExprs.push(nullable ? "NULL" : defaultValueForType(sqlType));
    }
  }

  sql.exec(
    `INSERT INTO "${tempName}" (${insertCols.join(", ")}) SELECT ${selectExprs.join(", ")} FROM "${tableName}"`
  );

  // 4. Drop old table
  sql.exec(`DROP TABLE "${tableName}"`);

  // 5. Rename temp to real
  sql.exec(`ALTER TABLE "${tempName}" RENAME TO "${tableName}"`);
}

function migrateIndexes(
  sql: SqlApi,
  tableName: string,
  tableInfo: SchemaJSON["tables"][string]
): void {
  const existing = getTableIndexes(sql, tableName);
  const desired = computeDesiredIndexes(tableName, tableInfo);

  // Drop indexes not in desired set or with changed columns
  for (const [name, cols] of existing) {
    const desiredCols = desired.get(name);
    if (!desiredCols || JSON.stringify(cols) !== JSON.stringify(desiredCols)) {
      sql.exec(`DROP INDEX IF EXISTS "${name}"`);
    }
  }

  // Create all desired indexes
  for (const [name, cols] of desired) {
    const colsStr = cols.map((c) => `"${c}"`).join(", ");
    sql.exec(`CREATE INDEX IF NOT EXISTS "${name}" ON "${tableName}" (${colsStr})`);
  }
}

function migrateSearchIndexes(
  sql: SqlApi,
  tableName: string,
  tableInfo: SchemaJSON["tables"][string]
): void {
  const desiredFts = new Map<string, { name: string; searchField: string }>();
  for (const si of tableInfo.searchIndexes || []) {
    desiredFts.set(`${tableName}_${si.name}`, si);
  }

  // Find existing FTS tables for this content table
  const existingFts = getExistingFtsTables(sql).filter(
    (name) => name.startsWith(`${tableName}_`)
  );

  // Drop stale FTS tables + triggers
  for (const ftsName of existingFts) {
    if (!desiredFts.has(ftsName)) {
      sql.exec(`DROP TRIGGER IF EXISTS "${ftsName}_ai"`);
      sql.exec(`DROP TRIGGER IF EXISTS "${ftsName}_ad"`);
      sql.exec(`DROP TABLE IF EXISTS "${ftsName}"`);
    }
  }


  const existingSet = new Set(existingFts);

  // Create missing FTS tables + triggers
  for (const [ftsName, si] of desiredFts) {
    if (!existingSet.has(ftsName)) {
      for (const stmt of generateSearchIndexDDL(tableName, si)) {
        sql.exec(stmt);
      }
      // Populate FTS from existing content table data
      sql.exec(`INSERT INTO "${ftsName}"("${ftsName}") VALUES ('rebuild')`);
    }
  }
}

const SYSTEM_COLS = new Set(["_id", "_ts"]);

export function migrateSchema(sql: SqlApi, schema: SchemaJSON): void {
  const existingTables = new Set(getExistingUserTables(sql));
  const desiredTables = new Set(Object.keys(schema.tables));

  for (const [tableName, tableInfo] of Object.entries(schema.tables)) {
    if (!existingTables.has(tableName)) {
      // New table — create from scratch
      for (const stmt of generateTableDDL(tableName, tableInfo)) {
        sql.exec(stmt);
      }
      continue;
    }

    // Existing table — diff columns
    const existingCols = getTableColumns(sql, tableName);
    const existingColMap = new Map(existingCols.map((c) => [c.name, c]));

    let needsRebuild = false;
    const addableCols: { name: string; sqlType: string; nullable: boolean }[] = [];

    // Check for removed columns (user fields in DB but not in schema)
    for (const col of existingCols) {
      if (SYSTEM_COLS.has(col.name)) continue;
      if (!(col.name in tableInfo.fields)) {
        needsRebuild = true;
        break;
      }
    }

    if (!needsRebuild) {
      // Check for type/nullability changes and new columns
      for (const [fieldName, validatorJSON] of Object.entries(tableInfo.fields)) {
        const { sqlType, nullable } = validatorToSQLType(validatorJSON);
        const existing = existingColMap.get(fieldName);

        if (!existing) {
          // New column
          if (!nullable) {
            needsRebuild = true; // New NOT NULL column requires rebuild
            break;
          }
          addableCols.push({ name: fieldName, sqlType, nullable });
        } else if (needsColumnChange(existing, sqlType, nullable)) {
          needsRebuild = true;
          break;
        }
      }
    }

    if (needsRebuild) {
      // Drop all FTS tables/triggers before rebuild (they reference the old table)
      dropFtsForTable(sql, tableName);
      rebuildTable(sql, tableName, tableInfo);
    } else if (addableCols.length > 0) {
      // Simple ALTER TABLE ADD COLUMN for new nullable columns
      for (const col of addableCols) {
        sql.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${col.name}" ${col.sqlType}`);
      }
    }

    // Always reconcile indexes
    migrateIndexes(sql, tableName, tableInfo);

    // Reconcile FTS search indexes
    migrateSearchIndexes(sql, tableName, tableInfo);
  }

  // Drop tables no longer in schema (including their FTS tables/triggers)
  for (const tableName of existingTables) {
    if (!desiredTables.has(tableName)) {
      dropFtsForTable(sql, tableName);
      sql.exec(`DROP TABLE IF EXISTS "${tableName}"`);
    }
  }
}

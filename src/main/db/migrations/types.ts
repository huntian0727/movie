import type { DatabaseConnection } from "../database.js";

export interface Migration {
  version: number;
  description: string;
  assertBefore(db: DatabaseConnection): void;
  up(db: DatabaseConnection): void;
  assertAfter(db: DatabaseConnection): void;
}

export function listTables(db: DatabaseConnection): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
    name: string;
  }>;
  return new Set(rows.map((row) => row.name));
}

export function listColumns(db: DatabaseConnection, tableName: string): Set<string> {
  const safeTableName = tableName.replaceAll('"', '""');
  const rows = db.prepare(`PRAGMA table_info("${safeTableName}")`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export function requireTables(db: DatabaseConnection, tableNames: string[]): void {
  const tables = listTables(db);
  const missing = tableNames.filter((tableName) => !tables.has(tableName));
  if (missing.length > 0) {
    throw new Error(`Missing required tables: ${missing.join(", ")}`);
  }
}

export function requireColumns(db: DatabaseConnection, tableName: string, columnNames: string[]): void {
  const columns = listColumns(db, tableName);
  const missing = columnNames.filter((columnName) => !columns.has(columnName));
  if (missing.length > 0) {
    throw new Error(`Table ${tableName} is missing required columns: ${missing.join(", ")}`);
  }
}

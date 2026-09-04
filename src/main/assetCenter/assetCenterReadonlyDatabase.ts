import Database from "better-sqlite3";
import type { DatabaseConnection } from "../db/database.js";

export function openAssetCenterReadonlyDatabase(databasePath: string): DatabaseConnection {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    database.pragma("query_only = ON");
    database.pragma("busy_timeout = 5000");
    return database;
  } catch (error: unknown) {
    database.close();
    throw error;
  }
}

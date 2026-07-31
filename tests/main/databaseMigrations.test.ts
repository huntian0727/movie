import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  DatabaseMigrationError,
  type DatabaseConnection
} from "../../src/main/db/database.js";
import { LATEST_SCHEMA_VERSION, migrations } from "../../src/main/db/migrations/index.js";

let tempDirectories: string[] = [];

afterEach(() => {
  for (const tempDirectory of tempDirectories) {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
  tempDirectories = [];
});

function createTempDatabasePath(): string {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "video-manager-migration-"));
  tempDirectories.push(tempDirectory);
  return path.join(tempDirectory, "library.sqlite");
}

function createVersionFixture(dbPath: string, version: number, versioned = true): DatabaseConnection {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.transaction(() => {
    for (const migration of migrations) {
      if (migration.version > version) {
        break;
      }
      migration.assertBefore(db);
      migration.up(db);
      migration.assertAfter(db);
      db.pragma(`user_version = ${migration.version}`);
    }
    if (!versioned) {
      db.pragma("user_version = 0");
    }
  })();
  return db;
}

function listColumns(db: DatabaseConnection, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function insertVersionOneData(db: DatabaseConnection): void {
  db.prepare(`
    INSERT INTO source_folders (
      id, path, recursive, enabled, last_scanned_at, created_at, updated_at, scan_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("folder-1", "D:\\Videos", 1, 1, null, "2026-01-01", "2026-01-01", null);
  db.prepare(`
    INSERT INTO videos (
      id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
      duration_ms, width, height, format, modified_at, imported_at, updated_at, is_favorite,
      is_missing, metadata_status, thumbnail_status, timeline_preview_status, cover_cache_path
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    "video-1", "folder-1", "D:\\Videos\\sample.mp4", "D:\\Videos", "sample.mp4", "sample", ".mp4", 42,
    null, null, null, null, "2026-01-01", "2026-01-01", "2026-01-01", 1, 0, "pending", "pending", "pending", null
  );
}

describe("versioned database migrations", () => {
  it("creates an empty database at the latest schema version", () => {
    const dbPath = createTempDatabasePath();
    const db = createDatabase(dbPath);
    try {
      expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
      expect(listColumns(db, "videos")).toEqual(expect.arrayContaining([
        "content_fingerprint", "fingerprint_status", "is_pending_delete"
      ]));
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all()).toEqual(expect.arrayContaining([
        "directory_snapshots", "scan_failures", "scan_tasks"
      ]));
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(db.pragma("quick_check", { simple: true })).toBe("ok");
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
      expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
        "idx_videos_size_bytes", "idx_videos_fingerprint_status", "idx_videos_is_pending_delete"
      ]));
      const defaultRow = db.prepare(`
        SELECT dflt_value FROM pragma_table_info('videos') WHERE name = 'is_pending_delete'
      `).get() as { dflt_value: string };
      expect(defaultRow.dflt_value).toBe("0");
    } finally {
      db.close();
    }
  });

  it("adopts a recognized unversioned database, preserves data, and creates an independent backup", () => {
    const dbPath = createTempDatabasePath();
    const fixture = createVersionFixture(dbPath, 1, false);
    insertVersionOneData(fixture);
    fixture.close();

    const db = createDatabase(dbPath, { now: () => new Date("2026-07-23T01:02:03.000Z") });
    try {
      expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
      expect(db.prepare("SELECT filename, is_favorite, is_pending_delete FROM videos").get()).toEqual({
        filename: "sample.mp4",
        is_favorite: 1,
        is_pending_delete: 0
      });
    } finally {
      db.close();
    }

    const backupDirectory = `${dbPath}.backups`;
    const backupFiles = readdirSync(backupDirectory);
    expect(backupFiles).toEqual(["library.sqlite.v1.2026-07-23T01-02-03.000Z.sqlite"]);
    const backup = new Database(path.join(backupDirectory, backupFiles[0]), { readonly: true, fileMustExist: true });
    try {
      expect(backup.pragma("user_version", { simple: true })).toBe(0);
      expect(backup.prepare("SELECT filename FROM videos").pluck().get()).toBe("sample.mp4");
      expect(backup.pragma("quick_check", { simple: true })).toBe("ok");
    } finally {
      backup.close();
    }
  });

  for (const version of [1, 2, 3, 4]) {
    it(`upgrades schema version ${version} to the latest version`, () => {
      const dbPath = createTempDatabasePath();
      createVersionFixture(dbPath, version).close();
      const db = createDatabase(dbPath);
      try {
        expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
        expect(listColumns(db, "videos")).toContain("is_pending_delete");
      } finally {
        db.close();
      }
    });
  }

  for (const failedVersion of [1, 2, 3, 4, 5]) {
    it(`rolls back completely when migration ${failedVersion} fails`, () => {
      const dbPath = createTempDatabasePath();
      const startingVersion = failedVersion - 1;
      if (startingVersion > 0) {
        createVersionFixture(dbPath, startingVersion).close();
      }

      expect(() => createDatabase(dbPath, {
        migrationHooks: {
          beforeMigration(version) {
            if (version === failedVersion) {
              throw new Error(`injected migration ${version} failure`);
            }
          }
        }
      })).toThrow(DatabaseMigrationError);

      const db = new Database(dbPath);
      try {
        expect(db.pragma("user_version", { simple: true })).toBe(startingVersion);
        if (startingVersion === 0) {
          expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);
        } else if (failedVersion === 3) {
          expect(listColumns(db, "videos")).not.toContain("content_fingerprint");
        } else if (failedVersion === 4) {
          expect(listColumns(db, "videos")).not.toContain("is_pending_delete");
        } else if (failedVersion === 5) {
          expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'directory_snapshots'").pluck().get()).toBeUndefined();
        }
      } finally {
        db.close();
      }
    });
  }

  it("refuses an unknown unversioned schema without modifying it", () => {
    const dbPath = createTempDatabasePath();
    const db = new Database(dbPath);
    db.exec("CREATE TABLE unexpected_data (id TEXT PRIMARY KEY)");
    db.close();

    expect(() => createDatabase(dbPath)).toThrow(/not recognized/);
    const reopened = new Database(dbPath);
    try {
      expect(reopened.pragma("user_version", { simple: true })).toBe(0);
      expect(reopened.prepare("SELECT name FROM sqlite_master WHERE name = 'unexpected_data'").pluck().get()).toBe(
        "unexpected_data"
      );
    } finally {
      reopened.close();
    }
  });

  it("does not begin migration when the backup step fails", () => {
    const dbPath = createTempDatabasePath();
    createVersionFixture(dbPath, 2).close();

    expect(() => createDatabase(dbPath, {
      migrationHooks: {
        beforeBackup() {
          throw new Error("simulated read-only directory or full disk");
        }
      }
    })).toThrow(/backup failed/);

    const reopened = new Database(dbPath);
    try {
      expect(reopened.pragma("user_version", { simple: true })).toBe(2);
      expect(listColumns(reopened, "videos")).not.toContain("content_fingerprint");
    } finally {
      reopened.close();
    }
  });

  it("backs up committed WAL content before upgrading an older schema", () => {
    const dbPath = createTempDatabasePath();
    const fixture = createVersionFixture(dbPath, 2);
    fixture.pragma("journal_mode = WAL");
    fixture.pragma("wal_autocheckpoint = 0");
    insertVersionOneData(fixture);

    const upgraded = createDatabase(dbPath, { now: () => new Date("2026-07-25T03:04:05.000Z") });
    try {
      expect(upgraded.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
      expect(upgraded.prepare("SELECT filename FROM videos WHERE id = ?").pluck().get("video-1")).toBe("sample.mp4");
    } finally {
      upgraded.close();
      fixture.close();
    }

    const backupPath = path.join(
      `${dbPath}.backups`,
      "library.sqlite.v2.2026-07-25T03-04-05.000Z.sqlite"
    );
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      expect(backup.pragma("user_version", { simple: true })).toBe(2);
      expect(backup.prepare("SELECT filename FROM videos WHERE id = ?").pluck().get("video-1")).toBe("sample.mp4");
      expect(backup.pragma("quick_check", { simple: true })).toBe("ok");
    } finally {
      backup.close();
    }
  });

  it("refuses a concurrent locked migration without changing the old schema", () => {
    const dbPath = createTempDatabasePath();
    const fixture = createVersionFixture(dbPath, 2);
    fixture.exec("BEGIN IMMEDIATE");
    try {
      expect(() => createDatabase(dbPath)).toThrow(DatabaseMigrationError);
      expect(fixture.pragma("user_version", { simple: true })).toBe(2);
      expect(listColumns(fixture, "videos")).not.toContain("content_fingerprint");
    } finally {
      fixture.exec("ROLLBACK");
      fixture.close();
    }
  });

  it("is idempotent after reaching the latest version", () => {
    const dbPath = createTempDatabasePath();
    createDatabase(dbPath).close();
    const db = createDatabase(dbPath);
    try {
      expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
      expect(listColumns(db, "videos").filter((name) => name === "is_pending_delete")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("refuses a versioned database whose declared current schema is incomplete", () => {
    const dbPath = createTempDatabasePath();
    const fixture = createVersionFixture(dbPath, LATEST_SCHEMA_VERSION);
    fixture.exec("DROP TABLE play_history");
    fixture.close();

    let migrationError: unknown;
    try {
      createDatabase(dbPath);
    } catch (error: unknown) {
      migrationError = error;
    }
    expect(migrationError).toBeInstanceOf(DatabaseMigrationError);
    expect((migrationError as Error & { cause?: Error }).cause?.message).toMatch(/Missing required tables/);
    const reopened = new Database(dbPath);
    try {
      expect(reopened.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      reopened.close();
    }
  });
});

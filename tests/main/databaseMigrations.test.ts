import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  DatabaseMigrationError,
  type DatabaseConnection
} from "../../src/main/db/database.js";
import { LATEST_SCHEMA_VERSION, migrations } from "../../src/main/db/migrations/index.js";
import { legacyScanErrorsMigration } from "../../src/main/db/migrations/006-legacy-scan-errors.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";
import { retryScanFailures } from "../../src/main/media/libraryScanner.js";

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

function insertSourceFolder(db: DatabaseConnection, id: string, scanError: string | null, folderPath = `D:\\Videos\\${id}`): void {
  db.prepare(`
    INSERT INTO source_folders (
      id, path, recursive, enabled, last_scanned_at, created_at, updated_at, scan_error
    ) VALUES (?, ?, 1, 1, NULL, ?, ?, ?)
  `).run(id, folderPath, "2026-01-01", "2026-01-01", scanError);
}

describe("versioned database migrations", () => {
  it("creates an empty database at the latest schema version", () => {
    const dbPath = createTempDatabasePath();
    const db = createDatabase(dbPath);
    try {
      expect(db.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
      expect(listColumns(db, "videos")).toEqual(expect.arrayContaining([
        "content_fingerprint", "fingerprint_status", "is_pending_delete",
        "video_codec", "video_profile", "pixel_format", "audio_codec", "codec_probe_status"
      ]));
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all()).toEqual(expect.arrayContaining([
        "directory_snapshots", "scan_failures", "scan_tasks"
      ]));
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(db.pragma("quick_check", { simple: true })).toBe("ok");
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
      expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
        "idx_videos_size_bytes", "idx_videos_fingerprint_status", "idx_videos_is_pending_delete",
        "idx_videos_library_modified", "idx_videos_library_size", "idx_videos_library_duration",
        "idx_videos_cover_cache_path", "idx_timeline_previews_cache_path"
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

  for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) {
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

  for (const failedVersion of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
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
        } else if (failedVersion === 6) {
          expect(db.prepare("SELECT COUNT(*) FROM scan_failures").pluck().get()).toBe(0);
        } else if (failedVersion === 7) {
          expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'duplicate_cleanup_jobs'").pluck().get()).toBeUndefined();
        } else if (failedVersion === 8) {
          expect(listColumns(db, "videos")).not.toContain("video_codec");
        } else if (failedVersion === 9) {
          expect(listColumns(db, "videos")).not.toContain("codec_probe_status");
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

  it("adds probe status to a 10,000-video v8 library without resetting metadata or queueing the library", () => {
    const dbPath = createTempDatabasePath();
    const fixture = createVersionFixture(dbPath, 8);
    insertSourceFolder(fixture, "large-library", null, "D:\\Large");
    const insert = fixture.prepare(`
      INSERT INTO videos (
        id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
        duration_ms, width, height, format, modified_at, imported_at, updated_at,
        metadata_status, thumbnail_status, timeline_preview_status
      ) VALUES (?, 'large-library', ?, 'D:\\Large', ?, ?, '.mp4', 100, 1000, 1920, 1080, 'mp4',
        '2026-01-01', '2026-01-01', '2026-01-01', 'ready', 'ready', 'ready')
    `);
    fixture.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        const filename = `video-${index}.mp4`;
        insert.run(`video-${index}`, `D:\\Large\\${filename}`, filename, `video-${index}`);
      }
    })();
    fixture.close();
    const migrated = createDatabase(dbPath);
    try {
      expect(migrated.prepare("SELECT COUNT(*) FROM videos").pluck().get()).toBe(10_000);
      expect(migrated.prepare("SELECT COUNT(*) FROM videos WHERE metadata_status = 'ready'").pluck().get()).toBe(10_000);
      expect(migrated.prepare("SELECT COUNT(*) FROM videos WHERE video_codec IS NULL").pluck().get()).toBe(10_000);
      expect(migrated.prepare("SELECT COUNT(*) FROM videos WHERE codec_probe_status = 'unprobed'").pluck().get()).toBe(10_000);
      expect(migrated.prepare("SELECT COUNT(*) FROM videos WHERE metadata_status = 'pending'").pluck().get()).toBe(0);
      expect(new VideoRepository(migrated).listVideosPendingMetadata()).toEqual([]);
    } finally {
      migrated.close();
    }
  });

  it("migrates v8 codec records to ready while preserving null codec records and user state", () => {
    const dbPath = createTempDatabasePath();
    const fixture = createVersionFixture(dbPath, 8);
    insertSourceFolder(fixture, "codec-library", null, "D:\\Codec");
    const insert = fixture.prepare(`
      INSERT INTO videos (
        id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
        duration_ms, width, height, format, video_codec, modified_at, imported_at, updated_at,
        is_favorite, is_pending_delete, metadata_status, thumbnail_status, timeline_preview_status
      ) VALUES (?, 'codec-library', ?, 'D:\\Codec', ?, ?, '.mp4', ?, ?, 1920, 1080, 'mp4', ?,
        '2026-01-01', '2026-01-01', '2026-01-01', ?, ?, ?, 'ready', 'ready')
    `);
    insert.run("known", "D:\\Codec\\known.mp4", "known.mp4", "known", 100, 1_000, "h264", 1, 1, "ready");
    insert.run("unknown", "D:\\Codec\\unknown.mp4", "unknown.mp4", "unknown", 200, 2_000, null, 0, 0, "ready");
    fixture.close();

    const migrated = createDatabase(dbPath);
    try {
      expect(migrated.prepare(`
        SELECT id, codec_probe_status, metadata_status, is_favorite, is_pending_delete, path
        FROM videos ORDER BY id
      `).all()).toEqual([
        { id: "known", codec_probe_status: "ready", metadata_status: "ready", is_favorite: 1, is_pending_delete: 1, path: "D:\\Codec\\known.mp4" },
        { id: "unknown", codec_probe_status: "unprobed", metadata_status: "ready", is_favorite: 0, is_pending_delete: 0, path: "D:\\Codec\\unknown.mp4" }
      ]);
      expect(migrated.prepare("SELECT COUNT(*) FROM videos").pluck().get()).toBe(2);
    } finally {
      migrated.close();
    }
  });

  it("migrates v9 cleanup tasks to v10 with legacy authorization safely invalidated", () => {
    const dbPath = createTempDatabasePath();
    const legacy = createVersionFixture(dbPath, 9);
    const now = "2026-08-16T00:00:00.000Z";
    legacy.prepare(`INSERT INTO duplicate_cleanup_jobs
      (id, request_id, status, total_groups, total_items, created_at, updated_at)
      VALUES ('legacy-job', 'legacy-request', 'running', 1, 1, ?, ?)`)
      .run(now, now);
    legacy.prepare(`INSERT INTO duplicate_cleanup_items
      (id, job_id, group_key, keep_video_id, delete_video_id, keep_path, delete_path, filename, directory,
       expected_keep_size_bytes, expected_keep_modified_at, expected_delete_size_bytes, expected_delete_modified_at,
       planned_reclaimable_bytes, status, created_at, updated_at)
      VALUES ('legacy-item', 'legacy-job', 'g', 'keep', 'delete', 'K:/keep.mp4', 'K:/delete.mp4', 'delete.mp4', 'K:/',
       64, ?, 64, ?, 64, 'deleting', ?, ?)`)
      .run(now, now, now, now);
    legacy.prepare(`INSERT INTO duplicate_cleanup_reservations
      (id, job_id, video_id, role, created_at, released_at)
      VALUES ('legacy-reservation', 'legacy-job', 'delete', 'delete', ?, NULL)`).run(now);
    legacy.close();

    const upgraded = createDatabase(dbPath);
    expect(upgraded.pragma("user_version", { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(upgraded.prepare("SELECT workflow_version, phase, status, authorized_revision FROM duplicate_cleanup_jobs WHERE id = 'legacy-job'").get())
      .toEqual({ workflow_version: 1, phase: "legacy_blocked", status: "cancelled", authorized_revision: null });
    expect(upgraded.prepare(`SELECT status, verification_status, keep_sha256, delete_sha256,
      keep_file_identity, delete_file_identity, staged_delete_path FROM duplicate_cleanup_items WHERE id = 'legacy-item'`).get())
      .toEqual({ status: "cancelled", verification_status: "unverified", keep_sha256: null, delete_sha256: null,
        keep_file_identity: null, delete_file_identity: null, staged_delete_path: null });
    expect((upgraded.prepare("SELECT released_at FROM duplicate_cleanup_reservations WHERE id = 'legacy-reservation'").get() as { released_at: string | null }).released_at).not.toBeNull();
    upgraded.close();
  });

  it("backfills a legacy folder scan error as one retryable directory failure", () => {
    const dbPath = createTempDatabasePath();
    const fixture = createVersionFixture(dbPath, 5);
    insertSourceFolder(fixture, "legacy-folder", "旧版本扫描超时");
    fixture.close();

    const db = createDatabase(dbPath);
    try {
      expect(db.prepare(`
        SELECT source_folder_id, scan_task_id, object_type, object_path, normalized_path,
               failure_stage, error_code, error_summary, retry_count, status, resolved_at
        FROM scan_failures
      `).get()).toEqual({
        source_folder_id: "legacy-folder",
        scan_task_id: "migration:v6",
        object_type: "directory",
        object_path: "D:\\Videos\\legacy-folder",
        normalized_path: "d:\\videos\\legacy-folder",
        failure_stage: "legacy-scan-error",
        error_code: "LEGACY_SCAN_ERROR",
        error_summary: "旧版本扫描超时",
        retry_count: 0,
        status: "unresolved",
        resolved_at: null
      });
      expect(db.prepare("SELECT scan_error FROM source_folders WHERE id = ?").pluck().get("legacy-folder"))
        .toBe("旧版本扫描超时");
    } finally {
      db.close();
    }
  });

  it("does not duplicate an existing active failure while migrating legacy scan errors", () => {
    const dbPath = createTempDatabasePath();
    const fixture = createVersionFixture(dbPath, 5);
    insertSourceFolder(fixture, "existing-folder", "旧版本错误");
    fixture.prepare(`
      INSERT INTO scan_failures (
        id, source_folder_id, scan_task_id, object_type, object_path, normalized_path,
        failure_stage, error_code, error_summary, first_failed_at, last_failed_at,
        retry_count, status, resolved_at
      ) VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, 0, 'unresolved', NULL)
    `).run(
      "existing-failure", "existing-folder", "task-1", "D:\\Videos\\existing-folder\\sample.mp4",
      "d:\\videos\\existing-folder\\sample.mp4", "metadata", "EIO", "读取失败", "2026-01-01", "2026-01-01"
    );
    fixture.close();

    const db = createDatabase(dbPath);
    try {
      expect(db.prepare("SELECT COUNT(*) FROM scan_failures WHERE source_folder_id = ?").pluck().get("existing-folder"))
        .toBe(1);
      expect(db.prepare("SELECT id FROM scan_failures WHERE source_folder_id = ?").pluck().get("existing-folder"))
        .toBe("existing-failure");
    } finally {
      db.close();
    }
  });

  it("ignores empty legacy errors and remains idempotent when the migration body is repeated", () => {
    const dbPath = createTempDatabasePath();
    const db = createVersionFixture(dbPath, 5);
    insertSourceFolder(db, "empty-folder", "   ");
    insertSourceFolder(db, "null-folder", null);
    insertSourceFolder(db, "legacy-folder", "需要重试");

    legacyScanErrorsMigration.up(db);
    legacyScanErrorsMigration.up(db);

    expect(db.prepare("SELECT COUNT(*) FROM scan_failures").pluck().get()).toBe(1);
    expect(db.prepare("SELECT source_folder_id FROM scan_failures").pluck().get()).toBe("legacy-folder");
    db.close();
  });

  it("resolves a migrated legacy directory failure and clears scan_error after retry", async () => {
    const dbPath = createTempDatabasePath();
    const mediaDirectory = path.join(path.dirname(dbPath), "legacy-media");
    mkdirSync(mediaDirectory);
    const fixture = createVersionFixture(dbPath, 5);
    insertSourceFolder(fixture, "legacy-folder", "旧版本扫描异常", mediaDirectory);
    fixture.close();

    const db = createDatabase(dbPath);
    try {
      const repo = new VideoRepository(db);
      const source = repo.listSourceFolders().find((item) => item.id === "legacy-folder")!;
      const result = await retryScanFailures(repo, source);

      expect(result.state).toBe("completed");
      expect(repo.getScanFailureSummary(source.id).totalUnresolved).toBe(0);
      expect(repo.listSourceFolders().find((item) => item.id === source.id)?.scanError).toBeNull();
    } finally {
      db.close();
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

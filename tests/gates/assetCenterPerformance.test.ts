// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { listAssetCenterSources, listDirectoryBrowserItems } from "../../src/main/assetCenter/assetCenterQueries.js";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";

const VIDEO_COUNT = 320_000;
const SOURCE_COUNT = 100;
const SOURCE_PAGE_BUDGET_MS = 2_000;
const METADATA_PAGE_BUDGET_MS = 3_000;

let database: DatabaseConnection | undefined;
let tempDirectory: string | undefined;
let sources: ReturnType<VideoRepository["listSourceFolders"]> = [];

afterAll(() => {
  database?.close();
  database = undefined;
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe("Asset Center performance gate", () => {
  // Retain main's single 60s deadline for fixture preparation and all queries,
  // in addition to the individual 2s/3s query budgets.
  it("aggregates a 320,000-video, 100-source page with one SQLite statement", () => {
    tempDirectory = mkdtempSync(path.join(tmpdir(), "video-manager-asset-performance-"));
    database = createDatabase(path.join(tempDirectory, "library.sqlite"));
    const repo = new VideoRepository(database);
    sources = Array.from({ length: SOURCE_COUNT }, (_, index) =>
      repo.addSourceFolder(`D:\\Synthetic\\source-${String(index).padStart(3, "0")}`, true)
    );
    // Keep the production schema, indexes, triggers and WAL configuration. Bulk
    // SQL avoids 320k JS/N-API object conversions; it generates the same rows in
    // the same insertion order as the former loop, including rowid % 4 semantics.
    database.exec("CREATE TEMP TABLE fixture_sources (ordinal INTEGER PRIMARY KEY, id TEXT NOT NULL, path TEXT NOT NULL)");
    const mapSource = database.prepare("INSERT INTO temp.fixture_sources VALUES (?, ?, ?)");
    const beforeRevisions = database.prepare('SELECT "all", library, images, batch_mask FROM query_cache_revisions WHERE id = 1').get() as { all: number; library: number; images: number; batch_mask: number };
    const insert = database.prepare(`
      WITH RECURSIVE numbers(i) AS (
        SELECT CAST(@start AS INTEGER) UNION ALL SELECT i + 1 FROM numbers WHERE i + 1 < @end
      ), labels AS (
        SELECT i, s.id AS source_id,
          s.path || char(92) || 'bucket-' || CAST(i / 10000 AS INTEGER) AS directory,
          printf('video-%06d.mp4', i) AS filename
        FROM numbers JOIN temp.fixture_sources AS s ON s.ordinal = i % 100
      )
      INSERT INTO videos (
        id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
        duration_ms, width, height, format, modified_at, imported_at, updated_at, is_favorite,
        is_pending_delete, is_missing, metadata_status, thumbnail_status, timeline_preview_status,
        cover_cache_path, content_fingerprint, fingerprint_status, fingerprint_updated_at, fingerprint_error
      ) SELECT
        'asset-video-' || i, source_id, directory || char(92) || filename,
        directory, filename, substr(filename, 1, length(filename) - 4), '.mp4', 10000 + i,
        1000 + i * 1000, 1920, 1080, 'mp4', @timestamp, @timestamp, @timestamp, 0,
        0, 0, 'ready', 'pending', 'pending', NULL, NULL, 'pending', NULL, NULL
      FROM labels ORDER BY i ASC
    `);
    const timestamp = "2026-09-04T00:00:00.000Z";
    database.transaction(() => {
      sources.forEach((source, ordinal) => mapSource.run(ordinal, source.id, source.path));
      for (let start = 0; start < VIDEO_COUNT; start += 10_000) {
        expect(insert.run({ start, end: start + 10_000, timestamp }).changes).toBe(10_000);
      }
    })();

    expect(database.prepare("SELECT COUNT(*) AS count FROM videos").get()).toEqual({ count: VIDEO_COUNT });
    expect(database.prepare("SELECT COUNT(*) AS count FROM videos WHERE id <> 'asset-video-' || (rowid - 1)").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM (SELECT source_folder_id FROM videos GROUP BY source_folder_id HAVING COUNT(*) = ?)").get(VIDEO_COUNT / SOURCE_COUNT)).toEqual({ count: SOURCE_COUNT });
    expect(database.prepare('SELECT "all", library, images, batch_mask FROM query_cache_revisions WHERE id = 1').get()).toEqual({
      all: beforeRevisions.all + VIDEO_COUNT, library: beforeRevisions.library + VIDEO_COUNT,
      images: beforeRevisions.images + VIDEO_COUNT, batch_mask: beforeRevisions.batch_mask
    });
    database.exec("DROP TABLE temp.fixture_sources");
    if (!database) throw new Error("Performance fixture was not initialized");

    let statementCount = 0;
    const measuredDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            statementCount += 1;
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as DatabaseConnection;

    const startedAt = performance.now();
    const page = listAssetCenterSources(measuredDatabase, {
      page: 1,
      pageSize: 30,
      search: "",
      type: "all",
      availability: "all",
      sort: "sizeBytes",
      direction: "desc"
    });
    const elapsedMs = performance.now() - startedAt;
    console.info(`Asset Center 320k/100-source page: ${elapsedMs.toFixed(2)} ms, ${statementCount} statement`);

    expect(statementCount).toBe(1);
    expect(page).toMatchObject({ page: 1, pageSize: 30, totalPages: 4, totalCount: SOURCE_COUNT });
    expect(page.items).toHaveLength(30);
    expect(page.items[0]!.sizeBytes).toBeGreaterThanOrEqual(page.items[1]!.sizeBytes);
    expect(elapsedMs).toBeLessThan(SOURCE_PAGE_BUDGET_MS);

    statementCount = 0;
    const directoryStartedAt = performance.now();
    const directories = listDirectoryBrowserItems(measuredDatabase, { search: "bucket", limit: 100 });
    const directoryElapsedMs = performance.now() - directoryStartedAt;
    console.info(`Directory search 320k/100-source: ${directoryElapsedMs.toFixed(2)} ms, ${statementCount} statements`);
    expect(directories).toMatchObject({ truncated: true, totalCount: 101 });
    expect(directories.items).toHaveLength(100);
    expect(directories.items.every((item) => item.name.startsWith("bucket"))).toBe(true);
    expect(statementCount).toBe(2);
    expect(directoryElapsedMs).toBeLessThan(3_000);

    database.prepare("UPDATE videos SET metadata_status = CASE WHEN rowid % 4 = 0 THEN 'failed' ELSE 'pending' END").run();
    const insertFailure = database.prepare(`
      INSERT INTO scan_failures (
        id, source_folder_id, scan_task_id, object_type, object_path, normalized_path,
        failure_stage, error_code, error_summary, first_failed_at, last_failed_at,
        retry_count, status, resolved_at
      ) VALUES (
        @id, @sourceFolderId, @scanTaskId, 'file', @objectPath, @normalizedPath,
        'metadata', 'EPROBE', 'ffprobe failed', @timestamp, @timestamp,
        1, 'unresolved', NULL
      )
    `);
    database.transaction(() => {
      for (let failureIndex = 0; failureIndex < 5_000; failureIndex += 1) {
        const videoIndex = failureIndex * 64 + 3;
        const source = sources[videoIndex % SOURCE_COUNT]!;
        const filename = `video-${String(videoIndex).padStart(6, "0")}.mp4`;
        const directory = `${source.path}\\bucket-${Math.floor(videoIndex / 10_000)}`;
        const objectPath = `${directory}\\${filename}`;
        insertFailure.run({
          id: `metadata-failure-${failureIndex}`,
          sourceFolderId: source.id,
          scanTaskId: `metadata:asset-video-${videoIndex}`,
          objectPath,
          normalizedPath: objectPath.toLocaleLowerCase(),
          timestamp
        });
      }
    })();
    statementCount = 0;
    const measuredRepository = new VideoRepository(measuredDatabase);
    const metadataStartedAt = performance.now();
    const metadataPage = measuredRepository.listMetadataIssuePage({ status: "all", zeroBytesOnly: false, search: "", page: 1, pageSize: 100 });
    const metadataElapsedMs = performance.now() - metadataStartedAt;
    console.info(`Metadata issues 320k/5k-failure page: ${metadataElapsedMs.toFixed(2)} ms, ${statementCount} statements`);

    expect(metadataPage).toMatchObject({ totalCount: VIDEO_COUNT, automaticCount: 240_000, deferredCount: 0, failedCount: 80_000 });
    expect(metadataPage.items).toHaveLength(100);
    expect(statementCount).toBe(2);
    expect(metadataElapsedMs).toBeLessThan(METADATA_PAGE_BUDGET_MS);
  }, 60_000);
});

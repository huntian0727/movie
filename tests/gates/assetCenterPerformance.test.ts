// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listAssetCenterSources } from "../../src/main/assetCenter/assetCenterQueries.js";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";

const VIDEO_COUNT = 320_000;
const SOURCE_COUNT = 100;
const SOURCE_PAGE_BUDGET_MS = 2_000;
const METADATA_PAGE_BUDGET_MS = 3_000;

let database: DatabaseConnection | undefined;
let tempDirectory: string | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe("Asset Center performance gate", () => {
  it("aggregates a 320,000-video, 100-source page with one SQLite statement", () => {
    tempDirectory = mkdtempSync(path.join(tmpdir(), "video-manager-asset-performance-"));
    database = createDatabase(path.join(tempDirectory, "library.sqlite"));
    const repo = new VideoRepository(database);
    const sources = Array.from({ length: SOURCE_COUNT }, (_, index) =>
      repo.addSourceFolder(`D:\\Synthetic\\source-${String(index).padStart(3, "0")}`, true)
    );
    const insert = database.prepare(`
      INSERT INTO videos (
        id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
        duration_ms, width, height, format, modified_at, imported_at, updated_at, is_favorite,
        is_pending_delete, is_missing, metadata_status, thumbnail_status, timeline_preview_status,
        cover_cache_path, content_fingerprint, fingerprint_status, fingerprint_updated_at, fingerprint_error
      ) VALUES (
        @id, @sourceFolderId, @path, @directory, @filename, @basename, '.mp4', @sizeBytes,
        @durationMs, 1920, 1080, 'mp4', @timestamp, @timestamp, @timestamp, 0,
        0, 0, 'ready', 'pending', 'pending', NULL, NULL, 'pending', NULL, NULL
      )
    `);
    const timestamp = "2026-09-04T00:00:00.000Z";
    database.transaction(() => {
      for (let index = 0; index < VIDEO_COUNT; index += 1) {
        const source = sources[index % SOURCE_COUNT]!;
        const filename = `video-${String(index).padStart(6, "0")}.mp4`;
        const directory = `${source.path}\\bucket-${Math.floor(index / 10_000)}`;
        insert.run({
          id: `asset-video-${index}`,
          sourceFolderId: source.id,
          path: `${directory}\\${filename}`,
          directory,
          filename,
          basename: filename.slice(0, -4),
          sizeBytes: 10_000 + index,
          durationMs: 1_000 + index * 1_000,
          timestamp
        });
      }
    })();

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

    database.prepare("UPDATE videos SET metadata_status = CASE WHEN rowid % 4 = 0 THEN 'failed' ELSE 'pending' END").run();
    const metadataStartedAt = performance.now();
    const metadataPage = repo.listMetadataIssuePage({ status: "all", search: "", page: 1, pageSize: 100 });
    const metadataElapsedMs = performance.now() - metadataStartedAt;
    console.info(`Metadata issues 320k page: ${metadataElapsedMs.toFixed(2)} ms`);

    expect(metadataPage).toMatchObject({ totalCount: VIDEO_COUNT, pendingCount: 240_000, failedCount: 80_000 });
    expect(metadataPage.items).toHaveLength(100);
    expect(metadataElapsedMs).toBeLessThan(METADATA_PAGE_BUDGET_MS);
  }, 60_000);
});

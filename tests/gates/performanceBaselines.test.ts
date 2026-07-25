// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";

const LIBRARY_SIZE = 10_000;
const DUPLICATE_FILE_COUNT = 2_000;
const QUERY_BUDGET_MS = 10_000;
let db: DatabaseConnection | undefined;
let tempDirectory: string | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDirectory) {
    rmSync(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  }
});

describe("release performance baselines", () => {
  it("pages a 10,000-video library without loading the entire table", () => {
    const repo = createPopulatedRepository(LIBRARY_SIZE, 0);
    const startedAt = performance.now();
    const page = repo.listVideoPage({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      page: 100,
      pageSize: 100,
      folderScope: "recursive"
    });
    const elapsedMs = performance.now() - startedAt;

    expect(page).toMatchObject({ page: 100, pageSize: 100, totalPages: 100, totalCount: LIBRARY_SIZE });
    expect(page.videos).toHaveLength(100);
    expect(elapsedMs).toBeLessThan(QUERY_BUDGET_MS);
  }, 30_000);

  it("lists a 2,000-file verified duplicate group within the release budget", () => {
    const repo = createPopulatedRepository(DUPLICATE_FILE_COUNT, DUPLICATE_FILE_COUNT);
    const startedAt = performance.now();
    const page = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" });
    const elapsedMs = performance.now() - startedAt;

    expect(page).toMatchObject({
      totalGroups: 1,
      totalCandidateGroups: 1,
      totalCandidateFiles: DUPLICATE_FILE_COUNT
    });
    expect(page.groups[0]?.items).toHaveLength(DUPLICATE_FILE_COUNT);
    expect(elapsedMs).toBeLessThan(QUERY_BUDGET_MS);
  }, 30_000);
});

function createPopulatedRepository(videoCount: number, duplicateCount: number): VideoRepository {
  tempDirectory = mkdtempSync(path.join(tmpdir(), "video-manager-performance-"));
  db = createDatabase(path.join(tempDirectory, "library.sqlite"));
  const repo = new VideoRepository(db);
  const folder = repo.addSourceFolder("D:\\Synthetic", true);
  const insert = db.prepare(`
    INSERT INTO videos (
      id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
      duration_ms, width, height, format, modified_at, imported_at, updated_at, is_favorite,
      is_pending_delete, is_missing, metadata_status, thumbnail_status, timeline_preview_status,
      cover_cache_path, content_fingerprint, fingerprint_status, fingerprint_updated_at, fingerprint_error
    ) VALUES (
      @id, @sourceFolderId, @path, @directory, @filename, @basename, '.mp4', @sizeBytes,
      1000, 320, 240, 'mp4', @timestamp, @timestamp, @timestamp, 0,
      0, 0, 'ready', 'pending', 'pending',
      NULL, @contentFingerprint, @fingerprintStatus, @fingerprintUpdatedAt, NULL
    )
  `);
  const timestamp = "2026-07-25T00:00:00.000Z";
  db.transaction(() => {
    for (let index = 0; index < videoCount; index += 1) {
      const filename = `video-${String(index).padStart(6, "0")}.mp4`;
      const isDuplicate = index < duplicateCount;
      insert.run({
        id: `video-${index}`,
        sourceFolderId: folder.id,
        path: `D:\\Synthetic\\${filename}`,
        directory: "D:\\Synthetic",
        filename,
        basename: path.parse(filename).name,
        sizeBytes: isDuplicate ? 4096 : 10_000 + index,
        contentFingerprint: isDuplicate ? "release-duplicate-group" : null,
        fingerprintStatus: isDuplicate ? "ready" : "pending",
        fingerprintUpdatedAt: isDuplicate ? timestamp : null,
        timestamp
      });
    }
  })();
  return repo;
}

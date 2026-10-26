// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";

const LIBRARY_SIZE = 10_000;
const DUPLICATE_FILE_COUNT = 2_000;
const DUPLICATE_GROUP_COUNT = 12_000;
const QUERY_BUDGET_MS = 10_000;
const LARGE_DUPLICATE_GROUP_BUDGET_MS = 1_000;
const DUPLICATE_PAGE_BUDGET_MS = 3_000;
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
    console.info(`Video page 10k/page 100: ${elapsedMs.toFixed(2)} ms`);
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
    console.info(`Duplicate group 2k files: ${elapsedMs.toFixed(2)} ms`);
  }, 30_000);

  it("lists a 10,000-file verified duplicate group within the release budget", () => {
    const duplicateFileCount = 10_000;
    const repo = createPopulatedRepository(duplicateFileCount, duplicateFileCount);
    const startedAt = performance.now();
    const page = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" });
    const elapsedMs = performance.now() - startedAt;

    expect(page).toMatchObject({
      totalGroups: 1,
      totalCandidateGroups: 1,
      totalCandidateFiles: duplicateFileCount
    });
    expect(page.groups[0]?.items).toHaveLength(duplicateFileCount);
    expect(elapsedMs).toBeLessThan(LARGE_DUPLICATE_GROUP_BUDGET_MS);
    console.info(`Duplicate group 10k files: ${elapsedMs.toFixed(2)} ms`);
  }, 60_000);

  it("builds a 10,000-file duplicate resolve plan without quadratic reservation checks", () => {
    const duplicateFileCount = 10_000;
    const repo = createPopulatedRepository(duplicateFileCount, duplicateFileCount);
    db!.prepare("UPDATE videos SET provider_file_id = 'synthetic-' || id, provider_path = path WHERE id LIKE 'video-%'").run();

    const startedAt = performance.now();
    const entries = repo.buildDuplicateResolveEntriesForQuery({ page: 1, pageSize: 20, sortDirection: "desc" });
    const elapsedMs = performance.now() - startedAt;

    expect(entries).toHaveLength(1);
    expect(entries[0]?.deleteVideos).toHaveLength(duplicateFileCount - 1);
    expect(elapsedMs).toBeLessThan(LARGE_DUPLICATE_GROUP_BUDGET_MS);
    console.info(`Duplicate resolve plan 10k files: ${elapsedMs.toFixed(2)} ms`);
  }, 60_000);

  it("keeps a 10,000-file duplicate group fast with 1,000 unrelated active reservations", () => {
    const duplicateFileCount = 10_000;
    const reservationCount = 1_000;
    const repo = createPopulatedRepository(duplicateFileCount + reservationCount, duplicateFileCount);
    const timestamp = "2026-10-26T00:00:00.000Z";
    db!.prepare(`INSERT INTO duplicate_cleanup_jobs
      (id, request_id, status, total_groups, total_items, created_at, updated_at)
      VALUES (?, ?, 'running', 1, ?, ?, ?)`).run("synthetic-reservation-job", "synthetic-reservation-request", reservationCount, timestamp, timestamp);
    const insertReservation = db!.prepare(`INSERT INTO duplicate_cleanup_reservations
      (id, job_id, video_id, role, created_at, released_at)
      VALUES (?, ?, ?, 'delete', ?, NULL)`);
    db!.transaction(() => {
      for (let index = duplicateFileCount; index < duplicateFileCount + reservationCount; index += 1) {
        insertReservation.run(`synthetic-reservation-${index}`, "synthetic-reservation-job", `video-${index}`, timestamp);
      }
    })();

    const startedAt = performance.now();
    const page = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" });
    const elapsedMs = performance.now() - startedAt;

    expect(page).toMatchObject({ totalGroups: 1, totalCandidateGroups: 1, totalCandidateFiles: duplicateFileCount });
    expect(page.groups[0]?.items).toHaveLength(duplicateFileCount);
    expect(elapsedMs).toBeLessThan(LARGE_DUPLICATE_GROUP_BUDGET_MS);
    console.info(`Duplicate group 10k files with 1k unrelated reservations: ${elapsedMs.toFixed(2)} ms`);
  }, 60_000);

  it("pages a large set of duplicate groups without rescanning every directory option", () => {
    const repo = createDuplicateGroupsRepository(DUPLICATE_GROUP_COUNT);

    const firstStartedAt = performance.now();
    const firstPage = repo.listDuplicateGroupsPage({ page: 1, pageSize: 20, sortDirection: "desc" });
    const firstElapsedMs = performance.now() - firstStartedAt;
    const secondStartedAt = performance.now();
    const secondPage = repo.listDuplicateGroupsPage({ page: 2, pageSize: 20, sortDirection: "desc" });
    const secondElapsedMs = performance.now() - secondStartedAt;

    expect(firstPage).toMatchObject({
      totalGroups: DUPLICATE_GROUP_COUNT,
      totalCandidateGroups: DUPLICATE_GROUP_COUNT,
      totalCandidateFiles: DUPLICATE_GROUP_COUNT * 2
    });
    expect(firstPage.groups).toHaveLength(20);
    expect(secondPage.groups).toHaveLength(20);
    expect(firstElapsedMs).toBeLessThan(DUPLICATE_PAGE_BUDGET_MS);
    expect(secondElapsedMs).toBeLessThan(DUPLICATE_PAGE_BUDGET_MS);
    console.info(`Duplicate groups 12k: page 1 ${firstElapsedMs.toFixed(2)} ms; page 2 ${secondElapsedMs.toFixed(2)} ms`);
  }, 45_000);
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

function createDuplicateGroupsRepository(groupCount: number): VideoRepository {
  tempDirectory = mkdtempSync(path.join(tmpdir(), "video-manager-duplicate-performance-"));
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
      @durationMs, 320, 240, 'mp4', @timestamp, @timestamp, @timestamp, 0,
      0, 0, 'ready', 'pending', 'pending',
      NULL, NULL, 'pending', NULL, NULL
    )
  `);
  const timestamp = "2026-09-04T00:00:00.000Z";
  db.transaction(() => {
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      const directory = `D:\\Synthetic\\directory-${String(groupIndex).padStart(6, "0")}`;
      for (let copyIndex = 0; copyIndex < 2; copyIndex += 1) {
        const id = `group-${groupIndex}-copy-${copyIndex}`;
        const filename = `${id}.mp4`;
        insert.run({
          id,
          sourceFolderId: folder.id,
          path: `${directory}\\${filename}`,
          directory,
          filename,
          basename: path.parse(filename).name,
          sizeBytes: 10_000 + groupIndex,
          durationMs: 1_000 + groupIndex * 1_000,
          timestamp
        });
      }
    }
  })();
  return repo;
}

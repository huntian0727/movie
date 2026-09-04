// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database.js";
import { PlaybackDiagnosticQueryService, type PlaybackDiagnosticQueryWorker } from "../../src/main/playbackDiagnostic/playbackDiagnosticQueryService.js";
import { searchPlaybackDiagnosticVideos } from "../../src/main/playbackDiagnostic/playbackDiagnosticQueries.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";

const VIDEO_COUNT = 320_000;
const QUERY_BUDGET_MS = 2_000;
const MAIN_LOOP_GAP_BUDGET_MS = 100;

let database: DatabaseConnection | undefined;
let service: PlaybackDiagnosticQueryService | undefined;
let tempDirectory: string | undefined;

afterEach(async () => {
  await service?.dispose();
  service = undefined;
  database?.close();
  database = undefined;
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe("Playback Diagnostic search performance gate", () => {
  it("keeps broad and empty 320k searches bounded and the main loop responsive", async () => {
    tempDirectory = mkdtempSync(path.join(tmpdir(), "video-manager-playback-diagnostic-performance-"));
    const databasePath = path.join(tempDirectory, "library.sqlite");
    database = createDatabase(databasePath);
    seedVideos(database);

    const broadStartedAt = performance.now();
    const broad = searchPlaybackDiagnosticVideos(database, { search: "video", page: 1, pageSize: 30 });
    const broadElapsedMs = performance.now() - broadStartedAt;
    const emptyStartedAt = performance.now();
    const empty = searchPlaybackDiagnosticVideos(database, { search: "token-that-does-not-exist", page: 1, pageSize: 30 });
    const emptyElapsedMs = performance.now() - emptyStartedAt;

    expect(broad).toMatchObject({ page: 1, pageSize: 30, totalCount: VIDEO_COUNT });
    expect(broad.videos).toHaveLength(30);
    expect(empty).toMatchObject({ page: 1, pageSize: 30, totalCount: 0 });
    expect(broadElapsedMs).toBeLessThan(QUERY_BUDGET_MS);
    expect(emptyElapsedMs).toBeLessThan(QUERY_BUDGET_MS);

    service = new PlaybackDiagnosticQueryService(databasePath, {
      workerFactory: (targetPath) => new Worker(WORKER_SCRIPT, {
        eval: true,
        workerData: { databasePath: targetPath }
      }) as unknown as PlaybackDiagnosticQueryWorker
    });
    let lastTick = performance.now();
    let maximumGapMs = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      maximumGapMs = Math.max(maximumGapMs, now - lastTick);
      lastTick = now;
    }, 10);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const workerResult = await service.search({ search: "video", page: 1, pageSize: 30 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    maximumGapMs = Math.max(maximumGapMs, performance.now() - lastTick);
    clearInterval(timer);

    console.info(`Playback Diagnostic 320k broad ${broadElapsedMs.toFixed(2)} ms, empty ${emptyElapsedMs.toFixed(2)} ms, main-loop max gap ${maximumGapMs.toFixed(2)} ms`);
    expect(workerResult.totalCount).toBe(VIDEO_COUNT);
    expect(maximumGapMs).toBeLessThan(MAIN_LOOP_GAP_BUDGET_MS);
  }, 90_000);
});

function seedVideos(target: DatabaseConnection): void {
  const repo = new VideoRepository(target);
  const source = repo.addSourceFolder("D:\\Synthetic", true);
  const insert = target.prepare(`
    INSERT INTO videos (
      id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
      duration_ms, width, height, format, modified_at, imported_at, updated_at, is_favorite,
      is_pending_delete, is_missing, metadata_status, thumbnail_status, timeline_preview_status,
      cover_cache_path, content_fingerprint, fingerprint_status, fingerprint_updated_at, fingerprint_error
    ) VALUES (
      @id, @sourceFolderId, @path, @directory, @filename, @basename, '.mp4', @sizeBytes,
      90000, 1920, 1080, 'mp4', @timestamp, @timestamp, @timestamp, 0,
      0, 0, 'ready', 'pending', 'pending', NULL, NULL, 'pending', NULL, NULL
    )
  `);
  const timestamp = "2026-09-04T00:00:00.000Z";
  target.transaction(() => {
    for (let index = 0; index < VIDEO_COUNT; index += 1) {
      const filename = `video-${String(index).padStart(6, "0")}.mp4`;
      const directory = `D:\\Synthetic\\bucket-${Math.floor(index / 10_000)}`;
      insert.run({
        id: `diagnostic-video-${index}`,
        sourceFolderId: source.id,
        path: `${directory}\\${filename}`,
        directory,
        filename,
        basename: filename.slice(0, -4),
        sizeBytes: index + 1,
        timestamp
      });
    }
  })();
}

const WORKER_SCRIPT = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const Database = require("better-sqlite3");
  const database = new Database(workerData.databasePath, { readonly: true, fileMustExist: true });
  database.pragma("query_only = ON");
  parentPort.on("message", (request) => {
    const escaped = request.query.search.trim().replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
    const params = { search: "%" + escaped + "%" };
    const where = "WHERE is_missing = 0 AND (filename LIKE @search ESCAPE '!' COLLATE NOCASE OR path LIKE @search ESCAPE '!' COLLATE NOCASE)";
    const totalCount = database.prepare("SELECT COUNT(*) AS count FROM videos " + where).get(params).count;
    database.prepare("SELECT id FROM videos " + where + " ORDER BY filename COLLATE NOCASE ASC, path COLLATE NOCASE ASC, id ASC LIMIT 30").all(params);
    const busyUntil = Date.now() + 250;
    while (Date.now() < busyUntil) {}
    parentPort.postMessage({ id: request.id, ok: true, result: { videos: [], page: 1, pageSize: 30, totalPages: Math.max(1, Math.ceil(totalCount / 30)), totalCount } });
  });
`;

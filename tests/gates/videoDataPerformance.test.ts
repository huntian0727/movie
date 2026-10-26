// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";
import { queryVideoData } from "../../src/main/videoData/videoDataQueries.js";
import { videoDataQuerySchema } from "../../src/shared/videoDataTable.js";
const VIDEO_COUNT = Number(process.env.MOVIE_PERF_VIDEO_COUNT ?? 320_000);
const VIDEO_PAGE_SIZE = 100;
const VIDEO_PAGE = Number(process.env.MOVIE_PERF_PAGE ?? 1000);
if (!Number.isSafeInteger(VIDEO_COUNT) || VIDEO_COUNT < 10_000 || VIDEO_COUNT > 500_000) {
  throw new Error("MOVIE_PERF_VIDEO_COUNT must be an integer between 10000 and 500000");
}
if (!Number.isSafeInteger(VIDEO_PAGE) || VIDEO_PAGE < 1 || VIDEO_PAGE > Math.ceil((VIDEO_COUNT - 1) / VIDEO_PAGE_SIZE)) {
  throw new Error("MOVIE_PERF_PAGE is outside the generated dataset");
}
it("queries " + VIDEO_COUNT + " records at page " + VIDEO_PAGE + " using the actual built worker with bounded payload and responsive event loop", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "video-data-perf-"));
  const databasePath = path.join(temp, "library.sqlite"), db = createDatabase(databasePath);
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const repo = new VideoRepository(db), source = repo.addSourceFolder("F:\\Synthetic", true);
    repo.upsertVideo({ sourceFolderId: source.id, path: "F:\\Synthetic\\seed.mp4", directory: "F:\\Synthetic", filename: "seed.mp4", basename: "seed", extension: ".mp4", sizeBytes: 100, durationMs: 5000, width: null, height: null, format: "mp4", modifiedAt: "2026-09-08T00:00:00.000Z" });
    const columns = (db.prepare("PRAGMA table_info(videos)").all() as { name: string }[]).map(row => row.name);
    const select = columns.map(column => column === "id" ? "'perf-' || n" : column === "path" ? "'F:\\Synthetic\\video-' || n || '.mp4'" : column === "filename" ? "'video-' || n || '.mp4'" : column === "size_bytes" && process.env.MOVIE_PERF_SIZE_VARIATION === "1" ? "1000 + (n % 100000)" : column === "duration_ms" && process.env.MOVIE_PERF_METADATA_VARIATION === "1" ? "1000 + (n % 3600000)" : column === "imported_at" && process.env.MOVIE_PERF_METADATA_VARIATION === "1" ? "datetime('2020-01-01', '+' || (n % 3650) || ' days')" : column === "modified_at" && process.env.MOVIE_PERF_METADATA_VARIATION === "1" ? "datetime('2020-01-01', '+' || (n % 3650) || ' days')" : "seed." + column).join(",");
    db.exec(`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<${VIDEO_COUNT - 1}) INSERT INTO videos (${columns.join(",")}) SELECT ${select} FROM numbers CROSS JOIN (SELECT * FROM videos LIMIT 1) seed`);
    if (process.env.MOVIE_PERF_COMPOSITE_INDEX === "1") {
      db.exec("DROP INDEX IF EXISTS idx_videos_size_bytes; CREATE INDEX idx_videos_size_bytes ON videos(size_bytes); DROP INDEX IF EXISTS idx_videos_duration_ms_id;");
    }
    if (process.env.MOVIE_PERF_FILENAME_INDEX === "1") {
      db.exec("DROP INDEX IF EXISTS idx_videos_filename_nocase_id");
    }
    if (process.env.MOVIE_PERF_DATE_INDEXES === "1") {
      const pageSize = (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size;
      const pagesBefore = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
      const indexStarted = performance.now();
      db.exec("CREATE INDEX idx_perf_video_imported_at_id ON videos(imported_at DESC, id ASC); CREATE INDEX idx_perf_video_modified_at_id ON videos(modified_at DESC, id ASC)");
      db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      const indexBuildMs = performance.now() - indexStarted;
      const pagesAfter = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
      console.info("Isolated date-index experiment: build=" + indexBuildMs.toFixed(2) + " ms; addedPages=" + (pagesAfter - pagesBefore) + "; estimatedBytes=" + ((pagesAfter - pagesBefore) * pageSize));
    }
    if (process.env.MOVIE_PERF_COMPOSITE_INDEX !== "1" && process.env.MOVIE_PERF_FILENAME_INDEX !== "1") {
      const sortPlanCases = [
        { sort: "sizeBytes", expression: "v.size_bytes", index: "idx_videos_size_bytes" },
        { sort: "durationMs", expression: "v.duration_ms", index: "idx_videos_duration_ms_id" },
        { sort: "filename", expression: "v.filename COLLATE NOCASE", index: "idx_videos_filename_nocase_id" }
      ] as const;
      for (const sortCase of sortPlanCases) {
        for (const direction of ["desc", "asc"] as const) {
          const plan = db.prepare("EXPLAIN QUERY PLAN SELECT v.id FROM videos v LEFT JOIN source_folders s ON s.id=v.source_folder_id WHERE (v.filename LIKE @search ESCAPE '!' OR v.path LIKE @search ESCAPE '!') ORDER BY " + sortCase.expression + " " + direction.toUpperCase() + ", v.id ASC LIMIT @limit OFFSET @offset").all({ search: "%video%", limit: VIDEO_PAGE_SIZE, offset: (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE });
          const planText = (plan as Array<{ detail: string }>).map((step) => step.detail).join(" ");
          expect(planText).toContain(sortCase.index);
          if (direction === "desc") {
            expect(planText).not.toContain("TEMP B-TREE FOR ORDER BY");
          } else {
            expect(planText).toContain("TEMP B-TREE FOR LAST TERM OF ORDER BY");
            expect(planText).not.toContain("TEMP B-TREE FOR ORDER BY");
          }
        }
      }
    }
    if (process.env.MOVIE_PERF_SORT_SWEEP === "1") {
      const sortExpressions = { filename: "v.filename COLLATE NOCASE", sizeBytes: "v.size_bytes", durationMs: "v.duration_ms", importedAt: "v.imported_at", modifiedAt: "v.modified_at" } as const;
      for (const sort of Object.keys(sortExpressions) as Array<keyof typeof sortExpressions>) {
        for (const direction of ["desc", "asc"] as const) {
          const queryStarted = performance.now();
          const page = queryVideoData(db, videoDataQuerySchema.parse({ page: VIDEO_PAGE, pageSize: VIDEO_PAGE_SIZE, search: "video", sort, direction }));
          const queryElapsed = performance.now() - queryStarted;
          const plan = db.prepare("EXPLAIN QUERY PLAN SELECT v.id FROM videos v LEFT JOIN source_folders s ON s.id=v.source_folder_id WHERE (v.filename LIKE @search ESCAPE '!' OR v.path LIKE @search ESCAPE '!') ORDER BY " + sortExpressions[sort] + " " + direction.toUpperCase() + ", v.id ASC LIMIT @limit OFFSET @offset").all({ search: "%video%", limit: VIDEO_PAGE_SIZE, offset: (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE });
          console.info("Video data sort " + sort + " " + direction + ": " + queryElapsed.toFixed(2) + " ms; count=" + page.totalCount + "; plan=" + JSON.stringify(plan));
        }
      }
    }
    if (process.env.MOVIE_PERF_FILENAME_INDEX === "1") {
      const writeCount = 10_000;
      const writeStart = performance.now();
      const writeBaseline = db.prepare("UPDATE videos SET filename = CASE WHEN substr(filename, -6) = '-bench' THEN substr(filename, 1, length(filename) - 6) ELSE filename || '-bench' END WHERE id IN (SELECT id FROM videos WHERE id LIKE 'perf-%' ORDER BY id LIMIT @limit)").run({ limit: writeCount });
      const writeBaselineMs = performance.now() - writeStart;
      expect(writeBaseline.changes).toBe(writeCount);
      const scenarios = [{ name: "search=video", search: "video" }, { name: "search=empty", search: "" }] as const;
      const measureFilenameSort = (phase: string) => {
        for (const scenario of scenarios) {
          for (const direction of ["desc", "asc"] as const) {
            const started = performance.now();
            const page = queryVideoData(db, videoDataQuerySchema.parse({ page: VIDEO_PAGE, pageSize: VIDEO_PAGE_SIZE, search: scenario.search, sort: "filename", direction }));
            const elapsed = performance.now() - started;
            const where = scenario.search ? "WHERE (v.filename LIKE @search ESCAPE '!' OR v.path LIKE @search ESCAPE '!') " : "";
            const params = scenario.search ? { search: "%video%", limit: VIDEO_PAGE_SIZE, offset: (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE } : { limit: VIDEO_PAGE_SIZE, offset: (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE };
            const plan = db.prepare("EXPLAIN QUERY PLAN SELECT v.id FROM videos v LEFT JOIN source_folders s ON s.id=v.source_folder_id " + where + "ORDER BY v.filename COLLATE NOCASE " + direction.toUpperCase() + ", v.id ASC LIMIT @limit OFFSET @offset").all(params);
            console.info("Filename-index " + phase + " " + scenario.name + " " + direction + ": " + elapsed.toFixed(2) + " ms; count=" + page.totalCount + "; plan=" + JSON.stringify(plan));
          }
        }
      };
      measureFilenameSort("before");
      const indexStarted = performance.now();
      db.exec("CREATE INDEX idx_perf_video_filename_nocase_id ON videos(filename COLLATE NOCASE DESC, id ASC)");
      db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      const indexBuildMs = performance.now() - indexStarted;
      const indexBytes = (db.prepare("SELECT COALESCE(SUM(pgsize),0) AS bytes FROM dbstat WHERE name = 'idx_perf_video_filename_nocase_id'").get() as { bytes: number }).bytes;
      console.info("Filename-index build=" + indexBuildMs.toFixed(2) + " ms; indexBytes=" + indexBytes + "; baseline 10k filename writes=" + writeBaselineMs.toFixed(2) + " ms");
      measureFilenameSort("after");
      const writeIndexedStart = performance.now();
      const writeIndexed = db.prepare("UPDATE videos SET filename = CASE WHEN substr(filename, -6) = '-bench' THEN substr(filename, 1, length(filename) - 6) ELSE filename || '-bench' END WHERE id IN (SELECT id FROM videos WHERE id LIKE 'perf-%' ORDER BY id LIMIT @limit)").run({ limit: writeCount });
      const writeIndexedMs = performance.now() - writeIndexedStart;
      expect(writeIndexed.changes).toBe(writeCount);
      console.info("Filename-index 10k filename writes after index=" + writeIndexedMs.toFixed(2) + " ms; baseline=" + writeBaselineMs.toFixed(2) + " ms");
    }
    if (process.env.MOVIE_PERF_COMPOSITE_INDEX === "1") {
      const writeCount = 10_000;
      const sizeWriteStart = performance.now();
      const sizeWriteBaseline = db.prepare("UPDATE videos SET size_bytes = size_bytes + 1 WHERE id IN (SELECT id FROM videos WHERE id LIKE 'perf-%' ORDER BY id LIMIT @limit)").run({ limit: writeCount });
      const sizeWriteBaselineMs = performance.now() - sizeWriteStart;
      const durationWriteStart = performance.now();
      const durationWriteBaseline = db.prepare("UPDATE videos SET duration_ms = duration_ms + 1 WHERE id IN (SELECT id FROM videos WHERE id LIKE 'perf-%' ORDER BY id LIMIT @limit)").run({ limit: writeCount });
      const durationWriteBaselineMs = performance.now() - durationWriteStart;
      expect(sizeWriteBaseline.changes).toBe(writeCount);
      expect(durationWriteBaseline.changes).toBe(writeCount);
      console.info("Baseline 10k writes before composite indexes: sizeBytes=" + sizeWriteBaselineMs.toFixed(2) + " ms; durationMs=" + durationWriteBaselineMs.toFixed(2) + " ms");

      const pagesBefore = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
      const replacedSizeIndexBytes = (db.prepare("SELECT COALESCE(SUM(pgsize),0) AS bytes FROM dbstat WHERE name = 'idx_videos_size_bytes'").get() as { bytes: number }).bytes;
      const indexStarted = performance.now();
      db.exec("DROP INDEX IF EXISTS idx_videos_size_bytes; CREATE INDEX idx_perf_video_size_id ON videos(size_bytes DESC, id ASC)");
      db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      const indexBuildMs = performance.now() - indexStarted;
      const pagesAfter = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
      const sizeIndexBytes = (db.prepare("SELECT COALESCE(SUM(pgsize),0) AS bytes FROM dbstat WHERE name = 'idx_perf_video_size_id'").get() as { bytes: number }).bytes;
      console.info("Isolated composite size index: build=" + indexBuildMs.toFixed(2) + " ms; indexBytes=" + sizeIndexBytes + "; replacedIndexBytes=" + replacedSizeIndexBytes + "; netIndexBytes=" + (sizeIndexBytes - replacedSizeIndexBytes) + "; pageCountDelta=" + (pagesAfter - pagesBefore));
      const indexedStarted = performance.now();
      const indexedPage = queryVideoData(db, videoDataQuerySchema.parse({ page: VIDEO_PAGE, pageSize: VIDEO_PAGE_SIZE, search: "video", sort: "sizeBytes", direction: "desc" }));
      const indexedElapsed = performance.now() - indexedStarted;
      const indexedPlan = db.prepare("EXPLAIN QUERY PLAN SELECT v.id FROM videos v LEFT JOIN source_folders s ON s.id=v.source_folder_id WHERE (v.filename LIKE @search ESCAPE '!' OR v.path LIKE @search ESCAPE '!') ORDER BY v.size_bytes DESC, v.id ASC LIMIT @limit OFFSET @offset").all({ search: "%video%", limit: VIDEO_PAGE_SIZE, offset: (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE });
      expect(indexedPage.totalCount).toBe(VIDEO_COUNT - 1);
      expect(indexedPage.items).toHaveLength(Math.min(VIDEO_PAGE_SIZE, (VIDEO_COUNT - 1) - (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE));
      console.info("Composite-index sizeBytes sort after index: " + indexedElapsed.toFixed(2) + " ms; count=" + indexedPage.totalCount + "; plan=" + JSON.stringify(indexedPlan));
      const sizeWriteIndexedStart = performance.now();
      const sizeWriteIndexed = db.prepare("UPDATE videos SET size_bytes = size_bytes + 1 WHERE id IN (SELECT id FROM videos WHERE id LIKE 'perf-%' ORDER BY id LIMIT @limit)").run({ limit: writeCount });
      const sizeWriteIndexedMs = performance.now() - sizeWriteIndexedStart;
      expect(sizeWriteIndexed.changes).toBe(writeCount);
      console.info("Composite-index sizeBytes 10k writes: " + sizeWriteIndexedMs.toFixed(2) + " ms; baseline=" + sizeWriteBaselineMs.toFixed(2) + " ms");
      const durationPagesBefore = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
      const durationIndexStarted = performance.now();
      db.exec("CREATE INDEX idx_perf_video_duration_id ON videos(duration_ms DESC, id ASC)");
      db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      const durationIndexBuildMs = performance.now() - durationIndexStarted;
      const durationPagesAfter = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
      const durationIndexBytes = (db.prepare("SELECT COALESCE(SUM(pgsize),0) AS bytes FROM dbstat WHERE name = 'idx_perf_video_duration_id'").get() as { bytes: number }).bytes;
      console.info("Isolated duration composite index: build=" + durationIndexBuildMs.toFixed(2) + " ms; indexBytes=" + durationIndexBytes + "; pageCountDelta=" + (durationPagesAfter - durationPagesBefore));
      const durationStarted = performance.now();
      const durationPage = queryVideoData(db, videoDataQuerySchema.parse({ page: VIDEO_PAGE, pageSize: VIDEO_PAGE_SIZE, search: "video", sort: "durationMs", direction: "desc" }));
      const durationElapsed = performance.now() - durationStarted;
      const durationPlan = db.prepare("EXPLAIN QUERY PLAN SELECT v.id FROM videos v LEFT JOIN source_folders s ON s.id=v.source_folder_id WHERE (v.filename LIKE @search ESCAPE '!' OR v.path LIKE @search ESCAPE '!') ORDER BY v.duration_ms DESC, v.id ASC LIMIT @limit OFFSET @offset").all({ search: "%video%", limit: VIDEO_PAGE_SIZE, offset: (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE });
      expect(durationPage.totalCount).toBe(VIDEO_COUNT - 1);
      expect(durationPage.items).toHaveLength(Math.min(VIDEO_PAGE_SIZE, (VIDEO_COUNT - 1) - (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE));
      console.info("Composite-index durationMs sort after index: " + durationElapsed.toFixed(2) + " ms; count=" + durationPage.totalCount + "; plan=" + JSON.stringify(durationPlan));
      const durationWriteIndexedStart = performance.now();
      const durationWriteIndexed = db.prepare("UPDATE videos SET duration_ms = duration_ms + 1 WHERE id IN (SELECT id FROM videos WHERE id LIKE 'perf-%' ORDER BY id LIMIT @limit)").run({ limit: writeCount });
      const durationWriteIndexedMs = performance.now() - durationWriteIndexedStart;
      expect(durationWriteIndexed.changes).toBe(writeCount);
      console.info("Composite-index durationMs 10k writes: " + durationWriteIndexedMs.toFixed(2) + " ms; baseline=" + durationWriteBaselineMs.toFixed(2) + " ms");
    }
    if (process.env.MOVIE_PERF_EXPLAIN === "1") {
      const search = "%video%";
      const countPlan = db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) AS count, COALESCE(SUM(v.size_bytes),0) AS bytes FROM videos v LEFT JOIN source_folders s ON s.id=v.source_folder_id WHERE (v.filename LIKE @search ESCAPE '!' OR v.path LIKE @search ESCAPE '!')").all({ search });
      const pagePlan = db.prepare("EXPLAIN QUERY PLAN SELECT v.id FROM videos v LEFT JOIN source_folders s ON s.id=v.source_folder_id WHERE (v.filename LIKE @search ESCAPE '!' OR v.path LIKE @search ESCAPE '!') ORDER BY v.size_bytes DESC, v.id ASC LIMIT @limit OFFSET @offset").all({ search, limit: VIDEO_PAGE_SIZE, offset: (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE });
      console.info("Video data " + VIDEO_COUNT + " count plan: " + JSON.stringify(countPlan));
      console.info("Video data " + VIDEO_COUNT + " page " + VIDEO_PAGE + " plan: " + JSON.stringify(pagePlan));
    }
    worker = new Worker(path.resolve("dist-main/main/videoData/videoDataWorker.js"), { workerData: { databasePath } });
    let previous = performance.now(), maxGap = 0;
    timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - previous); previous = now; }, 10);
    const start = performance.now();
    const result = await new Promise<any>((resolve, reject) => {
      worker!.once("message", resolve); worker!.once("error", reject);
      worker!.postMessage({ id: 1, query: videoDataQuerySchema.parse({ page: VIDEO_PAGE, pageSize: VIDEO_PAGE_SIZE, search: "video", sort: "sizeBytes" }) });
    });
    const elapsed = performance.now() - start;
    expect(result.error).toBeUndefined(); expect(result.result.totalCount).toBe(VIDEO_COUNT - 1); expect(result.result.items).toHaveLength(Math.min(VIDEO_PAGE_SIZE, (VIDEO_COUNT - 1) - (VIDEO_PAGE - 1) * VIDEO_PAGE_SIZE));
    expect(elapsed).toBeLessThan(5000); expect(maxGap).toBeLessThan(150);
    console.info(`Video data ${VIDEO_COUNT} worker page: ${elapsed.toFixed(2)} ms; main-loop gap: ${maxGap.toFixed(2)} ms`);
    maxGap = 0; previous = performance.now();
    const selectionStart = performance.now();
    const selected = await new Promise<any>((resolve, reject) => {
      worker!.once("message", resolve); worker!.once("error", reject);
      worker!.postMessage({ id: 2, query: videoDataQuerySchema.parse({ search: "video", sort: "sizeBytes" }), selection: { all: true, ids: [], excludedIds: ["perf-1"] }, selectIds: true });
    });
    const selectionElapsed = performance.now() - selectionStart;
    expect(selected.error).toBeUndefined(); expect(selected.result.ids).toHaveLength(VIDEO_COUNT - 2); expect(selected.result.ids).not.toContain("perf-1");
    expect(selectionElapsed).toBeLessThan(5000); expect(maxGap).toBeLessThan(150);
    console.info(`Video data ${VIDEO_COUNT} delete selection: ${selectionElapsed.toFixed(2)} ms; main-loop gap: ${maxGap.toFixed(2)} ms`);
  } finally { if (timer) clearInterval(timer); await worker?.terminate(); db.close(); rmSync(temp, { recursive: true, force: true }); }
}, 90000);

// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";
import { videoDataQuerySchema } from "../../src/shared/videoDataTable.js";
it("queries 320k records using the actual built worker with bounded payload and responsive event loop", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "video-data-perf-"));
  const databasePath = path.join(temp, "library.sqlite"), db = createDatabase(databasePath);
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const repo = new VideoRepository(db), source = repo.addSourceFolder("F:\\Synthetic", true);
    repo.upsertVideo({ sourceFolderId: source.id, path: "F:\\Synthetic\\seed.mp4", directory: "F:\\Synthetic", filename: "seed.mp4", basename: "seed", extension: ".mp4", sizeBytes: 100, durationMs: 5000, width: null, height: null, format: "mp4", modifiedAt: "2026-09-08T00:00:00.000Z" });
    const columns = (db.prepare("PRAGMA table_info(videos)").all() as { name: string }[]).map(row => row.name);
    const select = columns.map(column => column === "id" ? "'perf-' || n" : column === "path" ? "'F:\\Synthetic\\video-' || n || '.mp4'" : column === "filename" ? "'video-' || n || '.mp4'" : `seed.${column}`).join(",");
    db.exec(`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<319999) INSERT INTO videos (${columns.join(",")}) SELECT ${select} FROM numbers CROSS JOIN (SELECT * FROM videos LIMIT 1) seed`);
    worker = new Worker(path.resolve("dist-main/main/videoData/videoDataWorker.js"), { workerData: { databasePath } });
    let previous = performance.now(), maxGap = 0;
    timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - previous); previous = now; }, 10);
    const start = performance.now();
    const result = await new Promise<any>((resolve, reject) => {
      worker!.once("message", resolve); worker!.once("error", reject);
      worker!.postMessage({ id: 1, query: videoDataQuerySchema.parse({ page: 1000, search: "video", sort: "sizeBytes" }) });
    });
    const elapsed = performance.now() - start;
    expect(result.error).toBeUndefined(); expect(result.result.totalCount).toBe(319999); expect(result.result.items).toHaveLength(100);
    expect(elapsed).toBeLessThan(5000); expect(maxGap).toBeLessThan(150);
    console.info(`Video data 320k worker page: ${elapsed.toFixed(2)} ms; main-loop gap: ${maxGap.toFixed(2)} ms`);
  } finally { if (timer) clearInterval(timer); await worker?.terminate(); db.close(); rmSync(temp, { recursive: true, force: true }); }
}, 90000);

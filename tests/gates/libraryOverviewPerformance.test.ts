// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
const VIDEO_COUNT = Number(process.env.MOVIE_PERF_VIDEO_COUNT ?? 320_000);
if (!Number.isSafeInteger(VIDEO_COUNT) || VIDEO_COUNT < 10_000 || VIDEO_COUNT > 500_000) throw new Error("MOVIE_PERF_VIDEO_COUNT must be an integer between 10000 and 500000");
import { createDatabase } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";

it("keeps the event loop responsive while loading a " + VIDEO_COUNT + " library overview", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "library-overview-perf-"));
  const databasePath = path.join(temp, "library.sqlite");
  const database = createDatabase(databasePath);
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const repository = new VideoRepository(database);
    const source = repository.addSourceFolder("F:\\Synthetic", true);
    repository.upsertVideo({
      sourceFolderId: source.id,
      path: "F:\\Synthetic\\directory-0\\seed.mp4",
      directory: "F:\\Synthetic\\directory-0",
      filename: "seed.mp4",
      basename: "seed",
      extension: ".mp4",
      sizeBytes: 100,
      durationMs: 5_000,
      width: null,
      height: null,
      format: "mp4",
      modifiedAt: "2026-09-08T00:00:00.000Z"
    });
    const columns = (database.prepare("PRAGMA table_info(videos)").all() as { name: string }[]).map((row) => row.name);
    const select = columns.map((column) => {
      if (column === "id") return "'overview-' || n";
      if (column === "path") return "'F:\\Synthetic\\directory-' || (n % 25000) || '\\video-' || n || '.mp4'";
      if (column === "directory") return "'F:\\Synthetic\\directory-' || (n % 25000)";
      if (column === "filename") return "'video-' || n || '.mp4'";
      return `seed.${column}`;
    }).join(",");
    database.exec(`WITH RECURSIVE numbers(n) AS (
      VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < ${VIDEO_COUNT - 1}
    ) INSERT INTO videos (${columns.join(",")})
      SELECT ${select} FROM numbers CROSS JOIN (SELECT * FROM videos LIMIT 1) seed`);

    worker = new Worker(path.resolve("dist-main/main/assetCenter/assetCenterWorker.js"), {
      workerData: { databasePath }
    });
    let previous = performance.now();
    let maxGap = 0;
    timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - previous);
      previous = now;
    }, 10);
    const responses = new Map<number, any>();
    const completed = new Promise<void>((resolve, reject) => {
      worker!.on("error", reject);
      worker!.on("message", (response) => {
        responses.set(response.id, response);
        if (responses.size === 2) resolve();
      });
    });
    const startedAt = performance.now();
    worker.postMessage({ id: 1, operation: "folders" });
    worker.postMessage({ id: 2, operation: "navigation" });
    await completed;
    const elapsed = performance.now() - startedAt;
    const folderResponse = responses.get(1);
    const navigationResponse = responses.get(2);
    expect(folderResponse?.ok).toBe(true);
    expect(folderResponse?.result[0]?.videoCount).toBe(VIDEO_COUNT);
    expect(navigationResponse?.ok).toBe(true);
    expect(navigationResponse?.result.totalVideos).toBe(VIDEO_COUNT);
    expect(navigationResponse?.result).not.toHaveProperty("directoryPaths");
    const navigationPayloadBytes = Buffer.byteLength(JSON.stringify(navigationResponse?.result ?? {}));
    expect(navigationPayloadBytes).toBeLessThan(2_000);
    expect(elapsed).toBeLessThan(5_000);
    expect(maxGap).toBeLessThan(150);

    repository.upsertVideo({
      sourceFolderId: source.id,
      path: "F:\\Synthetic\\new-directory\\new.mp4",
      directory: "F:\\Synthetic\\new-directory",
      filename: "new.mp4",
      basename: "new",
      extension: ".mp4",
      sizeBytes: 101,
      durationMs: 6_000,
      width: null,
      height: null,
      format: "mp4",
      modifiedAt: "2026-09-08T00:01:00.000Z"
    });
    const refreshedNavigation = await new Promise<any>((resolve, reject) => {
      const onMessage = (response: any) => {
        if (response.id !== 3) return;
        worker!.off("message", onMessage);
        resolve(response);
      };
      worker!.on("message", onMessage);
      worker!.once("error", reject);
      worker!.postMessage({ id: 3, operation: "navigation" });
    });
    expect(refreshedNavigation.ok).toBe(true);
    expect(refreshedNavigation.result.totalVideos).toBe(VIDEO_COUNT + 1);
    expect(refreshedNavigation.result).not.toHaveProperty("directoryPaths");
    expect(Buffer.byteLength(JSON.stringify(refreshedNavigation.result))).toBeLessThan(2_000);
    console.info("Library overview " + VIDEO_COUNT + " worker: " + elapsed.toFixed(2) + " ms; main-loop gap: " + maxGap.toFixed(2) + " ms; navigation payload: " + navigationPayloadBytes + " bytes");
  } finally {
    if (timer) clearInterval(timer);
    await worker?.terminate();
    database.close();
    rmSync(temp, { recursive: true, force: true });
  }
}, 90_000);

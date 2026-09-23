// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";

function ask<T>(worker: Worker, id: number, payload: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: { id: number; result?: T; error?: string }) => {
      if (response.id !== id) return;
      worker.off("message", onMessage);
      worker.off("error", onError);
      if (response.error) reject(new Error(response.error));
      else resolve(response.result as T);
    };
    const onError = (error: Error) => {
      worker.off("message", onMessage);
      reject(error);
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.postMessage({ id, ...payload });
  });
}

it("keeps browsing and large source removal off the main event loop", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "ui-performance-workers-"));
  const databasePath = path.join(temp, "library.sqlite");
  const database = createDatabase(databasePath);
  let pageWorker: Worker | undefined;
  let removalWorker: Worker | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const repository = new VideoRepository(database);
    const source = repository.addSourceFolder("D:\\Bulk", true);
    repository.upsertVideo({
      sourceFolderId: source.id,
      path: "D:\\Bulk\\seed.mp4",
      directory: "D:\\Bulk",
      filename: "seed.mp4",
      basename: "seed",
      extension: ".mp4",
      sizeBytes: 100,
      durationMs: 1000,
      width: null,
      height: null,
      format: "mp4",
      modifiedAt: "2026-09-23T00:00:00.000Z"
    });
    const columns = (database.prepare("PRAGMA table_info(videos)").all() as { name: string }[]).map((row) => row.name);
    const values = columns.map((column) => {
      if (column === "id") return "'bulk-' || n";
      if (column === "path") return "'D:\\Bulk\\clip-' || n || '.mp4'";
      if (column === "filename") return "'clip-' || n || '.mp4'";
      if (column === "basename") return "'clip-' || n";
      return `seed.${column}`;
    }).join(",");
    database.exec(`WITH RECURSIVE numbers(n) AS (
      VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 9999
    ) INSERT INTO videos (${columns.join(",")})
      SELECT ${values} FROM numbers CROSS JOIN (SELECT * FROM videos LIMIT 1) seed`);

    pageWorker = new Worker(path.resolve("dist-main/main/libraryPage/libraryPageWorker.js"), { workerData: { databasePath } });
    removalWorker = new Worker(path.resolve("dist-main/main/sourceFolderRemoval/sourceFolderRemovalWorker.js"), { workerData: { databasePath } });
    let previous = performance.now();
    let maxGap = 0;
    timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - previous);
      previous = now;
    }, 10);

    const page = await ask<{ totalCount: number; videos: unknown[] }>(pageWorker, 1, {
      query: { view: "all", search: "", sortField: "filename", sortDirection: "asc", page: 1, pageSize: 100 }
    });
    expect(page.totalCount).toBe(10_000);
    expect(page.videos).toHaveLength(100);

    const preview = await ask<{ removedVideoCount: number }>(removalWorker, 1, {
      operation: "preview", folderId: source.id
    });
    expect(preview.removedVideoCount).toBe(10_000);
    const removed = await ask<{ removedVideoCount: number }>(removalWorker, 2, {
      operation: "remove", folderId: source.id
    });
    expect(removed.removedVideoCount).toBe(10_000);
    expect(database.prepare("SELECT COUNT(*) AS count FROM videos").get()).toEqual({ count: 0 });
    expect(maxGap).toBeLessThan(150);
  } finally {
    if (timer) clearInterval(timer);
    await Promise.all([pageWorker?.terminate(), removalWorker?.terminate()]);
    database.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

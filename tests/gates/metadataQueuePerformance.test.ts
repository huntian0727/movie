// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";

const VIDEO_COUNT = 320_000;

it("keeps pending metadata candidate discovery off the main event loop for a 320k remote library", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "metadata-pending-worker-"));
  const databasePath = path.join(temp, "library.sqlite");
  const db = createDatabase(databasePath);
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const repo = new VideoRepository(db);
    const source = repo.addSourceFolder("F:\\Synthetic", true);
    repo.upsertVideo({
      sourceFolderId: source.id,
      path: "F:\\Synthetic\\seed.mp4",
      directory: "F:\\Synthetic",
      filename: "seed.mp4",
      basename: "seed",
      extension: ".mp4",
      sizeBytes: 100,
      durationMs: 5000,
      width: 320,
      height: 240,
      format: "mp4",
      modifiedAt: "2026-01-01T00:00:00.000Z"
    });
    db.prepare("UPDATE videos SET provider_file_id = ?, provider_path = ? WHERE path = ?")
      .run("cloud-seed", "F:\\Synthetic\\seed.mp4", "F:\\Synthetic\\seed.mp4");
    const columns = (db.prepare("PRAGMA table_info(videos)").all() as { name: string }[]).map(row => row.name);
    const select = columns.map(column => {
      const overrides: Record<string, string> = {
        id: "'remote-' || n",
        path: "'F:\\\\Synthetic\\\\remote-' || n || '.mp4'",
        directory: "'F:\\\\Synthetic'",
        filename: "'remote-' || n || '.mp4'",
        basename: "'remote-' || n",
        extension: "'.mp4'",
        size_bytes: "100000000 + (n % 1000)",
        metadata_status: "'pending'",
        is_missing: "0",
        provider_file_id: "'cloud-' || n",
        provider_path: "'F:\\\\Synthetic\\\\remote-' || n || '.mp4'",
        imported_at: "datetime('2020-01-01', '+' || (n % 3650) || ' days')",
        modified_at: "datetime('2020-01-01', '+' || (n % 3650) || ' days')",
        updated_at: "datetime('2026-01-01', '+' || (n % 1000) || ' seconds')"
      };
      return overrides[column] ?? "seed." + column;
    }).join(",");
    db.exec(
      "WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<" + (VIDEO_COUNT - 1) + ") " +
      "INSERT INTO videos (" + columns.join(",") + ") SELECT " + select + " FROM numbers CROSS JOIN (SELECT * FROM videos LIMIT 1) seed"
    );

    worker = new Worker(path.resolve("dist-main/main/assetCenter/assetCenterWorker.js"), { workerData: { databasePath } });
    let previous = performance.now();
    let maxGap = 0;
    timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - previous);
      previous = now;
    }, 10);
    await new Promise(resolve => setTimeout(resolve, 30));
    const started = performance.now();
    const response = await new Promise<any>((resolve, reject) => {
      worker!.once("message", resolve);
      worker!.once("error", reject);
      worker!.postMessage({ id: 1, operation: "pendingMetadata", limit: 1000 });
    });
    const elapsed = performance.now() - started;
    await new Promise(resolve => setTimeout(resolve, 30));

    expect(response.error).toBeUndefined();
    expect(response.ok).toBe(true);
    expect(response.result).toHaveLength(1000);
    expect(elapsed).toBeLessThan(5000);
    expect(maxGap).toBeLessThan(150);
    console.info("Metadata candidate batch worker 320k: " + elapsed.toFixed(2) + " ms; main-loop gap: " + maxGap.toFixed(2) + " ms; result rows: " + response.result.length);
  } finally {
    if (timer) clearInterval(timer);
    await worker?.terminate();
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
}, 90_000);

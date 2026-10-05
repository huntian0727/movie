import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { createDatabase } from "../dist-main/main/db/database.js";
import { VideoRepository } from "../dist-main/main/db/videoRepository.js";
import { DuplicateCleanupRepository } from "../dist-main/main/db/duplicateCleanupRepository.js";
import { AssetCenterQueryService } from "../dist-main/main/assetCenter/assetCenterQueryService.js";
import { LibraryPageQueryService } from "../dist-main/main/libraryPage/libraryPageQueryService.js";
import { queryRevisionTriggerNames } from "../dist-main/main/db/queryRevisions.js";

const temporary = await mkdtemp(path.join(os.tmpdir(), "lamian-background-workers-"));
const databasePath = path.join(temporary, "synthetic.sqlite");
const stagePath = path.join(temporary, "plan.sqlite");
const database = createDatabase(databasePath);
const repo = new VideoRepository(database);
const jobs = new DuplicateCleanupRepository(database, repo);
const assets = new AssetCenterQueryService(databasePath);
const library = new LibraryPageQueryService(databasePath);
let heartbeat;
try {
  const source = repo.addSourceFolder(path.join(temporary, "metadata-only"), true);
  const groupCount = Number(process.argv[2] ?? 2000);
  assert.ok(Number.isInteger(groupCount) && groupCount > 0 && groupCount <= 50000, "Group count must be 1..50000");
  // Synthetic fixture only: measure the previous untracked-cache writer cost.
  const baselineWithoutRevisions = process.argv.includes("--baseline-no-revisions");
  if (baselineWithoutRevisions) for (const name of queryRevisionTriggerNames()) database.exec(`DROP TRIGGER ${name}`);
  database.transaction(() => {
    for (let group = 0; group < groupCount; group += 1) for (let item = 0; item < 2; item += 1) {
      const filename = `group-${group}-${item}.mp4`;
      repo.upsertVideo({ sourceFolderId: source.id, path: path.join(source.path, filename), directory: source.path,
        filename, basename: filename.slice(0, -4), extension: ".mp4", sizeBytes: 1000 + group,
        durationMs: 60000, width: 1920, height: 1080, format: "mp4", modifiedAt: "2026-10-05T00:00:00Z",
        providerFileId: `${group}-${item}`, providerPath: `/synthetic/${filename}` });
    }
  })();
  const query = { page: 1, pageSize: 20, sortDirection: "desc", sortField: "sizeBytes" };
  const start = performance.now();
  let last = start; let longestGap = 0;
  heartbeat = setInterval(() => { const now = performance.now(); longestGap = Math.max(longestGap, now - last); last = now; }, 10);
  await new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../dist-main/main/media/duplicateCleanupPreparationWorker.js", import.meta.url), {
      workerData: { databasePath, request: { requestId: "synthetic-worker", query }, stagePath }
    });
    let received = false;
    worker.once("message", (result) => { received = true; if (result.ok) resolve(); else reject(new Error(result.error)); });
    worker.once("error", reject);
    worker.once("exit", (code) => { if (!received) reject(new Error(`Preparation exited ${code}`)); });
  });
  const preparationMs = performance.now() - start;
  await new Promise((done) => setImmediate(done));
  assert.equal(jobs.listJobs(1, 20).totalItems, 0, "read worker must not create any job");
  const target = database.prepare("SELECT id FROM videos ORDER BY id LIMIT 1").get();
  repo.markMissing(target.id, true);
  assert.throws(() => jobs.submitFastStaged({ requestId: "stale" }, stagePath), /changed during preparation/);
  assert.equal(jobs.listJobs(1, 20).totalItems, 0, "failed admission must roll back completely");
  repo.markMissing(target.id, false);
  await new Promise((done) => setImmediate(done));
  longestGap = 0;
  last = performance.now();
  const admissionStart = performance.now();
  const accepted = jobs.submitFastStaged({ requestId: "accepted" }, stagePath);
  const admissionMs = performance.now() - admissionStart;
  await new Promise((done) => setImmediate(done));
  assert.equal(accepted.totalItems, groupCount);
  assert.equal(jobs.findAcceptedRequest("accepted").jobId, accepted.jobId);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM duplicate_cleanup_reservations WHERE released_at IS NULL").get().count, groupCount * 2);
  // No deletion worker is started by this check. The fixture contains no media files.
  assert.equal((await assets.listDuplicates(query)).totalGroups, 0);
  assert.equal((await library.page({ view: "all", search: "", sortField: "filename", sortDirection: "asc", page: 1, pageSize: 30 })).totalCount, groupCount * 2);
  const navigation = await assets.getLibraryNavigation();
  repo.recordPlayback(target.id, 1234);
  repo.markThumbnailReady(target.id, "synthetic-cover.jpg");
  assert.deepEqual(await assets.getLibraryNavigation(), navigation);
  repo.markMissing(target.id, true);
  assert.equal((await assets.getLibraryNavigation()).totalVideos, groupCount * 2 - 1);
  assert.equal((await library.page({ view: "all", search: "", sortField: "filename", sortDirection: "asc", page: 2, pageSize: 30 })).totalCount, groupCount * 2 - 1);
  await new Promise((done) => setTimeout(done, 30));
  console.log(JSON.stringify({ correctness: true, responsivenessPassed: longestGap < 1000, baselineWithoutRevisions,
    syntheticGroups: groupCount, preparationMs: Math.round(preparationMs),
    atomicAdmissionMs: Math.round(admissionMs), mainLoopMaxGapMs: Math.round(longestGap),
    contentReads: 0, filesDeleted: 0 }));
  assert.ok(longestGap < 1000, `Main loop gap ${longestGap.toFixed(1)}ms`);
} finally {
  clearInterval(heartbeat);
  assets.dispose(); library.dispose();
  database.close();
  // Worker termination is asynchronous; give its read handles time to close.
  await new Promise((done) => setTimeout(done, 100));
  await rm(temporary, { recursive: true, force: true });
}

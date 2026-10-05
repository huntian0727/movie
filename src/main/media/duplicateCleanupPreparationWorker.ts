import { parentPort, workerData } from "node:worker_threads";
import type { DuplicateCleanupFilteredSubmitRequest } from "../../shared/videoTypes.js";
import { VideoRepository } from "../db/videoRepository.js";
import { openAssetCenterReadonlyDatabase } from "../assetCenter/assetCenterReadonlyDatabase.js";
import { writeCleanupPreparationStage } from "../db/cleanupPreparationStage.js";

interface WorkerInput { databasePath: string; request: DuplicateCleanupFilteredSubmitRequest; stagePath?: string }
const input = workerData as WorkerInput;
if (!parentPort || !input?.databasePath || !input.request) {
  throw new Error("Duplicate cleanup preparation requires a database path and request");
}

// The library connection is read-only. The optional disposable task plan is
// written separately; it contains no runnable job and never changes the library.
const database = openAssetCenterReadonlyDatabase(input.databasePath);
try {
  const videos = new VideoRepository(database);
  const entries = database.transaction(() => videos.buildDuplicateResolveEntriesForQuery(input.request.query))();
  if (entries.length === 0) {
    throw new Error("当前筛选结果中没有可通过 CloudDrive API 删除的候选项");
  }
  if (input.stagePath) {
    writeCleanupPreparationStage(input.stagePath, entries);
    parentPort.postMessage({ ok: true });
  } else parentPort.postMessage({ ok: true, entries });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
} finally {
  database.close();
}

import { parentPort, workerData } from "node:worker_threads";
import { VideoRepository } from "../db/videoRepository.js";
import { openAssetCenterReadonlyDatabase } from "../assetCenter/assetCenterReadonlyDatabase.js";
import type { LibraryPageQuery } from "../../shared/videoTypes.js";

const port = parentPort;
if (!port) throw new Error("Library page worker requires a parent port");
const { databasePath } = workerData as { databasePath: string };
if (!databasePath) throw new Error("Library page worker requires a database path");

const database = openAssetCenterReadonlyDatabase(databasePath);
const repository = new VideoRepository(database);

port.on("message", (request: { id: number; query: LibraryPageQuery }) => {
  try {
    port.postMessage({ id: request.id, result: repository.listVideoPage(request.query) });
  } catch (error) {
    port.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

process.once("exit", () => {
  if (database.open) database.close();
});

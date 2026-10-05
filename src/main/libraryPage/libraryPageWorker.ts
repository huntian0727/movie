import { parentPort, workerData } from "node:worker_threads";
import { VideoRepository } from "../db/videoRepository.js";
import { QueryRevisionMonitor } from "../db/queryRevisions.js";
import { openAssetCenterReadonlyDatabase } from "../assetCenter/assetCenterReadonlyDatabase.js";
import type { LibraryPageQuery } from "../../shared/videoTypes.js";

const port = parentPort;
if (!port) throw new Error("Library page worker requires a parent port");
const { databasePath } = workerData as { databasePath: string };
if (!databasePath) throw new Error("Library page worker requires a database path");

const database = openAssetCenterReadonlyDatabase(databasePath);
const repository = new VideoRepository(database);
const revisions = new QueryRevisionMonitor(database);
const counts = new Map<string, { count: number; recent: boolean }>();

port.on("message", (request: { id: number; query: LibraryPageQuery }) => {
  try {
    const result = database.transaction(() => {
      const change = revisions.refresh();
      if (change.unknown || change.changed.has("library")) counts.clear();
      else if (change.changed.has("playback")) {
        for (const [key, value] of counts) if (value.recent) counts.delete(key);
      }
      const { view, directoryPath, folderScope, search } = request.query;
      const key = JSON.stringify({ view, directoryPath, folderScope, search: search.trim() });
      const page = repository.listVideoPage(request.query, counts.get(key)?.count);
      counts.delete(key);
      counts.set(key, { count: page.totalCount, recent: view === "recent" });
      if (counts.size > 64) counts.delete(counts.keys().next().value!);
      return page;
    })();
    port.postMessage({ id: request.id, result });
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

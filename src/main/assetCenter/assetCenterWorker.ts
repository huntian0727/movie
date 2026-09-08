import { parentPort, workerData } from "node:worker_threads";
import { VideoRepository } from "../db/videoRepository.js";
import { getAssetCenterSummary, listAssetCenterSources } from "./assetCenterQueries.js";
import { openAssetCenterReadonlyDatabase } from "./assetCenterReadonlyDatabase.js";
import type { AssetCenterWorkerRequest, AssetCenterWorkerResponse } from "./assetCenterWorkerProtocol.js";

interface AssetCenterWorkerData {
  databasePath: string;
}

const port = parentPort;
if (!port) {
  throw new Error("Asset Center query worker requires a parent message port");
}

const data = workerData as Partial<AssetCenterWorkerData>;
if (typeof data.databasePath !== "string" || data.databasePath.length === 0) {
  throw new Error("Asset Center query worker requires a database path");
}

const database = openAssetCenterReadonlyDatabase(data.databasePath);
let repository = new VideoRepository(database);
let dataVersion = database.pragma("data_version", { simple: true });
let cachedFolders: ReturnType<VideoRepository["listSourceFoldersWithStats"]> | undefined;
let cachedNavigation: ReturnType<VideoRepository["getLibraryNavigation"]> | undefined;

port.on("message", (request: AssetCenterWorkerRequest) => {
  let response: AssetCenterWorkerResponse;
  try {
    refreshRepositoryIfChanged();
    if (request.operation === "duplicates") {
      response = { id: request.id, ok: true, result: repository.listDuplicateGroupsPage(request.query) };
    } else if (request.operation === "folders") {
      cachedFolders ??= repository.listSourceFoldersWithStats();
      response = { id: request.id, ok: true, result: cachedFolders };
    } else if (request.operation === "navigation") {
      cachedNavigation ??= repository.getLibraryNavigation();
      response = { id: request.id, ok: true, result: cachedNavigation };
    } else if (request.operation === "summary") {
      response = { id: request.id, ok: true, result: getAssetCenterSummary(database) };
    } else {
      response = { id: request.id, ok: true, result: listAssetCenterSources(database, request.query) };
    }
  } catch (error: unknown) {
    response = {
      id: request.id,
      ok: false,
      error: serializeError(error)
    };
  }
  port.postMessage(response);
});

function refreshRepositoryIfChanged(): void {
  const nextVersion = database.pragma("data_version", { simple: true });
  if (nextVersion === dataVersion) return;
  repository = new VideoRepository(database);
  dataVersion = nextVersion;
  cachedFolders = undefined;
  cachedNavigation = undefined;
}

process.once("exit", () => {
  if (database.open) database.close();
});

function serializeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: "Error", message: String(error) };
}

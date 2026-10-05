import { parentPort, workerData } from "node:worker_threads";
import { VideoRepository, type DuplicatePageRankingCache } from "../db/videoRepository.js";
import { QueryRevisionMonitor } from "../db/queryRevisions.js";
import { getAssetCenterSummary, listAssetCenterSources, listDirectoryBrowserItems } from "./assetCenterQueries.js";
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
const revisions = new QueryRevisionMonitor(database);
let cachedFolders: ReturnType<VideoRepository["listSourceFoldersWithStats"]> | undefined;
let cachedNavigation: ReturnType<VideoRepository["getLibraryNavigation"]> | undefined;
const duplicateRankings = new Map<string, DuplicatePageRankingCache>();

port.on("message", (request: AssetCenterWorkerRequest) => {
  let response: AssetCenterWorkerResponse;
  try {
    response = database.transaction(() => handleRead(request))();
  } catch (error: unknown) {
    response = {
      id: request.id,
      ok: false,
      error: serializeError(error)
    };
  }
  port.postMessage(response);
});

function handleRead(request: AssetCenterWorkerRequest): AssetCenterWorkerResponse {
    let response: AssetCenterWorkerResponse;
    refreshRepositoryIfChanged();
    if (request.operation === "directories") {
      response = { id: request.id, ok: true, result: listDirectoryBrowserItems(database, request.query) };
    } else if (request.operation === "duplicates") {
      const { page: _page, pageSize: _pageSize, ...rankingQuery } = request.query;
      const key = JSON.stringify(rankingQuery);
      const ranking = duplicateRankings.get(key) ?? {};
      duplicateRankings.delete(key);
      duplicateRankings.set(key, ranking);
      if (duplicateRankings.size > 2) duplicateRankings.delete(duplicateRankings.keys().next().value!);
      response = { id: request.id, ok: true, result: repository.listDuplicateGroupsPage(request.query, ranking) };
    } else if (request.operation === "folders") {
      cachedFolders ??= repository.listSourceFoldersWithStats();
      response = { id: request.id, ok: true, result: cachedFolders };
    } else if (request.operation === "retainedCachePaths") {
      response = { id: request.id, ok: true, result: repository.listRetainedMediaCachePaths() };
    } else if (request.operation === "metadataIssues") {
      response = { id: request.id, ok: true, result: repository.listMetadataIssuePage(request.query) };
    } else if (request.operation === "scanFailures") {
      const result = database.transaction(() => repository.listScanFailureReviewPage(request.query))();
      response = { id: request.id, ok: true, result };
    } else if (request.operation === "navigation") {
      cachedNavigation ??= repository.getLibraryNavigation();
      response = { id: request.id, ok: true, result: cachedNavigation };
    } else if (request.operation === "summary") {
      response = { id: request.id, ok: true, result: getAssetCenterSummary(database) };
    } else {
      response = { id: request.id, ok: true, result: listAssetCenterSources(database, request.query) };
    }
    return response;
}

function refreshRepositoryIfChanged(): void {
  const change = revisions.refresh();
  if (change.unknown || change.changed.has("library") || change.changed.has("sources") || change.changed.has("cleanup")) duplicateRankings.clear();
  if (change.changed.has("cleanup")) repository = new VideoRepository(database);
  if (change.unknown || ["library", "sources", "scan"].some((domain) => change.changed.has(domain as "library" | "sources" | "scan"))) {
    repository = new VideoRepository(database);
    cachedFolders = undefined;
    cachedNavigation = undefined;
  }
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

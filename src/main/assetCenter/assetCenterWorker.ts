import { parentPort, workerData } from "node:worker_threads";
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

port.on("message", (request: AssetCenterWorkerRequest) => {
  let response: AssetCenterWorkerResponse;
  try {
    if (request.operation === "summary") {
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

process.once("exit", () => {
  if (database.open) database.close();
});

function serializeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: "Error", message: String(error) };
}

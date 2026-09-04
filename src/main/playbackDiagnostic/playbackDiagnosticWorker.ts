import { parentPort, workerData } from "node:worker_threads";
import { openAssetCenterReadonlyDatabase } from "../assetCenter/assetCenterReadonlyDatabase.js";
import { searchPlaybackDiagnosticVideos } from "./playbackDiagnosticQueries.js";
import type { PlaybackDiagnosticWorkerRequest, PlaybackDiagnosticWorkerResponse } from "./playbackDiagnosticWorkerProtocol.js";

interface PlaybackDiagnosticWorkerData {
  databasePath: string;
}

const port = parentPort;
if (!port) throw new Error("Playback Diagnostic query worker requires a parent message port");

const data = workerData as Partial<PlaybackDiagnosticWorkerData>;
if (typeof data.databasePath !== "string" || data.databasePath.length === 0) {
  throw new Error("Playback Diagnostic query worker requires a database path");
}

const database = openAssetCenterReadonlyDatabase(data.databasePath);

port.on("message", (request: PlaybackDiagnosticWorkerRequest) => {
  let response: PlaybackDiagnosticWorkerResponse;
  try {
    response = { id: request.id, ok: true, result: searchPlaybackDiagnosticVideos(database, request.query) };
  } catch (error: unknown) {
    response = { id: request.id, ok: false, error: serializeError(error) };
  }
  port.postMessage(response);
});

process.once("exit", () => {
  if (database.open) database.close();
});

function serializeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { name: "Error", message: String(error) };
}

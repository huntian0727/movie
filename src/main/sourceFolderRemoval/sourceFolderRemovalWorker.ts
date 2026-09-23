import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";
import { VideoRepository } from "../db/videoRepository.js";

const port = parentPort;
if (!port) throw new Error("Source folder removal worker requires a parent port");
const { databasePath } = workerData as { databasePath: string };
if (!databasePath) throw new Error("Source folder removal worker requires a database path");

const database = new Database(databasePath, { fileMustExist: true });
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 30000");
const repository = new VideoRepository(database);

port.on("message", (request: { id: number; operation: "preview" | "remove"; folderId: string }) => {
  try {
    const result = request.operation === "preview"
      ? repository.previewRemoveSourceFolder(request.folderId)
      : repository.removeSourceFolder(request.folderId);
    port.postMessage({ id: request.id, result });
  } catch (error) {
    port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
});

process.once("exit", () => {
  if (database.open) database.close();
});

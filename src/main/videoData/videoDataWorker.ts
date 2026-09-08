import { parentPort, workerData } from "node:worker_threads";
import { openSync, writeSync, closeSync, unlinkSync } from "node:fs";
import { openAssetCenterReadonlyDatabase } from "../assetCenter/assetCenterReadonlyDatabase.js";
import { iterateVideoData, queryVideoData, videoDataCsvHeader, videoDataCsvRow } from "./videoDataQueries.js";
import type { VideoDataQuery, VideoDataSelection } from "../../shared/videoDataTable.js";

const database = openAssetCenterReadonlyDatabase(workerData.databasePath as string);
parentPort!.on("message", (request: { id: number; query: VideoDataQuery; outputPath?: string; selection?: VideoDataSelection }) => {
  try {
    let result;
    if (request.outputPath && request.selection) {
      const fd = openSync(request.outputPath, "wx");
      let count = 0;
      try {
        writeSync(fd, videoDataCsvHeader);
        let buffer = "";
        for (const video of iterateVideoData(database, request.query, request.selection)) {
          buffer += videoDataCsvRow(video); count++;
          if (buffer.length >= 65536) { writeSync(fd, buffer); buffer = ""; }
        }
        if (buffer) writeSync(fd, buffer);
      } catch (error) { closeSync(fd); unlinkSync(request.outputPath); throw error; }
      closeSync(fd);
      result = { count };
    } else result = queryVideoData(database, request.query);
    parentPort!.postMessage({ id: request.id, result });
  } catch (error) { parentPort!.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
});
process.once("exit", () => database.close());

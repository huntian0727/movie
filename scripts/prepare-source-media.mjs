import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { candidateDirectory, mediaLockPath } from "./media-variant.mjs";
import { assertPrivateSourceMedia, stageSourceMedia, verifySourceMedia } from "./native-source-media.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(mediaLockPath(root, "source-candidate"), "utf8"));
const destination = candidateDirectory(root, "source-candidate");
assertPrivateSourceMedia();
try {
  await verifySourceMedia(destination, lock);
  console.log("Exact shared media closure already staged for private QA.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const archive = process.env.MOVIE_SOURCE_NATIVE_ZIP || process.env.MOVIE_SOURCE_PLAYER_ZIP;
  if (!archive) throw new Error("MOVIE_SOURCE_NATIVE_ZIP must identify the retained private native candidate ZIP.");
  await stageSourceMedia(root, destination, archive, lock);
  console.log("Exact shared FFmpeg/FFprobe closure staged; public distribution remains blocked.");
}

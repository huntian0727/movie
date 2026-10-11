import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const playerRuntimeDirectory = root => path.join(root, "native-bin", "player-runtime");
export async function verifyPlayerRuntime(directory, lock) {
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("Unsafe player runtime directory.");
  if (lock.schemaVersion !== 1 || lock.status !== "CANDIDATE_NOT_APPROVED" || lock.distributable !== false ||
      !lock.files?.["libmpv-2.dll"] || Object.keys(lock.files).some(name => !["libmpv-2.dll", "Copyright", "LICENSE.GPL", "LICENSE.LGPL"].includes(name))) {
    throw new Error("Player runtime candidate must remain pinned and unapproved.");
  }
  for (const name of ["libmpv-2.dll", "Copyright", "LICENSE.GPL", "LICENSE.LGPL"]) {
    const file = path.join(directory, name), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || !info.size) throw new Error("Invalid player runtime file: " + name);
    const bytes = await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== lock.files[name]) throw new Error("Pinned player runtime differs: " + name);
    if (name === "libmpv-2.dll") {
      if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Invalid libmpv PE");
      const header = bytes.readUInt32LE(0x3c);
      if (header + 6 > bytes.length || bytes.toString("ascii", header, header + 4) !== "PE\0\0" || bytes.readUInt16LE(header + 4) !== 0x8664) throw new Error("libmpv must be Windows x64");
    }
  }
}

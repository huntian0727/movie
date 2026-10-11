import path from "node:path";
import { lstat, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

export function playerRuntimeVariant(env = process.env) {
  const variant = env.MOVIE_PLAYER_VARIANT || "legacy-candidate";
  if (!["legacy-candidate", "source-candidate"].includes(variant)) throw new Error("Unknown player runtime variant.");
  return variant;
}
export const playerRuntimeDirectory = (root, env = process.env) => playerRuntimeVariant(env) === "source-candidate"
  ? path.join(root, ".tmp", "native-source-player-runtime") : path.join(root, "native-bin", "player-runtime");
export const playerRuntimeLockPath = (root, env = process.env) => path.join(root, "scripts",
  playerRuntimeVariant(env) === "source-candidate" ? "native-source-player-runtime.lock.json" : "native-player-runtime.lock.json");
export async function verifyPlayerRuntime(directory, lock) {
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("Unsafe player runtime directory.");
  const notices = ["Copyright", "LICENSE.GPL", "LICENSE.LGPL"];
  const source = lock.schemaVersion === 2 && lock.variant === "source-candidate";
  if ((!source && lock.schemaVersion !== 1) || lock.status !== "CANDIDATE_NOT_APPROVED" || lock.distributable !== false ||
      !lock.files?.["libmpv-2.dll"] || notices.some(name => !lock.files?.[name]) ||
      Object.entries(lock.files).some(([name, hash]) => !/^[a-f0-9]{64}$/.test(hash) ||
        !(notices.includes(name) || (source ? /^[a-z0-9][a-z0-9_+-]*\.dll$/i.test(name) : name === "libmpv-2.dll")))) {
    throw new Error("Player runtime candidate must remain pinned and unapproved.");
  }
  for (const name of Object.keys(lock.files)) {
    const file = path.join(directory, name), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || !info.size) throw new Error("Invalid player runtime file: " + name);
    const bytes = await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== lock.files[name]) throw new Error("Pinned player runtime differs: " + name);
    if (/\.dll$/i.test(name)) {
      if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Invalid libmpv PE");
      const header = bytes.readUInt32LE(0x3c);
      if (header + 6 > bytes.length || bytes.toString("ascii", header, header + 4) !== "PE\0\0" || bytes.readUInt16LE(header + 4) !== 0x8664) throw new Error("libmpv must be Windows x64");
    }
  }
  for (const name of await readdir(directory)) {
    if (/\.(dll|exe)$/i.test(name) && name !== "NativeHost.exe" && !Object.hasOwn(lock.files, name))
      throw new Error("Unexpected player runtime binary: " + name);
  }
}

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function runNativeSmoke(target = "node") {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "video-manager-native-"));
  const dbPath = path.join(tempDirectory, "native-smoke.sqlite");
  try {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
      db.prepare("INSERT INTO smoke (value) VALUES (?)").run("native-ok");
      const value = db.prepare("SELECT value FROM smoke WHERE id = 1").pluck().get();
      if (value !== "native-ok") {
        throw new Error(`Unexpected SQLite smoke value: ${String(value)}`);
      }
    } finally {
      db.close();
    }
    console.log(
      `Native smoke OK: target=${target}, ABI=${process.versions.modules}, Electron=${process.versions.electron ?? "none"}.`
    );
  } catch (error) {
    const recovery = target === "electron"
      ? "Close Electron/Node processes using better_sqlite3.node, then run npm run rebuild:electron in the Electron-only checkout."
      : "Use Node 22.23.1 in a Node-test checkout, remove that checkout's node_modules with normal package-manager cleanup, then run npm ci.";
    throw new Error(
      `Unable to load/use better-sqlite3 for ${target} ABI ${process.versions.modules}. ${recovery} Do not delete user databases.`,
      { cause: error }
    );
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  runNativeSmoke(process.argv[2] ?? "node").catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

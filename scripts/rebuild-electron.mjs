import { rebuild } from "@electron/rebuild";
import electronPackage from "electron/package.json" with { type: "json" };
import sqlitePackage from "better-sqlite3/package.json" with { type: "json" };
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

try {
  // Electron 44 exposes an explicit installer instead of a postinstall hook.
  const installation = spawnSync(process.execPath, ["node_modules/electron/install.js"], {
    stdio: "inherit", windowsHide: true, env: process.env
  });
  if (installation.error || installation.status !== 0) throw new Error("Locked Electron runtime installation failed", { cause: installation.error });
  if (sqlitePackage.version === "13.0.3" && sqlitePackage.gypfile === false) {
    // v13 ships official N-API prebuilds in the lockfile-verified npm package.
    // Do not turn this ABI-independent binary back into an unnecessary source build.
    if (process.platform !== "win32" || process.arch !== "x64") throw new Error("The release native gate requires Windows x64.");
    await access(path.join(process.cwd(), "node_modules", "better-sqlite3", "prebuilds", "win32-x64.node"));
    const result = spawnSync(process.execPath, ["scripts/run-electron-smoke.mjs", "--native-only"], {
      stdio: "inherit", windowsHide: true, env: process.env
    });
    if (result.error || result.status !== 0) throw new Error("Official SQLite N-API prebuild failed the actual Electron read/write gate.", { cause: result.error });
    console.log(`Official SQLite ${sqlitePackage.version} N-API prebuild verified in Electron ${electronPackage.version}.`);
  } else {
    await rebuild({
      buildPath: process.cwd(),
      electronVersion: electronPackage.version,
      force: true,
      onlyModules: ["better-sqlite3"]
    });
    console.log(`Electron native rebuild complete: Electron ${electronPackage.version}.`);
  }
} catch (error) {
  console.error([
    `Electron native rebuild failed for Electron ${electronPackage.version}.`,
    "Close the app, Electron dev windows, Vitest watch, and any Node/Electron process holding better_sqlite3.node, then retry.",
    "Use a dedicated Electron checkout; do not run Node Vitest in it after rebuilding.",
    "Do not delete library.sqlite or any user media to repair this error."
  ].join("\n"));
  console.error(error);
  process.exitCode = 1;
}

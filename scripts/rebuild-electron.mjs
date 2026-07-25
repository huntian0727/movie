import { rebuild } from "@electron/rebuild";
import electronPackage from "electron/package.json" with { type: "json" };

try {
  await rebuild({
    buildPath: process.cwd(),
    electronVersion: electronPackage.version,
    force: true,
    onlyModules: ["better-sqlite3"]
  });
  console.log(`Electron native rebuild complete: Electron ${electronPackage.version}.`);
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

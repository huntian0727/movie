import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function runDataDirectorySmoke(root, app, safeStorage) {
  const { DataDirectoryManager } = await import("../dist-main/main/storage/dataDirectory.js");
  const { createDatabase } = await import("../dist-main/main/db/database.js");
  const { createSettingsStore } = await import("../dist-main/main/settings/settingsStore.js");
  const source = path.join(root, "directory-source"), parent = path.join(root, "directory-target");
  await mkdir(source); await mkdir(parent);
  createDatabase(path.join(source, "library.sqlite")).close();
  await writeFile(path.join(source, "settings.json"), await readFile(path.join(root, "settings.json")));
  await writeFile(path.join(source, "clouddrive-credentials.bin"), await readFile(path.join(root, "clouddrive-credentials.bin")));
  await writeFile(path.join(source, "subtitle-credentials.bin"), safeStorage.encryptString("synthetic-subtitle-config"));
  const before = new DataDirectoryManager(source);
  let after;
  const previous = app.getPath("userData");
  try {
    await before.initialize(); const preview = await before.choose(parent); await before.schedule(preview.token); await before.dispose();
    after = new DataDirectoryManager(source); await after.initialize(); await after.prepareStartup();
    assert.equal(after.getStatus().currentDirectory, preview.targetDirectory);
    app.setPath("userData", preview.targetDirectory);
    const settings = await createSettingsStore();
    assert.equal(settings.getCloudDriveToken(), "electron-replacement-test-value");
    assert.equal(safeStorage.decryptString(await readFile(path.join(preview.targetDirectory, "subtitle-credentials.bin"))), "synthetic-subtitle-config");
    await after.finishStartup();
    assert.equal(JSON.parse(await readFile(path.join(source, "data-location.json"), "utf8")).current, preview.targetDirectory);
    console.log("Data directory Electron smoke OK: SQLite relocation, settings, OS-encrypted credentials and verified cleanup.");
  } finally { await before.dispose(); await after?.dispose(); app.setPath("userData", previous); }
}

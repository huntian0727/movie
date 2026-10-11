const { app, safeStorage } = require("electron");
// Keep the smoke alive between the two hidden role-specific windows.
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const { runNativeSmoke } = await import("./native-smoke.mjs");
  await runNativeSmoke("electron");
  const smokeRoot = process.argv.find(argument => argument.startsWith("--smoke-root="))?.slice("--smoke-root=".length);
  if (!smokeRoot) throw new Error("Native smoke requires an isolated completion directory");
  require("node:fs").writeFileSync(require("node:path").join(smokeRoot, "native-completed"), "SQLite read/write assertions passed");
  if (!process.argv.includes("--native-only")) {
    const { readFileSync, writeFileSync } = require("node:fs");
    const path = require("node:path");
    const assert = require("node:assert/strict");
    const root = process.argv.find(argument => argument.startsWith("--smoke-root="))?.slice("--smoke-root=".length);
    assert.ok(root, "Smoke runner must supply an isolated data directory.");
    const { runReleaseIdentitySmoke } = await import("./release-identity-smoke.mjs");
    await runReleaseIdentitySmoke(root, app);
    const previousUserData = app.getPath("userData");
    try {
      app.setPath("userData", root);
      assert.equal(safeStorage.isEncryptionAvailable(), true);
      const { createSettingsStore, getDefaultSettings } = await import("../dist-main/main/settings/settingsStore.js");
      writeFileSync(path.join(root, "settings.json"), JSON.stringify({ cloudDrive: { apiToken: "electron-migration-test-value" }, startupSync: false }));
      const settings = await createSettingsStore();
      assert.equal(settings.getCloudDriveToken(), "electron-migration-test-value");
      assert.equal(readFileSync(path.join(root, "settings.json"), "utf8").includes("electron-migration-test-value"), false);
      assert.equal(settings.get().startupSync, false);
      assert.equal(JSON.stringify(settings.get()).includes("apiToken"), false);
      settings.set({ ...getDefaultSettings(), cloudDrive: { ...getDefaultSettings().cloudDrive, apiToken: "electron-replacement-test-value" } });
      const reopened = await createSettingsStore();
      assert.equal(reopened.getCloudDriveToken(), "electron-replacement-test-value");
      assert.equal(readFileSync(path.join(root, "clouddrive-credentials.bin")).includes(Buffer.from("electron-replacement-test-value")), false);
      assert.equal(reopened.get().cloudDrive.configured, true);
      // Exercise compiled sandboxed bridges with synthetic credentials and no user data.
      const { BrowserWindow, ipcMain } = require("electron");
      const { pathToFileURL } = require("node:url");
      const { configureWindowSecurity } = await import("../dist-main/main/security.js");
      const { registerIpcHandlers } = await import("../dist-main/main/ipc.js");
      registerIpcHandlers({}, { settings: reopened, cacheRoot: root,
        cacheManager: { getStatus: () => ({ totalBytes: 0 }) }, domainEvents: { publish() {} },
        metadataQueue: {}, duplicateCleanup: {}, duplicateCleanupJobs: {}, scanManager: {} });
      const entry = path.join(root, "renderer.html");
      writeFileSync(entry, "<!doctype html><title>CloudDrive security smoke</title>");
      const entryUrl = pathToFileURL(entry).href;
      try {
        for (const role of ["main", "player"]) {
          const window = new BrowserWindow({ show: false, webPreferences: {
            contextIsolation: true, sandbox: true, nodeIntegration: false,
            preload: path.resolve(__dirname, "../dist-main/main/preload.cjs"), additionalArguments: [
              `--video-manager-window-role=${role}`, `--video-manager-entry-url=${encodeURIComponent(entryUrl)}`
            ]
          } });
          configureWindowSecurity(window, { role, entryUrl });
          window.webContents.on("preload-error", (_event, _preloadPath, error) => {
            console.error(`Sandboxed ${role} preload failed:`, error);
          });
          try {
            await window.loadURL(entryUrl);
            assert.equal(await window.webContents.executeJavaScript('typeof window.videoManager'), "object",
              `Sandboxed ${role} bridge missing at ${window.webContents.getURL()} (expected ${entryUrl})`);
            const result = await window.webContents.executeJavaScript(`(async () => {
              const snapshot = await window.videoManager.getSettings();
              return { snapshot, hasTokenReader: Object.keys(window.videoManager).some(key => /token|secret|credential|invoke/i.test(key)),
                canWriteSettings: typeof window.videoManager.setSettings === "function", nodeExposed: typeof require !== "undefined" };
            })()`);
            assert.equal(JSON.stringify(result).includes("electron-replacement-test-value"), false);
            assert.equal(JSON.stringify(result.snapshot).includes("apiToken"), false);
            assert.equal(result.snapshot.settings.cloudDrive.configured, true);
            assert.equal(result.hasTokenReader, false);
            assert.equal(result.canWriteSettings, role === "main");
            assert.equal(result.nodeExposed, false);
            console.log(`CloudDrive sandboxed ${role} preload smoke OK.`);
          } finally { window.destroy(); }
        }
      } finally { ipcMain.removeHandler("settings:get"); }
      console.log("CloudDrive OS-backed safeStorage smoke OK: migration, replacement, reopen and public non-disclosure.");
      writeFileSync(path.join(root, "smoke-completed"), "all assertions passed");
    } finally { app.setPath("userData", previousUserData); }
  }
  console.log("Electron main-process smoke OK: app.whenReady completed.");
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

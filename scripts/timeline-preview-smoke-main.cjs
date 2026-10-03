// Isolated real-Electron test: no user library, media, settings or playback changes.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const assert = require("node:assert/strict");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "timeline-preview-smoke-"));
app.setPath("userData", root);
app.disableHardwareAcceleration(); // Match the shipped Windows application.
app.whenReady().then(async () => {
  app.on("browser-window-created", (_event, window) => {
    window.webContents.on("did-fail-load", (_event, code, message) => console.error("Preview fixture load failure:", code, message));
    window.webContents.on("preload-error", (_event, _file, error) => console.error("Preview fixture preload failure:", error));
    window.webContents.on("console-message", (_event, level, message) => { if (level >= 2) console.error("Preview fixture renderer:", message); });
  });
  const { PlayerTimelinePreview } = await import("../dist-main/main/playerTimelinePreview.js");
  const { IPC_CHANNELS } = await import("../dist-main/shared/videoTypes.js");
  const { assertTrustedIpcSender, getAllowedIpcRoles } = await import("../dist-main/main/security.js");
  let requests = 0;
  for (const channel of [IPC_CHANNELS.previewImageLoad, IPC_CHANNELS.previewImageCancel, IPC_CHANNELS.previewImageState]) {
    ipcMain.handle(channel, event => {
      assertTrustedIpcSender(event, getAllowedIpcRoles(channel));
      if (channel === IPC_CHANNELS.previewImageLoad) requests++;
      return null; // The existing placeholder must still paint, with the correct time.
    });
  }
  const parent = new BrowserWindow({ width: 640, height: 480 });
  await parent.loadURL("data:text/html,<body style='background:blue'>isolated fixture</body>");
  parent.show(); parent.focus();
  for (let attempt = 0; attempt < 30 && !parent.isFocused(); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  const preview = new PlayerTimelinePreview(parent, {
    currentDir: path.resolve("dist-main/main"), isPackaged: true, devServerUrl: ""
  });
  console.log("Timeline fixture parent:", JSON.stringify({ visible: parent.isVisible(), focused: parent.isFocused() }));
  await preview.update({ videoId: "fixture", timeMs: 45000, x: 300, y: 350 }, {
    id: "fixture", width: 1920, height: 1080, durationMs: 90000, updatedAt: "fixture"
  });
  const overlay = BrowserWindow.getAllWindows().find(window => window !== parent);
  assert.ok(overlay, "Preview window created");
  let state;
  for (let attempt = 0; attempt < 30; attempt++) {
    state = await overlay.webContents.executeJavaScript(`({
      mode: window.videoManager?.windowMode,
      text: document.querySelector('.timeline-preview-window')?.textContent,
      image: !!document.querySelector('.timeline-preview-window img'),
      ready: document.readyState, hidden: document.hidden
    })`);
    if (state.text === "00:45" && requests > 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log("Timeline preview real renderer:", JSON.stringify({ ...state, requests, focused: parent.isFocused() }));
  assert.equal(state.mode, "timeline-preview");
  assert.equal(state.text, "00:45");
  assert.equal(state.image, true);
  assert.ok(requests > 0, "Visible preview uses the existing authorized image queue");
  assert.equal(parent.isFocused(), true, "Preview does not steal focus");
  preview.hide();
  assert.equal(overlay.isVisible(), false);
  preview.close();
  assert.equal(overlay.isDestroyed(), true);
  parent.destroy();
  console.log("Timeline preview Electron smoke OK.");
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

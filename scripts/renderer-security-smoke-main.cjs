const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, protocol, session, net } = require("electron");
const rootArgument = process.argv.find(value => value.startsWith("--smoke-root="));
assert(rootArgument, "An isolated smoke root is required");
const root = rootArgument.slice("--smoke-root=".length);
app.setPath("userData", path.join(root, "profile"));
protocol.registerSchemesAsPrivileged([
  { scheme: "app-ui", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: "local-video", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const { registerRendererProtocol, RENDERER_ENTRY_URL } = await import("../dist-main/main/rendererProtocol.js");
  const { configureWindowSecurity, installSessionPermissionPolicy, installMediaRequestPolicy } = await import("../dist-main/main/security.js");
  const { registerMediaProtocol } = await import("../dist-main/main/media/mediaProtocol.js");
  const { createSettingsStore, getDefaultSettings } = await import("../dist-main/main/settings/settingsStore.js");
  // Real Windows DPAPI recovery uses this runner's isolated profile only.
  const settings = await createSettingsStore();
  settings.set({ cloudDrive: { ...getDefaultSettings().cloudDrive, apiToken: "synthetic-dpapi-original" } });
  const credentialFile = path.join(app.getPath("userData"), "clouddrive-credentials.bin");
  fs.writeFileSync(credentialFile, "synthetic-corrupt-ciphertext");
  assert.equal(settings.getCloudDriveToken(), "");
  assert.equal(settings.get().cloudDrive.configured, false);
  assert.ok(settings.get().cloudDrive.credentialError);
  settings.set({ cloudDrive: { ...settings.get().cloudDrive, apiToken: " " }, seekStepSeconds: 25 });
  assert.equal(fs.readFileSync(credentialFile, "utf8"), "synthetic-corrupt-ciphertext");
  settings.set({ cloudDrive: { ...settings.get().cloudDrive, apiToken: "synthetic-dpapi-recovered" } });
  assert.equal(settings.getCloudDriveToken(), "synthetic-dpapi-recovered");
  assert.equal(settings.get().cloudDrive.credentialError, undefined);
  assert.equal(JSON.stringify(settings.get()).includes("synthetic-dpapi"), false);
  assert.equal(fs.readFileSync(credentialFile).includes(Buffer.from("synthetic-dpapi-recovered")), false);
  const bundle = path.join(root, "bundle"); fs.mkdirSync(path.join(bundle, "assets"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "index.html"), '<html><head><script type="module" src="./assets/allowed.js"></script></head><body>synthetic security fixture</body></html>');
  fs.writeFileSync(path.join(bundle, "assets", "allowed.js"), "window.syntheticBundleMounted = true;");
  const privateFile = path.join(root, "private.txt"); fs.writeFileSync(privateFile, "synthetic-private-only");
  const externalScript = path.join(root, "outside.js"); fs.writeFileSync(externalScript, "window.syntheticOutsideExecuted = true;");
  const requests = [];
  const server = http.createServer((request, response) => { requests.push(request.url); response.setHeader("Access-Control-Allow-Origin", "*"); response.end("synthetic"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  registerRendererProtocol(protocol, bundle); installSessionPermissionPolicy(session.defaultSession);
  installMediaRequestPolicy(session.defaultSession);
  let mediaReads = 0;
  registerMediaProtocol({ getVideo: () => ({ id: "synthetic", path: "synthetic-only.mp4", sizeBytes: 1, modifiedAt: "synthetic", durationMs: 1 }), markTimelinePreviewReady: () => {} },
    { root: path.join(root, "media-cache"), getOrCreateImage: async () => { mediaReads++; return Buffer.from("synthetic-media-only"); } }, () => 5,
    { respond: async () => { mediaReads++; return new Response("synthetic-media-only"); } });
  const results = {};
  try {
    const mainResponse = await net.fetch("local-video://image/synthetic-main-only");
    assert.equal(await mainResponse.text(), "synthetic-media-only", "Main-process protocol smoke compatibility");
    for (const role of ["main", "player", "timeline-preview"]) {
      const window = new BrowserWindow({ show: false, webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        preload: path.resolve("dist-main/main/preload.cjs"),
        additionalArguments: [`--video-manager-window-role=${role}`, `--video-manager-entry-url=${encodeURIComponent(RENDERER_ENTRY_URL)}`]
      } });
      configureWindowSecurity(window, { role, entryUrl: RENDERER_ENTRY_URL });
      try {
        await window.loadURL(`${RENDERER_ENTRY_URL}?smoke-role=${role}`);
        const checked = await window.webContents.executeJavaScript(`(async () => {
          let privateFileRead = false, remoteRead = false;
          try { privateFileRead = (await (await fetch(${JSON.stringify(pathToFileURL(privateFile).href)})).text()) === "synthetic-private-only"; } catch {}
          try { remoteRead = (await fetch(${JSON.stringify(`http://127.0.0.1:${server.address().port}/only-synthetic`)})).ok; } catch {}
          const outsideScript = await new Promise(resolve => { const script = document.createElement("script"); script.src=${JSON.stringify(pathToFileURL(externalScript).href)};
            script.onload=()=>resolve(window.syntheticOutsideExecuted===true);script.onerror=()=>resolve(false);document.head.appendChild(script);setTimeout(()=>resolve(false),500); });
          const denied = await fetch("app-ui://bundle/private.txt");
          const allowed = await fetch("app-ui://bundle/assets/allowed.js");
          const media = await (await fetch(${JSON.stringify(role === "timeline-preview" ? "local-video://preview/synthetic-only/0" : "local-video://image/synthetic-only")})).text();
          return { privateFileBlocked: !privateFileRead, outsideScriptBlocked: !outsideScript, remoteBlocked: !remoteRead,
            assetsLoaded: window.syntheticBundleMounted===true && allowed.ok, unknownResourceBlocked: denied.status===404,
            mediaReadable: media === "synthetic-media-only",
            bridgeLoaded: typeof window.videoManager === "object", bridgeHasNoInvoke: typeof window.videoManager?.invoke === "undefined",
            noNode: typeof window.require === "undefined", role: window.videoManager?.windowMode };
        })()`);
        for (const [name, value] of Object.entries(checked)) {
          if (name !== "role") assert.equal(value, true, `${role}: ${name}`);
        }
        assert.equal(checked.role, role);
        results[role] = checked;
      } finally { window.destroy(); }
    }
    const untrusted = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      await untrusted.loadURL("data:text/html;charset=utf-8,<title>synthetic untrusted origin</title>");
      assert.equal(await untrusted.webContents.executeJavaScript('(async () => { try { const result = await fetch("local-video://image/synthetic-only"); return !result.ok; } catch { return true; } })()'), true,
        "Opaque/null origin cannot read library media");
      assert.equal(mediaReads, 4, "Untrusted origin must not invoke image/disk service");
    } finally { untrusted.destroy(); }
    assert.equal(requests.length, 0, "Blocked remote fetch must not reach the synthetic server");
    fs.writeFileSync(path.join(root, "security-completed.json"), JSON.stringify({ ok: true, electron: process.versions.electron, dpapiRecovery: true, untrustedMediaBlocked: true, mainMediaRead: true, results }));
    console.log(`Renderer protocol security smoke OK (Electron ${process.versions.electron}): DPAPI recovery, main/player/timeline assets, bridge and media; external files/scripts/network and opaque media origin denied.`);
  } finally { await new Promise(resolve => server.close(resolve)); }
  app.exit(0);
}).catch(error => { console.error("Renderer protocol security smoke failed:", error.message); app.exit(1); });

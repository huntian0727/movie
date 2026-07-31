import { BrowserWindow, app, net, protocol } from "electron";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execa } from "execa";
import type { DatabaseConnection } from "./db/database.js";
import type { VideoRepository } from "./db/videoRepository.js";
import type { ScanManager } from "./media/scanManager.js";
import { MEDIA_SCHEME } from "./media/mediaProtocol.js";
import type { MetadataQueue } from "./media/metadataQueue.js";
import { resolvePackagedExecutablePath } from "./media/packagedExecutable.js";
import { configureWindowSecurity } from "./security.js";

interface PackagedSmokeContext {
  phase: "create" | "verify";
  resultPath: string;
  userDataPath: string;
  currentDir: string;
  db: DatabaseConnection;
  repo: VideoRepository;
  scanManager: ScanManager;
  metadataQueue: MetadataQueue;
}

interface StaticBinaryModule {
  path: string;
}

const require = createRequire(import.meta.url);

export async function runPackagedSmoke(context: PackagedSmokeContext): Promise<void> {
  const checks: Record<string, boolean | number | string> = {
    packaged: app.isPackaged,
    databaseQuickCheck: context.db.pragma("quick_check", { simple: true }) === "ok"
  };
  try {
    await access(path.join(context.userDataPath, "logs", "app.jsonl"));
    checks.structuredLogCreated = true;
  } catch {
    checks.structuredLogCreated = false;
  }

  if (context.phase === "create") {
    const fixtureDirectory = path.join(context.userDataPath, "packaged-smoke-fixture");
    await mkdir(fixtureDirectory, { recursive: true });
    const fixtureBytes = Buffer.from("packaged-smoke-video-fixture");
    await writeFile(path.join(fixtureDirectory, "sample.mp4"), fixtureBytes);

    context.metadataQueue.pause();
    const folder = context.repo.addSourceFolder(fixtureDirectory, false);
    await context.scanManager.start(folder);
    const videos = context.repo.listVideos({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      includeMissing: true
    });
    checks.fixtureScanned = videos.length === 1 && videos[0]?.filename === "sample.mp4";
    checks.videoCount = videos.length;
    checks.protocolRegistered = await protocol.isProtocolHandled(MEDIA_SCHEME);
    if (!videos[0]) throw new Error("Packaged smoke fixture was not indexed");
    const protocolResponse = await net.fetch(
      `${MEDIA_SCHEME}://media/${encodeURIComponent(videos[0].id)}`,
      { headers: { Range: "bytes=0-7" } }
    );
    checks.protocolRead =
      protocolResponse.status === 206 &&
      Buffer.from(await protocolResponse.arrayBuffer()).equals(fixtureBytes.subarray(0, 8));
    Object.assign(checks, await verifyPackagedRendererSecurity(context.currentDir));

    const ffmpegPath = require("ffmpeg-static") as string | null;
    const ffprobePath = (require("ffprobe-static") as StaticBinaryModule).path;
    if (!ffmpegPath) throw new Error("ffmpeg-static did not return an executable path");
    const executableFfmpegPath = resolvePackagedExecutablePath(ffmpegPath);
    const executableFfprobePath = resolvePackagedExecutablePath(ffprobePath);
    await Promise.all([
      access(executableFfmpegPath),
      access(executableFfprobePath),
      execa(executableFfmpegPath, ["-version"], { timeout: 10_000 }),
      execa(executableFfprobePath, ["-version"], { timeout: 10_000 })
    ]);
    checks.ffmpegLocated = true;
    checks.ffprobeLocated = true;
    checks.ffmpegExecutable = true;
    checks.ffprobeExecutable = true;
  } else {
    const videos = context.repo.listVideos({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      includeMissing: true
    });
    checks.databaseReopenedAfterExit = videos.length === 1 && videos[0]?.filename === "sample.mp4";
    checks.videoCount = videos.length;
  }

  const failedChecks = Object.entries(checks).filter(([, value]) => value === false);
  if (failedChecks.length > 0) {
    throw new Error(`Packaged smoke checks failed: ${failedChecks.map(([name]) => name).join(", ")}`);
  }

  await mkdir(path.dirname(context.resultPath), { recursive: true });
  await writeFile(
    context.resultPath,
    JSON.stringify({ ok: true, phase: context.phase, checks, electron: process.versions.electron }, null, 2),
    "utf8"
  );
}

async function verifyPackagedRendererSecurity(currentDir: string): Promise<Record<string, boolean>> {
  const entryPath = path.join(currentDir, "../../dist-renderer/index.html");
  const entryUrl = pathToFileURL(entryPath).href;
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(currentDir, "preload.cjs"),
      additionalArguments: [
        "--video-manager-window-role=smoke",
        `--video-manager-entry-url=${encodeURIComponent(entryUrl)}`
      ]
    }
  });
  configureWindowSecurity(window, { role: "smoke", entryUrl });
  try {
    await window.loadFile(entryPath, { query: { player: "1" } });
    const checks = await window.webContents.executeJavaScript(`
      (async () => {
        const rendererMounted = await new Promise((resolve) => {
          const deadline = Date.now() + 5000;
          const poll = () => {
            if (document.querySelector("#root")?.childElementCount > 0) {
              resolve(true);
              return;
            }
            if (Date.now() >= deadline) {
              resolve(false);
              return;
            }
            setTimeout(poll, 50);
          };
          poll();
        });
        window.__videoManagerInlineCspProbe = false;
        const inlineScript = document.createElement("script");
        inlineScript.textContent = "window.__videoManagerInlineCspProbe = true";
        document.head.appendChild(inlineScript);

        window.__videoManagerExternalCspProbe = false;
        const externalBlocked = await new Promise((resolve) => {
          const externalScript = document.createElement("script");
          externalScript.src = "data:text/javascript,window.__videoManagerExternalCspProbe=true";
          externalScript.onload = () => resolve(false);
          externalScript.onerror = () => resolve(window.__videoManagerExternalCspProbe === false);
          document.head.appendChild(externalScript);
          setTimeout(() => resolve(window.__videoManagerExternalCspProbe === false), 250);
        });

        const beforeNavigation = location.href;
        location.assign("https://example.com/blocked?local-path=redacted");
        await new Promise((resolve) => setTimeout(resolve, 100));

        return {
          rendererMounted,
          preloadLoaded: typeof window.videoManager === "object",
          preloadHasNoGenericInvoke: typeof window.videoManager?.invoke === "undefined",
          playerBridgeMinimized:
            typeof window.videoManager?.deleteVideos === "undefined" &&
            typeof window.videoManager?.moveVideos === "undefined" &&
            typeof window.videoManager?.renameVideo === "undefined" &&
            typeof window.videoManager?.setSettings === "undefined" &&
            typeof window.videoManager?.clearCache === "undefined" &&
            typeof window.videoManager?.previewDiagnostics === "undefined" &&
            typeof window.videoManager?.exportDiagnostics === "undefined",
          cspInlineScriptBlocked: window.__videoManagerInlineCspProbe === false,
          cspExternalScriptBlocked: externalBlocked,
          windowOpenBlocked: window.open("https://example.com/blocked") === null,
          navigationBlocked: location.href === beforeNavigation
        };
      })()
    `);
    return {
      ...(checks as Record<string, boolean>),
      untrustedPageHasNoBridge: await verifyUntrustedPageHasNoBridge(currentDir, entryUrl)
    };
  } finally {
    window.destroy();
  }
}

async function verifyUntrustedPageHasNoBridge(currentDir: string, trustedEntryUrl: string): Promise<boolean> {
  // Deliberately omit configureWindowSecurity here to prove the preload itself fails closed
  // even if a future regression bypasses the normal navigation guard.
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(currentDir, "preload.cjs"),
      additionalArguments: [
        "--video-manager-window-role=main",
        `--video-manager-entry-url=${encodeURIComponent(trustedEntryUrl)}`
      ]
    }
  });
  try {
    await window.loadURL("data:text/html;charset=utf-8,<title>untrusted</title>");
    return await window.webContents.executeJavaScript("typeof window.videoManager === 'undefined'");
  } finally {
    window.destroy();
  }
}

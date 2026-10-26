import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = process.cwd();
const tempBase = process.env.TEMP ?? process.env.TMP ?? os.tmpdir();
const smokeRoot = await realpath(await mkdtemp(path.join(tempBase, "movie-electron-scroll-benchmark-")));

let viteProcess;
let electronProcess;
let succeeded = false;
const benchmarkOrder = (process.env.MOVIE_ELECTRON_SCROLL_ORDER ?? "on,off").split(",").map((mode) => mode.trim());
if (benchmarkOrder.length !== 2 || new Set(benchmarkOrder).size !== 2 || !benchmarkOrder.every((mode) => mode === "on" || mode === "off")) {
  throw new Error("MOVIE_ELECTRON_SCROLL_ORDER must contain 'on,off' or 'off,on'.");
}
const benchmarkSurface = process.env.MOVIE_ELECTRON_SCROLL_SURFACE ?? "video-grid";
if (benchmarkSurface !== "video-grid" && benchmarkSurface !== "duplicate-items") {
  throw new Error("MOVIE_ELECTRON_SCROLL_SURFACE must be 'video-grid' or 'duplicate-items'.");
}
const benchmarkResizeObserver = process.env.MOVIE_ELECTRON_SCROLL_RESIZE_OBSERVER ?? "on";
if (benchmarkResizeObserver !== "on" && benchmarkResizeObserver !== "off") {
  throw new Error("MOVIE_ELECTRON_SCROLL_RESIZE_OBSERVER must be 'on' or 'off'.");
}
const benchmarkProfileObservers = process.env.MOVIE_ELECTRON_SCROLL_PROFILE_OBSERVERS ?? "off";
if (benchmarkProfileObservers !== "on" && benchmarkProfileObservers !== "off") {
  throw new Error("MOVIE_ELECTRON_SCROLL_PROFILE_OBSERVERS must be 'on' or 'off'.");
}
const benchmarkItemCount = Number(
  process.env.MOVIE_ELECTRON_SCROLL_VIDEO_COUNT ?? (benchmarkSurface === "duplicate-items" ? 10000 : 300)
);
const maximumItemCount = benchmarkSurface === "duplicate-items" ? 10000 : 1000;
if (!Number.isInteger(benchmarkItemCount) || benchmarkItemCount < 1 || benchmarkItemCount > maximumItemCount) {
  throw new Error("MOVIE_ELECTRON_SCROLL_VIDEO_COUNT must be an integer between 1 and " + maximumItemCount + ".");
}
const requestedScrollDistancePx = process.env.MOVIE_ELECTRON_SCROLL_DISTANCE_PX === undefined
  ? null
  : Number(process.env.MOVIE_ELECTRON_SCROLL_DISTANCE_PX);
if (requestedScrollDistancePx !== null && (!Number.isFinite(requestedScrollDistancePx) || requestedScrollDistancePx <= 0)) {
  throw new Error("MOVIE_ELECTRON_SCROLL_DISTANCE_PX must be a positive finite number when provided.");
}

try {
  const port = await findFreePort();
  const benchmarkUrl = "http://127.0.0.1:" + port + "/tests/electron/scroll-benchmark.html";
  const viteCli = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const electronExecutable = path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
  const electronMain = path.join(projectRoot, "scripts", "electron-scroll-benchmark-main.cjs");
  viteProcess = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "ignore",
    windowsHide: true
  });
  await waitForServer(benchmarkUrl, viteProcess);
  const measurements = [];
  for (const mode of benchmarkOrder) {
    const runRoot = path.join(smokeRoot, mode);
    const userDataPath = path.join(runRoot, "isolated-user-data");
    const resultPath = path.join(runRoot, "result.json");
    await mkdir(userDataPath, { recursive: true });
    const childEnvironment = {
      ...process.env,
      MOVIE_ELECTRON_SCROLL_URL: benchmarkUrl + "?surface=" + benchmarkSurface + "&windowing=" + mode + "&count=" + benchmarkItemCount + "&resizeObserver=" + benchmarkResizeObserver + "&profileObservers=" + benchmarkProfileObservers + (requestedScrollDistancePx === null ? "" : "&distance=" + requestedScrollDistancePx),
      MOVIE_ELECTRON_SCROLL_USER_DATA: userDataPath,
      MOVIE_ELECTRON_SCROLL_RESULT: resultPath
    };
    delete childEnvironment.ELECTRON_RUN_AS_NODE;
    electronProcess = spawn(electronExecutable, [electronMain], {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: "inherit",
      windowsHide: true
    });
    const exit = await waitForExit(electronProcess, 60_000);
    electronProcess = undefined;
    if (exit.code !== 0) throw new Error("Electron " + mode + " benchmark exited with code " + (exit.code ?? "null") + (exit.signal ? " (signal " + exit.signal + ")" : ""));
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    if (!result.ok) throw new Error(result.error ?? ("Electron " + mode + " benchmark reported failure"));
    measurements.push(result);
  }
  const windowed = measurements.find((item) => item.windowingMode === "on");
  const unwindowed = measurements.find((item) => item.windowingMode === "off");
  if (!windowed || !unwindowed) throw new Error("Benchmark did not produce both windowed and unwindowed measurements");
  const resultBundle = {
    ok: true,
    createdAt: new Date().toISOString(),
    benchmarkOrder,
    surface: benchmarkSurface,
    itemCount: benchmarkItemCount,
    requestedScrollDistancePx,
    resizeObserver: benchmarkResizeObserver,
    profileObservers: benchmarkProfileObservers,
    videoCount: benchmarkSurface === "video-grid" ? benchmarkItemCount : null,
    comparison: {
      windowedPeakMountedSlots: windowed.peakMountedSlots,
      unwindowedPeakMountedSlots: unwindowed.peakMountedSlots,
      windowedP95FrameMs: windowed.frameIntervalMs.p95,
      unwindowedP95FrameMs: unwindowed.frameIntervalMs.p95,
      windowedFramesOver33ms: windowed.framesOver33ms,
      unwindowedFramesOver33ms: unwindowed.framesOver33ms,
      windowedFramesOver50ms: windowed.framesOver50ms,
      unwindowedFramesOver50ms: unwindowed.framesOver50ms
    },
    measurements
  };
  const persistentResultPath = process.env.MOVIE_ELECTRON_SCROLL_RESULT_PATH
    ? path.resolve(process.env.MOVIE_ELECTRON_SCROLL_RESULT_PATH)
    : path.join(projectRoot, ".tmp", "electron-scroll-benchmark-latest.json");
  await mkdir(path.dirname(persistentResultPath), { recursive: true });
  await writeFile(persistentResultPath, JSON.stringify(resultBundle, null, 2) + "\n", "utf8");
  succeeded = true;
  console.log("Electron scroll benchmark OK; results saved to " + await realpath(persistentResultPath));
  console.log(JSON.stringify(resultBundle, null, 2));
} finally {
  if (electronProcess && electronProcess.exitCode === null) electronProcess.kill();
  if (viteProcess && viteProcess.exitCode === null) viteProcess.kill();
  if (succeeded) await rm(smokeRoot, { recursive: true, force: true });
  else console.error("Electron scroll benchmark diagnostics preserved at: " + smokeRoot);
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve an ephemeral port");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForServer(url, serverProcess) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error("Vite exited early with code " + serverProcess.exitCode);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error("Timed out waiting for Vite at " + url);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Electron scroll benchmark timed out after " + timeoutMs + "ms"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}
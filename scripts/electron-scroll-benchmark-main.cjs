const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const userDataPath = process.env.MOVIE_ELECTRON_SCROLL_USER_DATA;
const resultPath = process.env.MOVIE_ELECTRON_SCROLL_RESULT;
const benchmarkUrl = process.env.MOVIE_ELECTRON_SCROLL_URL;

if (!userDataPath || !resultPath || !benchmarkUrl) {
  console.error("Electron scroll benchmark environment is incomplete.");
  app.exit(2);
} else {
  mkdirSync(userDataPath, { recursive: true });
  app.setPath("userData", path.resolve(userDataPath));
  app.whenReady().then(async () => {
    let window;
    try {
      window = new BrowserWindow({
        title: "拉面影视 - 临时滚动性能测量",
        width: 1280,
        height: 800,
        show: false,
        webPreferences: {
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      await window.loadURL(benchmarkUrl);
      const parsedBenchmarkUrl = new URL(benchmarkUrl);
      const expectedSurface = parsedBenchmarkUrl.searchParams.get("surface") === "duplicate-items" ? "duplicate-items" : "video-grid";
      const expectedWindowingMode = parsedBenchmarkUrl.searchParams.get("windowing") === "off" ? "off" : "on";
      const expectedItemCount = Number(parsedBenchmarkUrl.searchParams.get("count") ?? (expectedSurface === "duplicate-items" ? 10000 : 300));
      const expectedMaximum = expectedSurface === "duplicate-items" ? 10000 : 1000;
      if (!Number.isInteger(expectedItemCount) || expectedItemCount < 1 || expectedItemCount > expectedMaximum) {
        throw new Error("Invalid benchmark item count: " + expectedItemCount);
      }
      const readyScript = [
        "new Promise((resolve, reject) => {",
        "  const started = performance.now();",
        "  const poll = () => {",
        "    const state = window.__movieScrollBenchmark;",
        "    if (state && state.ready) resolve({ itemCount: state.itemCount, slotCount: state.slotCount, surface: state.surface, windowingMode: state.windowingMode });",
        "    else if (performance.now() - started > 25000) reject(new Error('Timed out waiting for all synthetic slots'));",
        "    else setTimeout(poll, 25);",
        "  };",
        "  poll();",
        "})"
      ].join("\n");
      const ready = await window.webContents.executeJavaScript(readyScript);
      if (ready.itemCount !== expectedItemCount || ready.slotCount !== expectedItemCount || ready.surface !== expectedSurface || ready.windowingMode !== expectedWindowingMode) {
        throw new Error("Unexpected benchmark fixture: " + JSON.stringify(ready));
      }

      window.webContents.setBackgroundThrottling(false);
      window.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const metricsScript = [
        "(async () => {",
        "  const surface = new URLSearchParams(window.location.search).get('surface') === 'duplicate-items' ? 'duplicate-items' : 'video-grid';",
        "  const root = document.getElementById('scroll-root');",
        "  if (!root) throw new Error('Scroll root is missing');",
        "  const slotSelector = surface === 'duplicate-items' ? '.duplicate-item-slot' : '.video-grid-slot';",
        "  const mountedContentSelector = surface === 'duplicate-items' ? '.duplicate-item-slot[data-windowed-mounted=\"true\"] .duplicate-benchmark-row' : '.video-grid-slot[data-windowed-mounted=\"true\"] .video-card';",
        "  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));",
        "  await nextFrame();",
        "  await nextFrame();",
        "  const started = performance.now();",
        "  let previous = started;",
        "  const frameIntervals = [];",
        "  const requestedDurationMs = 3000;",
        "  const distanceParams = new URLSearchParams(window.location.search);",
        "  const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);",
        "  const distanceParam = Number(distanceParams.get('distance'));",
        "  const requestedDistancePx = distanceParams.has('distance') && Number.isFinite(distanceParam) && distanceParam > 0 ? Math.min(maxScrollTop, distanceParam) : maxScrollTop;",
        "  await new Promise((resolve) => {",
        "    const tick = (now) => {",
        "      frameIntervals.push(now - previous);",
        "      previous = now;",
        "      const progress = Math.min(1, (now - started) / requestedDurationMs);",
        "      root.scrollTop = progress * requestedDistancePx;",
        "      if (progress < 1) requestAnimationFrame(tick);",
        "      else resolve();",
        "    };",
        "    requestAnimationFrame(tick);",
        "  });",
        "  await new Promise((resolve) => setTimeout(resolve, 200));",
        "  const sorted = [...frameIntervals].sort((a, b) => a - b);",
        "  const percentile = (value) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] : null;",
        "  const state = window.__movieScrollBenchmark;",
        "  const mountedContentAtEnd = root.querySelectorAll(mountedContentSelector).length;",
        "  const actualMountedSlotsAtEnd = root.querySelectorAll(slotSelector + '[data-windowed-mounted=\"true\"]').length;",
        "  return {",
        "    surface,",
        "    fixtureItems: state?.itemCount ?? 0,",
        "    fixtureVideos: surface === 'video-grid' ? (state?.totalVideos ?? 0) : null,",
        "    totalSlots: root.querySelectorAll(slotSelector).length,",
        "    mountedCardsAtEnd: surface === 'video-grid' ? mountedContentAtEnd : null,",
        "    mountedContentAtEnd,",
        "    mountedSlotsAtEnd: state?.mountedSlots ?? 0,",
        "    actualMountedSlotsAtEnd,",
        "    mountedSlotCounterMatchesDom: (state?.mountedSlots ?? 0) === actualMountedSlotsAtEnd,",
        "    peakMountedSlots: state?.peakMountedSlots ?? 0,",
        "    observerStats: state?.observerStats ?? null,",
        "    scrollHeightPx: root.scrollHeight,",
        "    requestedScrollDistancePx: Math.round(requestedDistancePx),",
        "    actualScrollDistancePx: Math.round(root.scrollTop),",
        "    scrollVelocityPxPerSec: Number((root.scrollTop / (requestedDurationMs / 1000)).toFixed(1)),",
        "    viewportHeightPx: root.clientHeight,",
        "    finalScrollTopPx: Math.round(root.scrollTop),",
        "    sampleDurationMs: Math.round(performance.now() - started),",
        "    frameSampleCount: frameIntervals.length,",
        "    frameIntervalMs: {",
        "      median: Number((percentile(0.5) ?? 0).toFixed(2)),",
        "      p95: Number((percentile(0.95) ?? 0).toFixed(2)),",
        "      max: Number((sorted.at(-1) ?? 0).toFixed(2))",
        "    },",
        "    framesOver33ms: frameIntervals.filter((value) => value > 33).length,",
        "    framesOver50ms: frameIntervals.filter((value) => value > 50).length",
        "  };",
        "})()"
      ].join("\n");
      const metrics = await window.webContents.executeJavaScript(metricsScript);
      const result = {
        ok: true,
        measurementMode: "visible-inactive-electron-window; renderer requestAnimationFrame cadence, not a hardware-presented FPS counter; programmatic scroll, not physical wheel latency",
        surface: expectedSurface,
        itemCount: expectedItemCount,
        windowingMode: expectedWindowingMode,
        resizeObserverMode: parsedBenchmarkUrl.searchParams.get("resizeObserver") === "off" ? "off" : "on",
        observerProfileMode: parsedBenchmarkUrl.searchParams.get("profileObservers") === "on" ? "on" : "off",
        electronVersion: process.versions.electron,
        chromiumVersion: process.versions.chrome,
        ...metrics
      };
      writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
      console.log(JSON.stringify(result));
    } catch (error) {
      const result = { ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) };
      try { writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8"); } catch {}
      console.error(result.error);
      process.exitCode = 1;
    } finally {
      window?.destroy();
      app.quit();
    }
  }).catch((error) => {
    try { writeFileSync(resultPath, JSON.stringify({ ok: false, error: String(error) }, null, 2), "utf8"); } catch {}
    console.error(error);
    app.exit(1);
  });
}
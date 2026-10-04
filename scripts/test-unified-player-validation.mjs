// Short, isolated QA against the production engine. Never opens the user's database.
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, linkSync, existsSync } from "node:fs";
import { readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { EmbeddedPlayer } from "../dist-main/main/embeddedPlayer/embeddedPlayer.js";
import { createDatabase } from "../dist-main/main/db/database.js";
import { VideoRepository } from "../dist-main/main/db/videoRepository.js";

const fixtureRoot = path.resolve(process.argv.find(a => a.startsWith("--fixture-root="))?.slice(15) || "");
if (fixtureRoot === process.cwd() || !existsSync(path.join(fixtureRoot, "samples.json"))) throw Error("fixture-root-required");
const root = mkdtempSync(path.join(os.tmpdir(), "lamian-unified-validation-"));
app.setPath("userData", path.join(root, "user-data"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => { /* Wait for the test report before app.exit. */ });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, timeout = 12000) => {
  const start = performance.now();
  while (!await fn()) { if (performance.now() - start > timeout) throw Error("bounded-test-timeout"); await wait(60); }
};
const require = createRequire(import.meta.url);
const safeSamples = async () => {
  const samples = [...JSON.parse(await readFile(path.join(fixtureRoot, "samples.json"), "utf8")), ...JSON.parse(await readFile(path.join(fixtureRoot, "media-feature-samples.json"), "utf8"))];
  if (samples.length !== 5 || samples.some(s => !path.resolve(s.path).startsWith(fixtureRoot + path.sep))) throw Error("only-isolated-neutral-fixtures-allowed");
  return samples;
};

app.whenReady().then(async () => {
  const samples = await safeSamples();
  if (process.argv.includes("--seed-ui")) {
    const startupProfile = process.argv.includes("--startup-profile");
    const userData = app.getPath("userData"), media = path.join(root, "media");
    mkdirSync(media, { recursive: true }); mkdirSync(path.join(userData, "native-player"), { recursive: true });
    linkSync(path.join(fixtureRoot, "libmpv-2.dll"), path.join(userData, "native-player", "libmpv-2.dll"));
    const db = createDatabase(path.join(userData, "library.sqlite")), repo = new VideoRepository(db);
    const folder = repo.addSourceFolder(media, false), probe = require("ffprobe-static").path;
    for (const [index, s] of samples.entries()) {
      const filename = `${String(index + 1).padStart(2, "0")}-${s.name}${path.extname(s.path)}`, target = path.join(media, filename);
      await copyFile(s.path, target);
      const p = spawnSync(probe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", target], { encoding: "utf8", timeout: 10000, windowsHide: true });
      if (p.status !== 0) throw Error("fixture-probe-failed");
      const info = JSON.parse(p.stdout), v = info.streams.find(t => t.codec_type === "video"), a = info.streams.find(t => t.codec_type === "audio"), st = await stat(target);
      repo.upsertVideo({ sourceFolderId: folder.id, path: target, directory: media, filename, basename: path.parse(filename).name, extension: path.extname(filename), sizeBytes: st.size, durationMs: Math.round(Number(info.format.duration) * 1000), width: v.width, height: v.height, format: info.format.format_name, videoCodec: startupProfile ? null : v.codec_name, videoProfile: startupProfile ? null : v.profile, pixelFormat: startupProfile ? null : v.pix_fmt, audioCodec: startupProfile ? null : a?.codec_name ?? null, codecProbeStatus: startupProfile ? "unprobed" : "ready", metadataStatus: "ready", modifiedAt: st.mtime.toISOString() });
    }
    await writeFile(path.join(userData, "settings.json"), JSON.stringify({ startupSync: false, playbackPreference: startupProfile ? "embedded-first" : "auto", autoPlayOnOpen: false }));
    db.close();
    const manifest = { root, userData, media, videos: 5, isolated: true, preference: startupProfile ? "embedded-first" : "auto" };
    await writeFile(path.join(root, "ui-manifest.json"), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest)); app.exit(0); return;
  }

  const report = { root, samples: [], scenarios: [], failures: [], actualListening: "NOT RUN", cloudDrive: "NOT RUN", pass: false };
  const ledger = new Map(), invalid = path.join(root, "invalid-fixture.mkv"), absent = path.join(root, "does-not-exist.mp4");
  await writeFile(invalid, "Neutral deliberately invalid media fixture for bounded QA.");
  const repo = { getVideo: id => ({ id, path: id === "invalid" ? invalid : id === "absent" ? absent : samples.find(s => s.name === id)?.path ?? absent, isMissing: id === "marked-missing" }), recordPlayback: (id, position) => ledger.set(id, position), getPlaybackPosition: id => ledger.get(id) ?? 0 };
  const w = new BrowserWindow({ title: "拉面影视 · 隔离验证", width: 1120, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await w.loadURL("about:blank");
  const player = new EmbeddedPlayer(repo, () => w, { host: path.resolve("native-bin/NativeHost.exe"), directory: fixtureRoot });
  const event = { sender: w.webContents, senderFrame: w.webContents.mainFrame };
  let key = "", raw = [], latestRaw;
  const call = command => player.handle(event, { sessionKey: key, ...command }), state = () => call({ op: "state" });
  const attach = async () => {
    await until(() => player.child);
    raw = []; latestRaw = undefined;
    const child = player.child, lines = createInterface({ input: child.stdout });
    lines.on("line", line => { try { const s = JSON.parse(line.replace(/^\uFEFF/, "")); if (s.type === "snapshot") { latestRaw = s; if (s.loaded && s.paused === "no" && s.pausedForCache !== "yes" && s.seeking !== "yes") raw.push(s); } } catch { /* Never log raw host output. */ } });
    child.once("exit", () => lines.close()); return child;
  };
  const run = async (name, fn) => {
    const start = performance.now(), result = { name };
    try { await fn(result); result.pass = true; } catch (e) { result.pass = false; result.error = e.message; report.failures.push({ name, error: e.message }); }
    finally { await call({ op: "stop" }).catch(() => undefined); result.elapsedMs = Math.round(performance.now() - start); report.scenarios.push(result); }
  };
  try {
    for (const sample of samples) await run(sample.name, async r => {
      key = `qa-${sample.name}`; const start = performance.now();
      await call({ op: "start", videoId: sample.name, positionMs: 1000, autoplay: true }); const child = await attach();
      await call({ op: "bounds", x: 0, y: 0, width: 1000, height: 500 });
      await until(async () => { const s = await state(); if (s.phase === "failed") throw Error(s.error); return s.phase === "playing" && s.time > 1.6 && raw.length >= 5; });
      r.startMs = Math.round(performance.now() - start);
      await until(() => latestRaw?.currentAo && latestRaw?.media?.audioSamplerate > 0);
      r.audioOutput = latestRaw.currentAo; r.sampleRate = latestRaw.media.audioSamplerate;
      const sync = raw.map(s => s.avsync).filter(Number.isFinite); if (!sync.length) throw Error("avsync-not-observed");
      r.maxAbsAvSyncSeconds = Math.max(...sync.map(Math.abs)); r.syncSamples = sync.length;
      if (r.maxAbsAvSyncSeconds > .1) throw Error("short-sample-avsync-over-100ms");
      r.selectedAudioCodecs = (await state()).tracks.filter(t => t.type === "audio" && t.selected).map(t => t.codec);
      if (!r.selectedAudioCodecs.length) throw Error("audio-track-not-selected");
      await call({ op: "seek", value: 5 }); await until(async () => (await state()).time > 5.4);
      await call({ op: "pause", value: true }); await until(async () => (await state()).paused);
      if (sample.name === "dual-audio-subtitles") {
        await call({ op: "audio-track", value: 2 }); await until(async () => (await state()).tracks.some(t => t.type === "audio" && t.id === 2 && t.selected));
        await call({ op: "subtitle-track", value: 1 }); await call({ op: "seek", value: 2 });
        await until(() => latestRaw?.media?.innerFixture === true); r.embeddedSubtitleRendered = true;
        await call({ op: "subtitle-track", value: 0 }); await until(async () => !(await state()).tracks.some(t => t.type === "sub" && t.selected)); r.subtitleOff = true;
        r.audioTrack2Selected = true;
      }
      await call({ op: "stop" }); await until(() => child.exitCode !== null || child.signalCode !== null);
      r.processReleased = !player.child; if (!r.processReleased) throw Error("host-not-released");
      report.samples.push({ name: sample.name, technicalDecode: true });
    });
    for (const id of ["absent", "invalid"]) await run(id, async r => {
      key = `qa-${id}`; await call({ op: "start", videoId: id, autoplay: true }); await attach();
      let ticks = 0; const timer = setInterval(() => ticks++, 25);
      try { await until(async () => (await state()).phase === "failed"); } finally { clearInterval(timer); }
      r.errorReported = true; r.eventLoopTicks = ticks; if (ticks < 1) throw Error("event-loop-not-observed");
      await until(() => !player.child); r.processReleased = true;
      key += "-recovery"; await call({ op: "start", videoId: samples[0].name, positionMs: 2000, autoplay: false });
      await until(async () => { const s = await state(); return s.phase === "paused" && Math.abs(s.time - 2) < .4; }); r.recovered = true;
    });
    await run("host-crash-and-reopen", async r => {
      key = "qa-crash"; await call({ op: "start", videoId: samples[0].name, autoplay: true }); const child = await attach();
      await until(async () => (await state()).phase === "playing"); child.kill();
      await until(async () => (await state()).phase === "failed"); r.exitReported = true;
      key = "qa-crash-reopen"; await call({ op: "start", videoId: samples[0].name, positionMs: 2000, autoplay: false });
      await until(async () => (await state()).phase === "paused"); r.recovered = true;
    });
    await run("rapid-session-replacement", async r => {
      for (let i = 0; i < 8; i++) { key = `qa-rapid-${i}`; await call({ op: "start", videoId: samples[i % 4].name, positionMs: 2000, autoplay: false }); }
      await player.handle(event, { op: "stop", sessionKey: "qa-rapid-0" });
      await until(async () => { const s = await state(); if (s.phase === "failed") throw Error(s.error); return s.phase === "paused" && Math.abs(s.time - 2) < .4; });
      r.finalSession = (await state()).sessionKey; r.staleStopIgnored = true;
      if (r.finalSession !== "qa-rapid-7") throw Error("wrong-final-session");
      const child = player.child; await call({ op: "stop" }); await until(() => !child || child.exitCode !== null || child.signalCode !== null); r.processReleased = !player.child;
      if (!r.processReleased) throw Error("rapid-host-not-released");
    });
    report.pass = report.failures.length === 0;
  } finally { player.dispose(); await call({ op: "stop" }).catch(() => undefined); w.destroy(); await writeFile(path.join(root, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); app.exit(report.pass ? 0 : 1); }
}).catch(e => { console.error(e.message); app.exit(1); });

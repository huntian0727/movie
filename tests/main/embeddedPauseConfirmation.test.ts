import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { VideoRepository } from "../../src/main/db/videoRepository";

const runtime = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, screen: { getDisplayMatching: () => ({ scaleFactor: 1 }) } }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: runtime.spawn, default: { ...actual, spawn: runtime.spawn } };
});
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: () => true, default: { ...actual, existsSync: () => true } };
});
import { EmbeddedPlayer } from "../../src/main/embeddedPlayer/embeddedPlayer";

async function fixture(startup?: { begin(videoId: string): void; finish(videoId?: string, reason?: string): void }, buffering = false,
  subtitleGetter?: (id: string) => Promise<{ path: string | null; offsetSeconds: number; configured?: boolean }>) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null,
    signalCode: null, stdin: { writable: true, on: vi.fn(), write: vi.fn(), end: vi.fn() }, kill: vi.fn()
  });
  child.stdin.end.mockImplementation(() => child.emit("exit", 0));
  child.kill.mockImplementation(() => child.emit("exit", 0));
  runtime.spawn.mockReturnValue(child);
  const sender = { on: vi.fn(), send: vi.fn() };
  const w = { webContents: sender, setMenu: vi.fn(), on: vi.fn(), isDestroyed: () => false, isFullScreen: () => false, getContentSize: () => [1280, 720], getBounds: () => ({ x: 0, y: 0, width: 1280, height: 720 }), getNativeWindowHandle: () => Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]) } as unknown as BrowserWindow;
  const repo = { getVideo: () => ({ id: "v", path: "C:/neutral.mp4", isMissing: false }), recordPlayback: vi.fn(), getPlaybackPosition: () => 0 } as unknown as VideoRepository;
  const player = new EmbeddedPlayer(repo, () => w, { host: "host.exe", directory: "runtime" }, startup, undefined, subtitleGetter);
  const event = { sender } as unknown as IpcMainInvokeEvent;
  const emit = (value: object) => child.stdout.write(JSON.stringify(value) + "\n");
  await player.handle(event, { op: "start", videoId: "v", sessionKey: "one", autoplay: false });
  await vi.waitFor(() => expect(child.stdout.listenerCount("data")).toBeGreaterThan(0));
  emit({ type: "ready" });
  emit({ type: "snapshot", token: 1, loaded: true, time: 3, duration: 12, rotation: 0, seeking: "no", restartCount: 0, paused: "yes", pausedForCache: buffering ? "yes" : "no", volume: 20, media: null });
  const call = (op: object) => player.handle(event, { sessionKey: "one", ...op });
  await vi.waitFor(async () => expect((await call({ op: "state" })).phase).toBe(buffering ? "buffering" : "paused"));
  const commands = () => child.stdin.write.mock.calls.map(([line]) => JSON.parse(line));
  return { player, call, emit, commands, repo, event };
}

afterEach(() => { vi.useRealTimers(); runtime.spawn.mockClear(); });
describe("pause confirmation without periodic telemetry", () => {
  it("auto-loads saved subtitles with correlated acknowledgement and preserves playback", async () => {
    const getter = vi.fn(async () => ({ path: "C:/saved/Chinese.ass", offsetSeconds: 1.5 }));
    const f = await fixture(undefined, false, getter);
    try {
      await vi.waitFor(() => expect(f.commands().some(c => c.op === "subtitle-add")).toBe(true));
      const add = f.commands().find(c => c.op === "subtitle-add");
      f.emit({ type: "ack", op: add.op, token: 999, controlId: add.controlId, result: 0 });
      await Promise.resolve(); expect(f.commands().some(c => c.op === "subtitle-delay")).toBe(false);
      f.emit({ type: "ack", op: add.op, token: 1, controlId: add.controlId, result: 0 });
      await vi.waitFor(() => expect(f.commands().some(c => c.op === "subtitle-delay")).toBe(true));
      const delay = f.commands().find(c => c.op === "subtitle-delay"); expect(delay.value).toBe(1.5);
      f.emit({ type: "ack", op: delay.op, token: 1, controlId: delay.controlId, result: 0 });
      expect(await f.call({ op: "state" })).toMatchObject({ phase: "paused", time: 3, paused: true });
      expect(f.commands().filter(c => c.op === "seek" || c.op === "pause")).toHaveLength(0);
    } finally { f.player.dispose(); }
  });
  it("does not stop video when native subtitle loading fails", async () => {
    const f = await fixture(undefined, false, async () => ({ path: null, offsetSeconds: 0 }));
    try {
      const pending = f.player.applySavedSubtitle("v");
      await vi.waitFor(() => expect(f.commands().some(c => c.op === "subtitle-track")).toBe(true));
      const command = f.commands().find(c => c.op === "subtitle-track");
      f.emit({ type: "ack", op: command.op, token: 999, controlId: command.controlId, result: -1 });
      f.emit({ type: "error", op: command.op, token: 999, controlId: command.controlId });
      expect((await f.call({ op: "state" })).subtitleError).toBeUndefined();
      f.emit({ type: "ack", op: command.op, token: 1, controlId: command.controlId, result: -1 });
      await expect(pending).rejects.toThrow("加载失败");
      expect(await f.call({ op: "state" })).toMatchObject({ phase: "paused", time: 3 });
      expect((await f.call({ op: "state" })).subtitleError).toBeTruthy();
    } finally { f.player.dispose(); }
  });
  it("ignores a saved subtitle arriving after the decode session stops", async () => {
    let resolve!: (value: { path: string | null; offsetSeconds: number }) => void;
    const f = await fixture(undefined, false, () => new Promise(r => { resolve = r; }));
    try {
      await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
      await f.call({ op: "stop" }); resolve({ path: "C:/old.ass", offsetSeconds: 2 });
      await Promise.resolve(); await Promise.resolve();
      expect(f.commands().some(c => c.op === "subtitle-add")).toBe(false);
    } finally { f.player.dispose(); }
  });
  it("forwards fullscreen masks without changing video bounds and rejects full occlusion", async () => {
    const f = await fixture();
    try {
      const bounds = { op: "bounds", x: 0, y: 0, width: 1280, height: 720 };
      await f.call({ ...bounds, clipTop: 70, clipBottom: 142 });
      expect(f.commands().at(-1)).toMatchObject({ ...bounds, clipTop: 70, clipBottom: 142 });
      await f.call(bounds);
      expect(f.commands().at(-1)).toMatchObject(bounds);
      expect(f.commands().at(-1)).not.toHaveProperty("clipTop");
      const count = f.commands().length;
      await expect(f.call({ ...bounds, clipTop: 600, clipBottom: 120 })).rejects.toThrow("遮罩");
      await expect(f.call({ ...bounds, width: 1283 })).rejects.toThrow("窗口边界");
      expect(f.commands()).toHaveLength(count);
    } finally { f.player.dispose(); }
  });
  it("does not overwrite the stopped video's saved position when a new session starts or is disposed", async () => {
    const f = await fixture();
    try {
      expect(vi.mocked(f.repo.recordPlayback).mock.calls.at(-1)).toEqual(["v", 3000]);
      await f.call({ op: "stop" });
      const writes = vi.mocked(f.repo.recordPlayback).mock.calls.length;
      await f.player.handle(f.event, { op: "start", videoId: "v", sessionKey: "two", autoplay: false, positionMs: 3000 });
      expect(vi.mocked(f.repo.recordPlayback).mock.calls.length).toBe(writes);
      expect(vi.mocked(f.repo.recordPlayback).mock.calls.at(-1)).toEqual(["v", 3000]);
    } finally { f.player.dispose(); }
  });
  it("does not flush the idle state's zero position after stopping", async () => {
    const f = await fixture();
    await f.call({ op: "stop" });
    const writes = vi.mocked(f.repo.recordPlayback).mock.calls.length;
    f.player.dispose();
    expect(vi.mocked(f.repo.recordPlayback).mock.calls.length).toBe(writes);
    expect(vi.mocked(f.repo.recordPlayback).mock.calls.at(-1)).toEqual(["v", 3000]);
  });
  it("retains muted volume across replacement decode sessions", async () => {
    const f = await fixture();
    try {
      await f.call({ op: "volume", value: 0 });
      const started = await f.player.handle(f.event, { op: "start", videoId: "v", sessionKey: "two", autoplay: false });
      expect(started.volume).toBe(0);
      await vi.waitFor(() => expect(runtime.spawn).toHaveBeenCalledTimes(2));
      f.emit({ type: "ready" });
      await vi.waitFor(() => expect(f.commands().filter(c => c.op === "load").at(-1)).toMatchObject({ volume: 0, token: 2 }));
    } finally { f.player.dispose(); }
  });
  it("does not repeatedly write unchanged paused playback history", async () => {
    const f = await fixture();
    try {
      const writes = vi.mocked(f.repo.recordPlayback).mock.calls.length;
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now + 6000);
      f.emit({ type: "snapshot", token: 1, loaded: true, time: 3, duration: 12, rotation: 0, seeking: "no", restartCount: 0, paused: "yes", pausedForCache: "no", volume: 20, media: null });
      expect(vi.mocked(f.repo.recordPlayback).mock.calls.length).toBe(writes);
      await f.call({ op: "stop" });
      expect(vi.mocked(f.repo.recordPlayback).mock.calls.length).toBe(writes);
    } finally { vi.restoreAllMocks(); f.player.dispose(); }
  });
  it("keeps priority until initial buffering ends and releases it on stop", async () => {
    const startup = { begin: vi.fn(), finish: vi.fn() };
    const f = await fixture(startup, true);
    try {
      expect(startup.finish).not.toHaveBeenCalled();
      f.emit({ type: "snapshot", token: 999, loaded: true });
      await f.call({ op: "state" });
      expect(startup.finish).not.toHaveBeenCalled();
      await f.call({ op: "stop" });
      expect(startup.finish).toHaveBeenCalledWith("v", "stopped");
    } finally { f.player.dispose(); }
  });
  it("releases startup priority once on decode readiness and ignores obsolete telemetry", async () => {
    const startup = { begin: vi.fn(), finish: vi.fn() };
    const f = await fixture(startup);
    try {
      expect(startup.begin).toHaveBeenCalledWith("v");
      expect(startup.finish).toHaveBeenCalledTimes(1);
      expect(startup.finish).toHaveBeenCalledWith("v", "decode_ready");
      f.emit({ type: "snapshot", token: 999, loaded: true });
      await f.call({ op: "state" });
      expect(startup.finish).toHaveBeenCalledTimes(1);
    } finally { f.player.dispose(); }
  });
  it("waits for the matching native acknowledgement and returns actual pause state immediately", async () => {
    const f = await fixture();
    try {
      let settled = false;
      const result = f.call({ op: "pause", value: false }).then(s => { settled = true; return s; });
      const command = f.commands().at(-1);
      f.emit({ type: "ack", op: "pause", result: 0, token: 999, controlId: command.controlId, paused: "no" });
      await Promise.resolve(); expect(settled).toBe(false);
      f.emit({ type: "ack", op: "pause", result: 0, token: 1, controlId: command.controlId, paused: "no" });
      expect(await result).toMatchObject({ paused: false, phase: "playing", time: 3 });
    } finally { f.player.dispose(); }
  });
  it("correlates rapid requests rather than returning an optimistic state", async () => {
    const f = await fixture();
    try {
      const resume = f.call({ op: "pause", value: false });
      const pause = f.call({ op: "pause", value: true });
      const commands = f.commands().filter(c => c.op === "pause");
      expect(commands[0].controlId).not.toBe(commands[1].controlId);
      f.emit({ type: "ack", op: "pause", result: 0, token: 1, controlId: commands[0].controlId, paused: "no" });
      expect((await resume).paused).toBe(false);
      f.emit({ type: "ack", op: "pause", result: 0, token: 1, controlId: commands[1].controlId, paused: "yes" });
      expect((await pause).paused).toBe(true);
    } finally { f.player.dispose(); }
  });
  it("rejects a mismatched property instead of claiming pause succeeded", async () => {
    const f = await fixture();
    try {
      const result = f.call({ op: "pause", value: false });
      const rejection = expect(result).rejects.toThrow("未完成");
      f.emit({ type: "ack", op: "pause", result: 0, token: 1, controlId: f.commands().at(-1).controlId, paused: "yes" });
      await rejection;
      expect((await f.call({ op: "state" })).paused).toBe(true);
    } finally { f.player.dispose(); }
  });
  it("bounds waits and cancels pending controls when the session stops", async () => {
    const f = await fixture();
    try {
      vi.useFakeTimers();
      const timed = expect(f.call({ op: "pause", value: false })).rejects.toThrow("超时");
      await vi.advanceTimersByTimeAsync(3000); await timed;
      const stopped = expect(f.call({ op: "pause", value: false })).rejects.toThrow("会话已结束");
      await f.call({ op: "stop" }); await stopped;
    } finally { f.player.dispose(); }
  });
});

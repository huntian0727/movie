import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { VideoRepository } from "../../src/main/db/videoRepository";

const runtime = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, screen: {} }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: runtime.spawn, default: { ...actual, spawn: runtime.spawn } };
});
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: () => true, default: { ...actual, existsSync: () => true } };
});
import { EmbeddedPlayer } from "../../src/main/embeddedPlayer/embeddedPlayer";

async function fixture(startup?: { begin(videoId: string): void; finish(videoId?: string, reason?: string): void }, buffering = false) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null,
    signalCode: null, stdin: { writable: true, on: vi.fn(), write: vi.fn(), end: vi.fn() }, kill: vi.fn()
  });
  child.stdin.end.mockImplementation(() => child.emit("exit", 0));
  child.kill.mockImplementation(() => child.emit("exit", 0));
  runtime.spawn.mockReturnValue(child);
  const sender = { on: vi.fn(), send: vi.fn() };
  const w = { webContents: sender, setMenu: vi.fn(), on: vi.fn(), isDestroyed: () => false, isFullScreen: () => false, getNativeWindowHandle: () => Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]) } as unknown as BrowserWindow;
  const repo = { getVideo: () => ({ id: "v", path: "C:/neutral.mp4", isMissing: false }), recordPlayback: vi.fn(), listPlayHistory: () => [] } as unknown as VideoRepository;
  const player = new EmbeddedPlayer(repo, () => w, { host: "host.exe", directory: "runtime" }, startup);
  const event = { sender } as unknown as IpcMainInvokeEvent;
  const emit = (value: object) => child.stdout.write(JSON.stringify(value) + "\n");
  await player.handle(event, { op: "start", videoId: "v", sessionKey: "one", autoplay: false });
  await vi.waitFor(() => expect(child.stdout.listenerCount("data")).toBeGreaterThan(0));
  emit({ type: "ready" });
  emit({ type: "snapshot", token: 1, loaded: true, time: 3, duration: 12, rotation: 0, seeking: "no", restartCount: 0, paused: "yes", pausedForCache: buffering ? "yes" : "no", volume: 20, media: null });
  const call = (op: object) => player.handle(event, { sessionKey: "one", ...op });
  await vi.waitFor(async () => expect((await call({ op: "state" })).phase).toBe(buffering ? "buffering" : "paused"));
  const commands = () => child.stdin.write.mock.calls.map(([line]) => JSON.parse(line));
  return { player, call, emit, commands };
}

afterEach(() => { vi.useRealTimers(); runtime.spawn.mockClear(); });
describe("pause confirmation without periodic telemetry", () => {
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

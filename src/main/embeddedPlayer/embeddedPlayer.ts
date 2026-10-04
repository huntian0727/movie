import { BrowserWindow, dialog, screen, type IpcMainInvokeEvent } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { VideoRepository } from "../db/videoRepository.js";
import { embeddedInputSchema, embeddedRequestSchema, type EmbeddedState } from "../../shared/embeddedPlayback.js";
import { EmbeddedControlQueue, type NativeSnapshot } from "./controlQueue.js";
import { getShortcutCode } from "../../shared/shortcuts.js";
import type { StructuredLogger } from "../logging/logger.js";

const snapshotSchema = z.object({
  token: z.number().int(), loaded: z.boolean(), time: z.number().finite().nullable(), duration: z.number().finite().nullable(),
  rotation: z.number().nullable(), seeking: z.string().nullable(), restartCount: z.number().int(), paused: z.string().nullable(),
  pausedForCache: z.string().nullable(), volume: z.number().nullable(),
  media: z.object({ tracks: z.array(z.object({ type: z.string().nullable(), id: z.number().nullable(), selected: z.string().nullable(), codec: z.string().nullable() })).max(16) }).nullable()
});
export function initialEmbeddedState(sessionKey = ""): EmbeddedState {
  return { sessionKey, phase: "idle", time: 0, duration: 0, paused: true, volume: 20, rotation: 0, fullscreen: false, tracks: [] };
}

/** Trusted player window only. Renderer never supplies files, handles, DLL locations or native commands. */
export class EmbeddedPlayer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private state = initialEmbeddedState();
  private snapshot: NativeSnapshot | null = null;
  private window: BrowserWindow | null = null;
  private videoId: string | null = null;
  private token = 0;
  private work: Promise<void> = Promise.resolve();
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastMessage = 0;
  private waitingSince = 0;
  private savedAt = 0;
  private savedPosition: { videoId: string; positionMs: number } | null = null;
  private preferredVolume = 20;
  private closing = false;
  private bounds: object | null = null;
  private visible = true;
  private pauseControlId = 0;
  private startupStartedAt = 0;
  private startupVideoId: string | null = null;
  private pendingPauses = new Map<number, { token: number; value: boolean; resolve(state: EmbeddedState): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private queue = new EmbeddedControlQueue(() => this.snapshot, c => this.send(c), (failed, busy) => {
    if (failed) this.fail("跳转或旋转超时，请重试或改用原播放器");
    else if (busy) this.state.phase = "reading";
  });
  constructor(private repo: VideoRepository, private playerWindow: () => BrowserWindow | null, private runtime: { host: string; directory: string },
    private readonly startup?: { begin(videoId: string): void; finish(videoId?: string, reason?: string): void },
    private readonly logger?: StructuredLogger) {
    process.once("exit", () => this.child?.kill());
  }
  async handle(event: IpcMainInvokeEvent, payload: unknown): Promise<EmbeddedState> {
    const w = this.playerWindow();
    if (!w || w.webContents !== event.sender) throw new Error("内嵌播放仅允许当前播放窗口调用");
    const request = embeddedRequestSchema.parse(payload);
    // Fullscreen belongs to the trusted window, not the active decode session.
    if (request.op === "window-state") return { ...initialEmbeddedState(request.sessionKey), fullscreen: w.isFullScreen() };
    if (request.op === "fullscreen") {
      w.setFullScreen(request.value);
      return { ...this.state, sessionKey: request.sessionKey, fullscreen: request.value };
    }
    if (request.op === "start") {
      const session = this.repo.getVideo(request.videoId);
      if (session.isMissing) throw new Error("资料库标记文件缺失，请先复查可访问性");
      this.startup?.begin(session.id);
      this.startupStartedAt = Date.now(); this.startupVideoId = session.id;
      const key = request.sessionKey;
      this.bounds = null; this.visible = true;
      this.cancelPauses();
      this.savePosition(); this.videoId = null; this.queue.reset(); this.snapshot = null;
      this.state = { ...initialEmbeddedState(key), volume: this.preferredVolume, phase: "loading" };
      this.send({ op: "quit" });
      const generation = ++this.token;
      this.work = this.work.catch(() => undefined).then(async () => {
        await this.stopHost();
        if (generation !== this.token || this.state.sessionKey !== key) return;
        this.window = w; this.videoId = session.id; this.closing = false;
        try {
          const resume = request.positionMs ?? this.repo.getPlaybackPosition(session.id);
          this.state.time = resume / 1000;
          await this.startHost(w, generation, session.path, resume, request.autoplay);
        }
        catch { if (generation === this.token) this.fail("内嵌 MPV 启动失败：请确认本机运行库已配置，或退回原播放器"); }
      });
      return { ...this.state };
    }
    // Late unmounts and polling must not stop or observe a replacement playback session.
    if (request.sessionKey !== this.state.sessionKey) return initialEmbeddedState(request.sessionKey);
    if (request.op === "state") return { ...this.state, fullscreen: w.isFullScreen() };
    if (request.op === "stop") {
      this.finishStartup("stopped"); this.cancelPauses(); ++this.token; this.savePosition();
      // The idle state's time is not the stopped video's playback position.
      // Detach it before a later start/dispose flush can overwrite saved progress.
      this.videoId = null; this.snapshot = null; this.state = initialEmbeddedState();
      this.queue.reset(); await this.stopHost(); return this.state;
    }
    if (request.op === "bounds") {
      const [width, height] = w.getContentSize();
      const scale = screen.getDisplayMatching(w.getBounds()).scaleFactor;
      if (request.x + request.width > width * scale + 2 || request.y + request.height > height * scale + 2) throw new Error("视频画面超出窗口边界");
      if ((request.clipTop ?? 0) + (request.clipBottom ?? 0) >= request.height) throw new Error("视频遮罩超出画面边界");
      this.bounds = request; this.send(request); return this.state;
    }
    if (request.op === "visible") { this.visible = request.value; this.send(request); return this.state; }
    if (!this.snapshot?.loaded || this.state.phase === "failed") throw new Error("视频尚未就绪，请稍候或重试");
    if (request.op === "pause") return this.pause(request.value);
    if (request.op === "subtitle-file") {
      const key = this.state.sessionKey;
      const result = await dialog.showOpenDialog(w, { title: "选择外挂 SRT 字幕", filters: [{ name: "SRT 字幕", extensions: ["srt"] }], properties: ["openFile"] });
      if (!result.canceled && result.filePaths[0] && key === this.state.sessionKey) this.send({ op: "subtitle-add", path: result.filePaths[0] });
    } else if (request.op === "seek" || request.op === "rotate") {
      if (request.op === "rotate" && ![0, 90, 180, 270].includes(request.value)) throw new Error("旋转角度无效");
      this.queue.request(request.op, request.value);
    } else {
      if (request.op === "volume" && request.value > 100) throw new Error("音量无效");
      if (request.op === "volume") this.preferredVolume = request.value;
      if ((request.op === "audio-track" || request.op === "subtitle-track") && (!Number.isInteger(request.value) || request.value > 128)) throw new Error("轨道无效");
      this.send(request);
    }
    return this.state;
  }
  private send(command: object): void {
    if (this.child?.stdin.writable && this.child.exitCode === null && this.child.signalCode === null) this.child.stdin.write(JSON.stringify(command) + "\n");
  }
  private pause(value: boolean): Promise<EmbeddedState> {
    if (!this.child?.stdin.writable || this.pendingPauses.size >= 64) return Promise.reject(new Error("播放控制暂不可用，请重试"));
    const controlId = ++this.pauseControlId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPauses.delete(controlId); reject(new Error("播放暂停控制超时，请重试"));
      }, 3000);
      this.pendingPauses.set(controlId, { token: this.token, value, resolve, reject, timer });
      this.send({ op: "pause", value, controlId });
    });
  }
  private acknowledgePause(value: { controlId?: number; token?: number; result?: number; paused?: string }): void {
    const pending = this.pendingPauses.get(value.controlId ?? -1);
    if (!pending || value.token !== pending.token || value.token !== this.token) return;
    this.pendingPauses.delete(value.controlId!); clearTimeout(pending.timer);
    if (value.result !== 0 || value.paused !== (pending.value ? "yes" : "no")) {
      pending.reject(new Error("播放暂停控制未完成，请重试")); return;
    }
    const paused = value.paused === "yes";
    this.state = { ...this.state, paused, phase: ["playing", "paused"].includes(this.state.phase) ? paused ? "paused" : "playing" : this.state.phase };
    pending.resolve({ ...this.state });
  }
  private cancelPauses(): void {
    for (const pending of this.pendingPauses.values()) { clearTimeout(pending.timer); pending.reject(new Error("播放会话已结束")); }
    this.pendingPauses.clear();
  }
  private async startHost(w: BrowserWindow, generation: number, file: string, resume: number, autoplay: boolean): Promise<void> {
    if (process.platform !== "win32" || !existsSync(this.runtime.host) || !existsSync(path.join(this.runtime.directory, "libmpv-2.dll"))) throw new Error("runtime-unavailable");
    w.setMenu(null);
    const child = spawn(this.runtime.host, [w.getNativeWindowHandle().readBigUInt64LE().toString(), this.runtime.directory, "auto-safe", "media-features"], { windowsHide: true, stdio: "pipe" });
    this.child = child; this.lastMessage = Date.now(); this.waitingSince = Date.now();
    child.stdin.on("error", () => undefined); child.stderr.on("data", () => undefined);
    const lines = createInterface({ input: child.stdout });
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("host-ready-timeout")), 10_000);
      lines.on("line", line => {
        if (generation !== this.token || this.child !== child || line.length > 65536) return;
        try {
          const value = JSON.parse(line.replace(/^\uFEFF/, "")); this.lastMessage = Date.now();
          if (value.type === "ready") {
            this.logger?.info({ module: "media.playback", event: "embedded_host_ready", durationMs: Date.now() - this.startupStartedAt });
            clearTimeout(timeout); if (this.bounds) this.send(this.bounds); this.send({ op: "visible", value: this.visible }); this.send({ op: "load", token: generation, path: file, paused: !autoplay, start: resume / 1000, volume: this.preferredVolume }); resolve();
          } else if (value.type === "input") {
            const input = embeddedInputSchema.safeParse(value.input);
            if (input.success && !w.isDestroyed()) {
              w.webContents.send("player:embedded-input", input.data);
            }
          } else if (value.type === "snapshot" && value.token === generation) this.observe(snapshotSchema.parse(value));
          else if (value.type === "ack") { if (value.op === "pause") this.acknowledgePause(value); this.queue.acknowledge(value.op, value.result); if (value.result < 0) this.fail("播放控制失败，可重试或改用原播放器"); }
          else if (value.type === "ended" && value.token === generation) {
            this.finishStartup("ended");
            this.cancelPauses(); this.savePosition(); this.queue.reset(); this.snapshot = null;
            if (value.error < 0) this.fail("文件读取或解码失败，请重试或改用原播放器"); else this.state.phase = "ended";
          } else if (value.type === "fatal" || value.type === "error") this.fail("内嵌播放发生异常，可改用原播放器");
        } catch { /* Drop native output and paths rather than forwarding it or logging user media. */ }
      });
      child.once("error", () => { clearTimeout(timeout); reject(new Error("host-spawn-failed")); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("host-exited")); });
    });
    child.once("exit", () => {
      lines.close();
      if (this.child === child) { this.child = null; if (!this.stopping && !this.closing && generation === this.token) this.fail("播放进程已退出，请重试或使用原播放器"); }
    });
    if (!(w as BrowserWindow & { embeddedCloseHook?: boolean }).embeddedCloseHook) {
      (w as BrowserWindow & { embeddedCloseHook?: boolean }).embeddedCloseHook = true;
      w.on("close", event => {
        if (!this.child || this.closing) return;
        event.preventDefault(); this.dispose(); void this.stopHost().finally(() => { if (!w.isDestroyed()) w.close(); });
      });
      w.webContents.on("before-input-event", (_event, input) => {
        // A Chromium HWND can have OS focus without a focused DOM control after
        // native playback. Deliver one typed event to the original shortcut UI.
        if (!this.child || input.type !== "keyDown" || input.isAutoRepeat || input.meta) return;
        const parsed = embeddedInputSchema.safeParse({ kind: "key", code: getShortcutCode(input), control: input.control, shift: input.shift, alt: input.alt });
        if (parsed.success && !(input.alt && input.code === "F4")) {
          w.webContents.send("player:embedded-input", parsed.data);
        }
      });
    }
    this.watchdog = setInterval(() => {
      if (generation !== this.token || this.state.phase === "failed") return;
      if (Date.now() - this.lastMessage > 10_000 || this.waitingSince && Date.now() - this.waitingSince > 30_000) this.fail("读取等待超时，请重试或使用原播放器");
    }, 500);
    await ready;
  }
  private observe(s: z.infer<typeof snapshotSchema>): void {
    this.snapshot = s; this.queue.observe(s);
    if (this.state.phase === "failed" || this.state.phase === "ended") return;
    const waiting = !s.loaded || s.seeking === "yes" || s.pausedForCache === "yes";
    if (!waiting) this.finishStartup("decode_ready");
    this.waitingSince = waiting ? this.waitingSince || Date.now() : 0;
    this.state = { ...this.state, time: Math.max(0, s.time ?? this.state.time), duration: s.duration ?? this.state.duration,
      paused: s.paused === "yes", volume: s.volume ?? 20, rotation: s.rotation ?? 0,
      phase: !s.loaded ? "loading" : s.pausedForCache === "yes" ? "buffering" : s.seeking === "yes" || this.queue.busy ? "reading" : s.paused === "yes" ? "paused" : "playing",
      tracks: (s.media?.tracks ?? []).flatMap(t => (t.type === "audio" || t.type === "sub") && t.id !== null ? [{ type: t.type, id: t.id, selected: t.selected === "yes", codec: t.codec ?? "未知" }] : []) };
    if (s.loaded && Date.now() - this.savedAt > 5000) this.savePosition();
  }
  private savePosition(): void {
    if (!this.videoId) return;
    const positionMs = Math.max(0, Math.trunc(this.state.time * 1000));
    this.savedAt = Date.now();
    if (this.savedPosition?.videoId === this.videoId && this.savedPosition.positionMs === positionMs) return;
    try { this.repo.recordPlayback(this.videoId, positionMs); this.savedPosition = { videoId: this.videoId, positionMs }; } catch { /* Deleted records cannot be recreated. */ }
  }
  private fail(message: string): void {
    this.finishStartup("failed");
    this.cancelPauses();
    this.savePosition(); this.queue.reset(); this.snapshot = null; this.state = { ...this.state, phase: "failed", error: message };
    void this.stopHost();
  }
  private stopping: Promise<void> | null = null;
  private stopHost(): Promise<void> {
    if (this.stopping) return this.stopping;
    clearInterval(this.watchdog); this.watchdog = undefined;
    const c = this.child; if (!c || c.exitCode !== null || c.signalCode !== null) return Promise.resolve();
    this.stopping = new Promise<void>(resolve => {
      const timer = setTimeout(() => c.kill(), 4000);
      const hard = setTimeout(() => { c.kill(); resolve(); }, 8000);
      c.once("exit", () => { clearTimeout(timer); clearTimeout(hard); resolve(); });
      c.stdin.end(JSON.stringify({ op: "quit" }) + "\n");
    }).finally(() => { if (this.child === c) this.child = null; this.stopping = null; });
    return this.stopping;
  }
  private finishStartup(reason: string): void {
    if (!this.startupVideoId) return;
    this.startup?.finish(this.startupVideoId, reason);
    this.logger?.info({ module: "media.playback", event: "embedded_startup_settled",
      durationMs: Date.now() - this.startupStartedAt, context: { reason } });
    this.startupVideoId = null;
  }
  dispose(): void { this.finishStartup("closed"); this.cancelPauses(); this.savePosition(); this.videoId = null; this.closing = true; ++this.token; this.queue.reset(); clearInterval(this.watchdog); void this.stopHost(); }
}

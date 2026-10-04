// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { playerTimelinePreviewSchema } from "../../src/shared/playerTimelinePreview";
import type { VideoRecord } from "../../src/shared/videoTypes";

const runtime = vi.hoisted(() => ({ windows: [] as any[], load: () => Promise.resolve() }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Preview extends EventEmitter {
    destroyed = false;
    options: any;
    readonly webContents = Object.assign(new EventEmitter(), { id: 1234, mainFrame: { url: "http://127.0.0.1:5173/" }, isDestroyed: () => this.destroyed, setWindowOpenHandler: vi.fn(), setZoomFactor: vi.fn(), send: vi.fn() });
    constructor(options: any) { super(); this.options = options; runtime.windows.push(this); }
    setMenu = vi.fn(); setIgnoreMouseEvents = vi.fn(); setBounds = vi.fn(); showInactive = vi.fn(); hide = vi.fn();
    loadURL = vi.fn(() => runtime.load()); loadFile = vi.fn(() => runtime.load());
    isDestroyed = () => this.destroyed;
    destroy = vi.fn(() => { this.destroyed = true; this.webContents.emit("destroyed"); });
  }
  return { BrowserWindow: Preview, screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) } };
});
import { PlayerTimelinePreview, timelinePreviewBounds } from "../../src/main/playerTimelinePreview";

const video = { id: "v1", width: 1920, height: 1080, durationMs: 90000, updatedAt: "v1" } as VideoRecord;
function setup() {
  runtime.windows.length = 0; runtime.load = () => Promise.resolve();
  const parent = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1 }),
    isDestroyed: () => false, isVisible: () => true, isFocused: () => true,
    getContentBounds: () => ({ x: 100, y: 100, width: 1000, height: 600 }),
    getBounds: () => ({ x: 100, y: 70, width: 1000, height: 630 }), setBounds: vi.fn()
  });
  const controller = new PlayerTimelinePreview(parent as never, { currentDir: "app", isPackaged: false, devServerUrl: "http://127.0.0.1:5173/" });
  return { parent, controller };
}
describe("floating player timeline preview", () => {
  it("rejects arbitrary URL, non-finite coordinates and negative times", () => {
    expect(playerTimelinePreviewSchema.parse(null)).toBeNull();
    const input = { videoId: "v1", timeMs: 45000, x: 500, y: 550 };
    expect(playerTimelinePreviewSchema.parse(input)).toEqual(input);
    expect(() => playerTimelinePreviewSchema.parse({ ...input, url: "https://example.com/" })).toThrow();
    expect(() => playerTimelinePreviewSchema.parse({ ...input, x: NaN })).toThrow();
    expect(() => playerTimelinePreviewSchema.parse({ ...input, timeMs: -1 })).toThrow();
  });
  it("clamps previews to the player/display edges including negative screen coordinates", () => {
    const content = { x: -1600, y: 100, width: 1000, height: 600 }, display = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(timelinePreviewBounds(content, display, 0, 550, 160, 112)).toEqual({ x: -1600, y: 538, width: 160, height: 112 });
    expect(timelinePreviewBounds(content, display, 1000, 550, 160, 112).x).toBe(-760);
    expect(timelinePreviewBounds(content, display, 500, 0, 160, 112).y).toBe(100);
  });
  it("preserves cache-only policy across the owned preview window boundary", async () => {
    const { controller } = setup();
    await controller.update({ videoId: "v1", timeMs: 45000, x: 500, y: 550, cachedOnly: true }, video);
    expect(runtime.windows[0].webContents.send).toHaveBeenLastCalledWith("player:timeline-preview", expect.objectContaining({ cachedOnly: true }));
    await controller.update({ videoId: "v1", timeMs: 45000, x: 500, y: 550 }, video);
    expect(runtime.windows[0].webContents.send.mock.calls.at(-1)[1]).not.toHaveProperty("cachedOnly");
    controller.close();
  });
  it("only moves the owned click-through preview, never the player, and reuses one window", async () => {
    const { parent, controller } = setup();
    await controller.update({ videoId: "v1", timeMs: 45000, x: 500, y: 550 }, video);
    const window = runtime.windows[0];
    expect(window.options).toMatchObject({ parent, frame: false, transparent: true, focusable: false, skipTaskbar: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    expect(window.setBounds).toHaveBeenCalledWith({ x: 520, y: 538, width: 160, height: 112 });
    expect(window.webContents.send).toHaveBeenCalledWith("player:timeline-preview", { url: "local-video://preview/v1/45000?v=v1", timeMs: 45000, imageHeight: 90 });
    expect(parent.setBounds).not.toHaveBeenCalled();
    await controller.update({ videoId: "v1", timeMs: 60000, x: 700, y: 550 }, video);
    expect(runtime.windows).toHaveLength(1);
    expect(window.showInactive).toHaveBeenCalledTimes(2);
    controller.close();
  });
  it("does not resurrect the preview when the pointer leaves during initial loading", async () => {
    const { controller } = setup(); let finish!: () => void;
    runtime.load = () => new Promise<void>(resolve => { finish = resolve; });
    const pending = controller.update({ videoId: "v1", timeMs: 45000, x: 500, y: 550 }, video);
    controller.hide(); finish(); await pending;
    expect(runtime.windows[0].showInactive).not.toHaveBeenCalled();
    controller.close();
  });
  it("hides on player blur/move/minimize and destroys the overlay on close", async () => {
    const { parent, controller } = setup();
    await controller.update({ videoId: "v1", timeMs: 45000, x: 500, y: 550 }, video);
    const window = runtime.windows[0];
    for (const event of ["blur", "move", "resize", "minimize", "enter-full-screen"]) parent.emit(event);
    expect(window.hide).toHaveBeenCalledTimes(5);
    expect(window.webContents.send).toHaveBeenLastCalledWith("player:timeline-preview", null);
    parent.emit("closed");
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(parent.listenerCount("blur")).toBe(0);
    await controller.update({ videoId: "v1", timeMs: 45000, x: 500, y: 550 }, video);
    expect(runtime.windows).toHaveLength(1);
  });
});

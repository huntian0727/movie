import { describe, it, expect, vi } from "vitest";
import type { IpcMainInvokeEvent, BrowserWindow } from "electron";
import type { VideoRepository } from "../../src/main/db/videoRepository";
vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, screen: {} }));
import { EmbeddedPlayer } from "../../src/main/embeddedPlayer/embeddedPlayer";

function fixture() {
  const sender = {};
  let fullscreen = false;
  const setFullScreen = vi.fn((value: boolean) => { fullscreen = value; });
  const w = { webContents: sender, isFullScreen: () => fullscreen, setFullScreen } as unknown as BrowserWindow;
  const repo = { getVideo: vi.fn(() => ({ id: "v", path: "unused.mp4", isMissing: false })), recordPlayback: vi.fn(), listPlayHistory: () => [] } as unknown as VideoRepository;
  const player = new EmbeddedPlayer(repo, () => w, { host: "does-not-exist.exe", directory: "missing-runtime" });
  const event = { sender } as IpcMainInvokeEvent;
  return { player, repo, event, setFullScreen };
}
describe("production embedded service boundary", () => {
  it("controls the player window before and after decode sessions without opening media", async () => {
    const f = fixture();
    expect((await f.player.handle(f.event, { op: "window-state", sessionKey: "window" })).fullscreen).toBe(false);
    await f.player.handle(f.event, { op: "fullscreen", sessionKey: "window", value: true });
    expect((await f.player.handle(f.event, { op: "window-state", sessionKey: "window" })).fullscreen).toBe(true);
    await f.player.handle(f.event, { op: "stop", sessionKey: "stale" });
    await f.player.handle(f.event, { op: "fullscreen", sessionKey: "window", value: false });
    expect(f.setFullScreen.mock.calls).toEqual([[true], [false]]);
    expect(f.repo.getVideo).not.toHaveBeenCalled(); f.player.dispose();
  });
  it("rejects another renderer before looking up any video", async () => {
    const f = fixture();
    await expect(f.player.handle({ sender: {} } as IpcMainInvokeEvent, { op: "start", videoId: "v", sessionKey: "a", autoplay: true })).rejects.toThrow("当前播放窗口");
    expect(f.repo.getVideo).not.toHaveBeenCalled(); f.player.dispose();
  });
  it("rejects a known missing record without launching native playback", async () => {
    const f = fixture(); vi.mocked(f.repo.getVideo).mockReturnValue({ id: "v", isMissing: true } as never);
    await expect(f.player.handle(f.event, { op: "start", videoId: "v", sessionKey: "a", autoplay: true })).rejects.toThrow("文件缺失");
    expect((await f.player.handle(f.event, { op: "state", sessionKey: "a" })).phase).toBe("idle"); f.player.dispose();
  });
  it("reports missing runtime and ignores a stale stop", async () => {
    const f = fixture();
    await f.player.handle(f.event, { op: "start", videoId: "v", sessionKey: "new", autoplay: true });
    await vi.waitFor(async () => expect((await f.player.handle(f.event, { op: "state", sessionKey: "new" })).phase).toBe("failed"));
    await f.player.handle(f.event, { op: "stop", sessionKey: "old" });
    const s = await f.player.handle(f.event, { op: "state", sessionKey: "new" });
    expect(s.phase).toBe("failed"); expect(s.error).toContain("本机运行库");
    expect((await f.player.handle(f.event, { op: "stop", sessionKey: "new" })).phase).toBe("idle"); f.player.dispose();
  });
});

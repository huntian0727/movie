import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PlayerPage } from "../../src/renderer/components/PlayerPage";
import type { VideoRecord } from "../../src/shared/videoTypes";
import type { EmbeddedInput, EmbeddedRequest, EmbeddedState } from "../../src/shared/embeddedPlayback";
const video = { id: "v1", filename: "测试.mp4", path: "D:/test/测试.mp4", directory: "D:/test", extension: ".mp4", durationMs: 90000, sizeBytes: 1024, width: 1920, height: 1080, modifiedAt: "2026-10-03", importedAt: "2026-10-03", metadataStatus: "ready", codecProbeStatus: "ready" } as VideoRecord;
function bridge() {
  let input: (event: EmbeddedInput) => void = () => undefined;
  let state: EmbeddedState = { sessionKey: "", phase: "paused", time: 30, duration: 90, paused: true, volume: 20, rotation: 0, fullscreen: false, tracks: [] };
  const unsubscribe = vi.fn();
  const api = {
    embeddedPlayback: vi.fn(async (request: EmbeddedRequest) => {
      if (request.op === "fullscreen") state = { ...state, fullscreen: request.value };
      return { ...state, sessionKey: request.sessionKey };
    }),
    subscribeEmbeddedInput: vi.fn(listener => { input = listener; return unsubscribe; })
  };
  return { api, unsubscribe, input: (e: EmbeddedInput) => input(e), update: (next: Partial<EmbeddedState>) => { state = { ...state, ...next }; } };
}
describe("original player UI with embedded engine", () => {
  it("updates play/pause from confirmation without waiting for the next poll", async () => {
    const b = bridge();
    b.api.embeddedPlayback.mockImplementation(async r => ({ sessionKey: r.sessionKey, phase: r.op === "pause" && !r.value ? "playing" : "paused", paused: r.op !== "pause" || r.value, time: 30, duration: 90, volume: 20, rotation: 0, fullscreen: false, tracks: [] }));
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" />);
    await screen.findByText("已暂停");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "播放" })));
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "暂停" })));
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    view.unmount();
  });
  it("alternates rapid requests before confirmation and ignores late responses", async () => {
    const b = bridge();
    const original = b.api.embeddedPlayback.getMockImplementation()!;
    const replies: Array<() => void> = [];
    b.api.embeddedPlayback.mockImplementation(r => r.op !== "pause" ? original(r) : new Promise(resolve => replies.push(() => resolve({ sessionKey: r.sessionKey, phase: r.value ? "paused" : "playing", paused: r.value, time: 30, duration: 90, volume: 20, rotation: 0, fullscreen: false, tracks: [] }))));
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" />);
    await screen.findByText("已暂停");
    const button = screen.getByRole("button", { name: "播放" });
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button);
    expect(b.api.embeddedPlayback.mock.calls.flatMap(([r]) => r.op === "pause" ? [r.value] : [])).toEqual([false, true, false]);
    await act(async () => replies[2]());
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
    await act(async () => { replies[1](); replies[0](); });
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
    view.unmount();
  });
  it("dispatches a surface click immediately and preserves playback on double-click", async () => {
    const b = bridge();
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" />);
    await screen.findByText("已暂停");
    act(() => b.input({ kind: "click" }));
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "pause", value: false }));
    act(() => b.input({ kind: "double-click" }));
    expect(b.api.embeddedPlayback.mock.calls.flatMap(([r]) => r.op === "pause" ? [r.value] : [])).toEqual([false, true]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "退出全屏" })).toHaveLength(2));
    view.unmount();
  });
  it("pauses a buffering video based on pause property rather than phase", async () => {
    const b = bridge(); b.update({ phase: "buffering", paused: false });
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" />);
    await screen.findByText("正在缓冲");
    act(() => b.input({ kind: "key", code: "Space", control: false, shift: false, alt: false }));
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "pause", value: true }));
    view.unmount();
  });
  it("floats previews without resizing or restarting the engine", async () => {
    const b = bridge();
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("progress-preview")) return { x: 0, y: 0, left: 0, top: 0, right: 160, bottom: 120, width: 160, height: 120, toJSON: () => ({}) };
      if (this.classList.contains("progress-wrap")) return { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 31, width: 100, height: 31, toJSON: () => ({}) };
      return original.call(this);
    });
    const show = vi.fn(async () => undefined);
    const api = { ...b.api, showPlayerTimelinePreview: show };
    const view = render(<PlayerPage video={video} embeddedApi={api} playbackRoute="embedded" getTimelinePreviewUrl={ms => `local-video://preview/v1/${ms}`} />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    const page = view.container.querySelector<HTMLElement>(".player-page")!;
    const wrap = screen.getByRole("slider", { name: "播放进度" }).parentElement!;
    const boundsCalls = b.api.embeddedPlayback.mock.calls.filter(([r]) => r.op === "bounds").length;
    fireEvent.mouseMove(wrap, { clientX: 50 });
    await waitFor(() => expect(show).toHaveBeenCalledWith({ videoId: "v1", timeMs: 45000, x: 50, y: -8 }));
    expect(page.style.getPropertyValue("--hover-preview-clearance")).toBe("");
    expect(view.container.querySelector(".progress-preview")).toBeNull();
    expect(b.api.embeddedPlayback.mock.calls.filter(([r]) => r.op === "bounds")).toHaveLength(boundsCalls);
    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    await waitFor(() => expect(page).toHaveClass("is-fullscreen"));
    expect(page.style.getPropertyValue("--hover-preview-clearance")).toBe("");
    fireEvent.mouseLeave(wrap);
    expect(show).toHaveBeenLastCalledWith(null);
    expect(view.container.querySelector(".progress-preview")).toBeNull();
    expect(b.api.embeddedPlayback.mock.calls.filter(([r]) => r.op === "start")).toHaveLength(1);
    expect(b.api.embeddedPlayback.mock.calls.some(([r]) => r.op === "seek")).toBe(false);
    view.unmount(); vi.restoreAllMocks();
  });
  it("keeps audio and subtitle controls out of the player footer in all decode states", async () => {
    const b = bridge();
    b.update({ phase: "loading" });
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" />);
    const expectNoTrackControls = () => {
      expect(screen.queryByRole("combobox", { name: "音轨" })).toBeNull();
      expect(screen.queryByRole("combobox", { name: "字幕" })).toBeNull();
      expect(screen.queryByRole("button", { name: "加载 SRT 字幕" })).toBeNull();
      expect(view.container.querySelector(".player-media-controls")).toBeNull();
    };
    expectNoTrackControls();
    b.update({ phase: "paused", tracks: [
      { type: "audio", id: 1, codec: "aac", selected: true },
      { type: "audio", id: 2, codec: "dts", selected: false },
      { type: "sub", id: 1, codec: "subrip", selected: true }
    ] });
    await waitFor(() => expect(screen.getByText("已暂停")).toBeInTheDocument());
    expectNoTrackControls();
    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "退出全屏" })).toHaveLength(2));
    expectNoTrackControls();
    expect(b.api.embeddedPlayback.mock.calls.some(([r]) => ["audio-track", "subtitle-track", "subtitle-file"].includes(r.op))).toBe(false);
    view.rerender(<PlayerPage video={{ ...video, id: "native" }} embeddedApi={b.api} playbackRoute="native" />);
    expectNoTrackControls(); view.unmount();
  });
  it("shows fullscreen failure without claiming success and retries", async () => {
    const b = bridge(), original = b.api.embeddedPlayback.getMockImplementation()!;
    let fail = true;
    b.api.embeddedPlayback.mockImplementation(async r => { if (r.op === "fullscreen" && fail) throw Error("failed"); return original(r); });
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="native" />);
    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    await screen.findByText("全屏操作未完成，请重试");
    expect(screen.queryByRole("button", { name: "退出全屏" })).toBeNull();
    fail = false; fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "退出全屏" })).toHaveLength(2));
    view.unmount();
  });
  it("keeps one window fullscreen mechanism across both decode routes", async () => {
    const b = bridge();
    const props = { video, embeddedApi: b.api };
    const view = render(<PlayerPage {...props} playbackRoute="embedded" />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "退出全屏" })).toHaveLength(2));
    view.rerender(<PlayerPage {...props} video={{ ...video, id: "native" }} playbackRoute="native" />);
    fireEvent.click(screen.getAllByRole("button", { name: "退出全屏" })[0]);
    await waitFor(() => expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "fullscreen", value: false })));
    await waitFor(() => expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "退出全屏" })).toHaveLength(2));
    view.rerender(<PlayerPage {...props} playbackRoute="embedded" />);
    fireEvent.keyDown(window, { code: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument());
    view.unmount();
  });
  it("preserves modifier shortcuts and leaves focused text inputs alone", async () => {
    const b = bridge();
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    act(() => b.input({ kind: "key", code: "ArrowRight", control: true, alt: false, shift: false }));
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "rotate", value: 90 }));
    act(() => b.input({ kind: "key", code: "ArrowLeft", control: true, alt: false, shift: false }));
    expect(b.api.embeddedPlayback).toHaveBeenLastCalledWith(expect.objectContaining({ op: "rotate", value: 0 }));
    expect(b.api.embeddedPlayback.mock.calls.some(([r]) => r.op === "seek")).toBe(false);
    const input = document.createElement("input"); document.body.append(input); input.focus();
    b.api.embeddedPlayback.mockClear();
    act(() => b.input({ kind: "key", code: "Space", control: false, alt: false, shift: false }));
    expect(b.api.embeddedPlayback).not.toHaveBeenCalled();
    input.remove(); view.unmount();
  });
  it("applies rotation requested during loading once ready and not on every poll", async () => {
    const b = bridge(); b.update({ phase: "loading" });
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" />);
    await waitFor(() => expect(b.api.subscribeEmbeddedInput).toHaveBeenCalled());
    act(() => b.input({ kind: "key", code: "ArrowRight", control: true, alt: false, shift: false }));
    expect(b.api.embeddedPlayback.mock.calls.some(([r]) => r.op === "rotate")).toBe(false);
    b.update({ phase: "paused" });
    await waitFor(() => expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "rotate", value: 90 })));
    const count = b.api.embeddedPlayback.mock.calls.filter(([r]) => r.op === "rotate").length;
    b.update({ time: 32 }); await screen.findByText(/00:32/);
    expect(b.api.embeddedPlayback.mock.calls.filter(([r]) => r.op === "rotate")).toHaveLength(count);
    view.unmount();
  });
  it("rotates back while the progress slider is focused without changing its value", async () => {
    const b = bridge();
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    act(() => b.input({ kind: "key", code: "ArrowRight", control: true, alt: false, shift: false }));
    const slider = screen.getByRole("slider", { name: "播放进度" }); act(() => slider.focus());
    act(() => b.input({ kind: "key", code: "ArrowLeft", control: true, alt: false, shift: false }));
    expect(b.api.embeddedPlayback).toHaveBeenLastCalledWith(expect.objectContaining({ op: "rotate", value: 0 }));
    expect(b.api.embeddedPlayback.mock.calls.some(([r]) => r.op === "seek")).toBe(false);
    expect(slider).toHaveValue("30");
    expect(fireEvent.keyDown(slider, { code: "ArrowRight", ctrlKey: true })).toBe(false);
    expect(b.api.embeddedPlayback).toHaveBeenLastCalledWith(expect.objectContaining({ op: "rotate", value: 90 }));
    expect(fireEvent.keyDown(slider, { code: "", key: "ArrowLeft", ctrlKey: true })).toBe(false);
    expect(b.api.embeddedPlayback).toHaveBeenLastCalledWith(expect.objectContaining({ op: "rotate", value: 0 }));
    b.api.embeddedPlayback.mockClear();
    expect(fireEvent.keyDown(slider, { code: "ArrowRight" })).toBe(true);
    expect(b.api.embeddedPlayback).not.toHaveBeenCalled();
    view.unmount();
  });
  it("clears stale toolbar focus on a surface click", async () => {
    const b = bridge();
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    screen.getByRole("button", { name: "播放列表" }).focus();
    act(() => b.input({ kind: "click" }));
    expect(document.activeElement).toBe(document.body);
    view.unmount();
  });
  it("keeps embedded playback recoverable when manually opening an external player fails", async () => {
    const b = bridge(), external = vi.fn(async () => { throw new Error("外部播放器不可用"); });
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" onPlayExternal={external} />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "使用外部播放器" }));
    await screen.findByText("外部播放器不可用");
    expect(external).toHaveBeenCalledWith(30000);
    await waitFor(() => expect(b.api.embeddedPlayback.mock.calls.filter(([r]) => r.op === "start")).toHaveLength(2));
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "start", positionMs: 30000 }));
    view.unmount();
  });
  it("releases the decode session before the existing deletion callback", async () => {
    const b = bridge(), deleted = vi.fn(async () => undefined);
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" onDelete={deleted} />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "永久删除视频" }));
    fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));
    await waitFor(() => expect(deleted).toHaveBeenCalledOnce());
    const stopIndex = b.api.embeddedPlayback.mock.calls.findIndex(([r]) => r.op === "stop");
    expect(b.api.embeddedPlayback.mock.invocationCallOrder[stopIndex]).toBeLessThan(deleted.mock.invocationCallOrder[0]);
    view.unmount();
  });
  it("does not delete when releasing the decode session fails and reloads at the current position", async () => {
    const b = bridge(), deleted = vi.fn();
    const implementation = b.api.embeddedPlayback.getMockImplementation()!;
    b.api.embeddedPlayback.mockImplementation(async r => {
      if (r.op === "stop") throw new Error("release failed");
      return implementation(r);
    });
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" onDelete={deleted} />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "永久删除视频" }));
    fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));
    await waitFor(() => expect(b.api.embeddedPlayback.mock.calls.filter(([r]) => r.op === "start")).toHaveLength(2));
    expect(deleted).not.toHaveBeenCalled();
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "start", positionMs: 30000 }));
    view.unmount();
  });
  it("reloads using current progress rather than the original starting point", async () => {
    const b = bridge();
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" startPositionMs={10000} />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "start", positionMs: 30000 })));
    view.unmount();
  });
  it("keeps original controls and paged sidebar and does not restart on metadata refresh", async () => {
    const b = bridge(), external = vi.fn(), select = vi.fn(), favorite = vi.fn();
    const next = { ...video, id: "v2", filename: "第二部.mp4" };
    const props = { video, embeddedApi: b.api, playbackRoute: "embedded" as const, onPlayExternal: external, onToggleFavorite: favorite, loadDirectoryPlaylist: vi.fn(async () => ({ videos: [video, next], totalCount: 2, page: 1, pageSize: 100 as const, totalPages: 1 })), onSelectPlaylistVideo: select };
    const view = render(<PlayerPage {...props} />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    expect(view.container.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: "查看详情" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "快进 10 秒" }));
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "seek", value: 40 }));
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "pause", value: false }));
    fireEvent.click(screen.getByRole("button", { name: "收藏" })); expect(favorite).toHaveBeenCalledWith(video);
    fireEvent.click(screen.getByRole("button", { name: "播放列表" }));
    await screen.findByText("第二部.mp4"); fireEvent.click(screen.getByText("第二部.mp4"));
    expect(select).toHaveBeenCalledWith(next, [video, next]);
    view.rerender(<PlayerPage {...props} video={{ ...video, updatedAt: "changed" }} />);
    expect(b.api.embeddedPlayback.mock.calls.filter(([r]) => r.op === "start")).toHaveLength(1);
    expect(external).not.toHaveBeenCalled();
    view.unmount(); expect(b.unsubscribe).toHaveBeenCalledOnce();
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "stop" }));
  });
  it("hides native video for dialogs and never automatically opens external playback on failure", async () => {
    const b = bridge(), external = vi.fn();
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" onPlayExternal={external} onDelete={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "永久删除视频" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "visible", value: false }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "visible", value: true }));
    b.update({ phase: "failed", error: "读取失败" });
    await screen.findByText("读取失败"); expect(external).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "使用外部播放器" }));
    await waitFor(() => expect(external).toHaveBeenCalledWith(30000)); view.unmount();
  });
  it("switches a failing browser decoder to embedded without losing position", async () => {
    const b = bridge(), external = vi.fn();
    const view = render(<PlayerPage video={video} mediaUrl="local-video://media/v1" embeddedApi={b.api} onPlayExternal={external} />);
    const element = view.container.querySelector("video")!; element.currentTime = 12;
    fireEvent.error(element);
    await waitFor(() => expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "start", videoId: "v1", positionMs: 12000 })));
    expect(external).not.toHaveBeenCalled(); expect(view.container.querySelector("video")).toBeNull(); view.unmount();
  });
  it("routes native-surface keys through existing shortcuts and advances once on ended", async () => {
    const b = bridge(), next = vi.fn();
    const view = render(<PlayerPage video={video} embeddedApi={b.api} playbackRoute="embedded" onNext={next} />);
    await waitFor(() => expect(screen.getByText(/00:30/)).toBeInTheDocument());
    act(() => b.input({ kind: "key", code: "ArrowRight", control: false, alt: false, shift: false }));
    expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "seek", value: 40 }));
    b.update({ phase: "ended" }); await waitFor(() => expect(next).toHaveBeenCalledOnce());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); }); expect(next).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await waitFor(() => expect(b.api.embeddedPlayback).toHaveBeenCalledWith(expect.objectContaining({ op: "start", positionMs: 0 })));
    view.unmount();
  });
});

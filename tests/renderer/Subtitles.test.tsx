import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubtitleDialog, type PlayerSubtitleApi } from "../../src/renderer/components/SubtitleDialog";
import { SubtitleSettings } from "../../src/renderer/components/SubtitleSettings";
import { PlayerPage } from "../../src/renderer/components/PlayerPage";
import type { SubtitleState } from "../../src/shared/subtitles";
import type { VideoRecord } from "../../src/shared/videoTypes";

const video = { id: "v1", filename: "Movie.2024.1080p.mkv", directory: "C:/Movies", extension: ".mkv", sizeBytes: 1000, durationMs: 120000 } as VideoRecord;
const empty: SubtitleState = { videoId: "v1", items: [], selectedId: null, offsetSeconds: 0, nativeVtt: null };
const candidate = { id: "11111111-1111-4111-8111-111111111111", provider: "assrt" as const, title: "Movie", language: "中英双语", release: "2024 WEB-DL", filename: "Movie.ass", format: "ass", score: 70, matches: ["片名匹配", "年份匹配"], downloads: null };
function apiFixture(): PlayerSubtitleApi {
  return { openSubtitleWebsite: vi.fn(async () => undefined), getSubtitleConfig: vi.fn(async () => ({ assrtConfigured: true, openSubtitlesConfigured: false, openSubtitlesAccountConfigured: false, storageAvailable: true })),
    getSubtitleState: vi.fn(async () => empty), subtitleAction: vi.fn(async () => empty),
    searchSubtitles: vi.fn(async () => ({ query: "Movie 2024", candidates: [candidate], providers: [{ provider: "assrt" as const, status: "ok" as const, message: "" }] })) };
}
afterEach(() => vi.restoreAllMocks());
describe("subtitle interaction", () => {
  it("shows saved-state read failures with a local retry instead of endless loading", () => {
    const retry = vi.fn();
    render(<SubtitleDialog video={video} api={apiFixture()} state={null} stateError="保存记录读取失败" onRetryState={retry} onState={vi.fn()} onClose={() => undefined} external={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("保存记录读取失败");
    expect(screen.queryByText("正在读取字幕记录…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取字幕记录" })); expect(retry).toHaveBeenCalledOnce();
  });
  it("searches by editable name, shows version clues and sends only IDs for download", async () => {
    const api = apiFixture(), update = vi.fn();
    render(<SubtitleDialog video={video} api={api} state={empty} onState={update} onClose={() => undefined} external={false} />);
    expect(screen.getByLabelText("影片名称或发行版本")).toHaveValue("Movie 2024");
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" }));
    await screen.findByText("2024 WEB-DL"); expect(screen.getByText("片名匹配 · 年份匹配")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载并使用" }));
    await waitFor(() => expect(api.subtitleAction).toHaveBeenCalledWith({ videoId: "v1", op: "download", id: candidate.id }));
    expect(update).toHaveBeenCalledWith(empty);
  });
  it("ignores results after closing and prevents duplicate requests", async () => {
    const api = apiFixture(); let resolve!: (value: Awaited<ReturnType<PlayerSubtitleApi["searchSubtitles"]>>) => void;
    vi.mocked(api.searchSubtitles).mockImplementation(() => new Promise(r => { resolve = r; }));
    const view = render(<SubtitleDialog video={video} api={api} state={empty} onState={vi.fn()} onClose={() => undefined} external={false} />);
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" }));
    expect(screen.getByRole("button", { name: "搜索中…" })).toBeDisabled();
    fireEvent.submit(view.container.querySelector("form")!);
    expect(api.searchSubtitles).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => resolve({ query: "Movie", candidates: [], providers: [] }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("delivers saved results to the video-bound parent after closing the dialog", async () => {
    const api = apiFixture(), update = vi.fn(); let resolve!: (state: SubtitleState) => void;
    vi.mocked(api.subtitleAction).mockImplementation(() => new Promise(r => { resolve = r; }));
    const view = render(<SubtitleDialog video={video} api={api} state={empty} onState={update} onClose={() => undefined} external={false} />);
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" })); await screen.findByText("2024 WEB-DL");
    fireEvent.click(screen.getByRole("button", { name: "下载并使用" })); view.unmount();
    await act(async () => resolve(empty)); expect(update).toHaveBeenCalledWith(empty);
  });
  it("updates Chromium subtitles when a download finishes after closing the panel", async () => {
    const api = apiFixture(); let resolve!: (state: SubtitleState) => void;
    vi.mocked(api.subtitleAction).mockImplementation(() => new Promise(r => { resolve = r; }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn(() => "blob:late-subtitle") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });
    const view = render(<PlayerPage video={video} subtitleApi={api} mediaUrl="local-video://media/v1" />);
    fireEvent.click(screen.getByRole("button", { name: "查找字幕" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" })); await screen.findByText("2024 WEB-DL");
    fireEvent.click(screen.getByRole("button", { name: "下载并使用" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭字幕面板" }));
    await act(async () => resolve({ ...empty, nativeVtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n中文\n" }));
    await waitFor(() => expect(view.container.querySelector("track")?.getAttribute("src")).toBe("blob:late-subtitle"));
  });
  it("does not call an outage a zero-result search", async () => {
    const api = apiFixture(); vi.mocked(api.searchSubtitles).mockResolvedValue({ query: "Movie", candidates: [], providers: [{ provider: "assrt", status: "failed", message: "字幕服务连接超时" }] });
    render(<SubtitleDialog video={video} api={api} state={empty} onState={vi.fn()} onClose={() => undefined} external={false} />);
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" }));
    await screen.findByText("ASSRT 射手网 · 字幕服务连接超时");
    expect(screen.queryByText(/没有找到可直接下载/)).not.toBeInTheDocument();
  });
  it("loads saved VTT and releases blob URLs when switching videos", async () => {
    const create = vi.fn(() => "blob:subtitle"), revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revoke });
    const api = apiFixture(); vi.mocked(api.getSubtitleState).mockResolvedValue({ ...empty, nativeVtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n中文\n" });
    const view = render(<PlayerPage video={video} subtitleApi={api} mediaUrl="local-video://media/v1" />);
    await waitFor(() => expect(view.container.querySelector("track")?.getAttribute("src")).toBe("blob:subtitle"));
    view.rerender(<PlayerPage video={{ ...video, id: "v2" }} subtitleApi={undefined} />);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:subtitle"));
    expect(view.container.querySelector("track")).toBeNull(); view.unmount();
  });
  it("blocks playback shortcuts while the dialog is open and closes with Escape", async () => {
    const api = apiFixture(), next = vi.fn();
    render(<PlayerPage video={video} subtitleApi={api} onNext={next} />);
    fireEvent.click(screen.getByRole("button", { name: "查找字幕" }));
    await act(async () => { await Promise.resolve(); });
    fireEvent.keyDown(window, { code: "ArrowRight" }); expect(next).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("saves only newly supplied secrets, clears inputs and supports explicit removal", async () => {
    const api = { ...apiFixture(), saveSubtitleConfig: vi.fn(async () => ({ assrtConfigured: true, openSubtitlesConfigured: false, openSubtitlesAccountConfigured: false, storageAvailable: true })) };
    render(<SubtitleSettings api={api} />); await screen.findByText("已配置");
    expect(screen.getByLabelText("API Token")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("API Token"), { target: { value: "fixture-token" } });
    fireEvent.click(screen.getByRole("button", { name: "保存字幕配置" }));
    await waitFor(() => expect(api.saveSubtitleConfig).toHaveBeenCalledWith({ assrtToken: "fixture-token" }));
    expect(screen.getByLabelText("API Token")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "清除 ASSRT 配置" }));
    fireEvent.click(screen.getByRole("button", { name: "保存字幕配置" }));
    await waitFor(() => expect(api.saveSubtitleConfig).toHaveBeenLastCalledWith({ assrtToken: "" }));
  });
});

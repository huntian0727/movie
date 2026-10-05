import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerPage } from "../../src/renderer/components/PlayerPage";
import { searchSubtitleCache, saveSubtitlePreferences } from "../../src/renderer/components/subtitleSearchCache";
import type { PlayerSubtitleApi } from "../../src/renderer/components/SubtitleDialog";
import type { SubtitleState } from "../../src/shared/subtitles";
import type { VideoRecord } from "../../src/shared/videoTypes";

const video = { id: "quick-video", filename: "Quick.Movie.2024.1080p.mkv", sizeBytes: 1000, modifiedAt: "original", durationMs: 120000, directory: "C:/Movies", extension: ".mkv" } as VideoRecord;
const empty: SubtitleState = { videoId: video.id, items: [], selectedId: null, offsetSeconds: 0, nativeVtt: null };
const candidates = ["English", "简体中文", "中英双语", "繁体中文"].map((language, i) => ({ id: `11111111-1111-4111-8111-11111111111${i}`, provider: "thunder" as const, title: `Version ${i}`, language, release: `WEB-DL ${i}`, filename: `Quick.${i}.srt`, format: "srt", score: 90 - i, matches: [], downloads: null }));
const result = { query: "Quick Movie 2024", candidates, providers: [{ provider: "thunder" as const, status: "ok" as const, message: "" }] };
const saved: SubtitleState = { ...empty, selectedId: candidates[1].id, items: [{ ...candidates[1], format: "srt", downloadedAt: "2026-10-05T00:00:00.000Z" }], nativeVtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n中文\n" };
function fixture(): PlayerSubtitleApi {
  return { searchSubtitles: vi.fn(async () => result), getSubtitleState: vi.fn(async () => empty), subtitleAction: vi.fn(async () => saved), openSubtitleWebsite: vi.fn(), getSubtitleConfig: vi.fn() };
}
beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn(() => "blob:quick-subtitle") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe("quick subtitle workflow", () => {
  it("starts only on click, recommends three Chinese versions, reuses results and auto-closes after selection", async () => {
    const api = fixture();
    const view = render(<PlayerPage video={video} subtitleApi={api} />);
    expect(api.searchSubtitles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查找字幕" }));
    await screen.findByText("Version 1");
    expect(view.container.querySelector(".player-page")).toHaveClass("has-subtitle-panel");
    expect(screen.queryByText("Version 0")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "下载并使用" })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "关闭字幕面板" }));
    fireEvent.click(screen.getByRole("button", { name: "查找字幕" }));
    await screen.findByText("Version 1"); expect(api.searchSubtitles).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole("button", { name: "下载并使用" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.subtitleAction).toHaveBeenCalledWith({ videoId: video.id, op: "download", id: candidates[1].id });
    expect(screen.getByRole("button", { name: "提前 0.5 秒" })).toBeInTheDocument();
  });
  it("keeps advanced results, remembers corrected query and filters after remount", async () => {
    const api = fixture(); const view = render(<PlayerPage video={video} subtitleApi={api} />);
    fireEvent.click(screen.getByRole("button", { name: "查找字幕" })); await screen.findByText("Version 1");
    fireEvent.click(screen.getByRole("button", { name: "更多字幕 / 修改片名" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Version 0")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("影片名称或发行版本"), { target: { value: "Correct Movie 2024" } });
    fireEvent.change(screen.getByLabelText("语言"), { target: { value: "english" } });
    fireEvent.change(screen.getByLabelText("来源"), { target: { value: "subtitlecat" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索字幕" })); await screen.findByText("Version 0");
    view.unmount();
    render(<PlayerPage video={video} subtitleApi={api} />);
    fireEvent.click(screen.getByRole("button", { name: "查找字幕" })); await screen.findByText("Version 1");
    expect(api.searchSubtitles).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "更多字幕 / 修改片名" }));
    expect(screen.getByLabelText("影片名称或发行版本")).toHaveValue("Correct Movie 2024");
    expect(screen.getByLabelText("语言")).toHaveValue("english"); expect(screen.getByLabelText("来源")).toHaveValue("subtitlecat");
  });
  it("adjusts offset immediately, serializes clicks and leaves playback controls available", async () => {
    const api = fixture(); vi.mocked(api.getSubtitleState).mockResolvedValue(saved);
    let finish!: (value: SubtitleState) => void;
    vi.mocked(api.subtitleAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PlayerPage video={video} subtitleApi={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "提前 0.5 秒" }));
    fireEvent.click(screen.getByRole("button", { name: "延后 0.5 秒" }));
    expect(api.subtitleAction).toHaveBeenCalledOnce();
    expect(api.subtitleAction).toHaveBeenCalledWith({ videoId: video.id, op: "offset", offsetSeconds: -0.5 });
    await act(async () => finish({ ...saved, offsetSeconds: -0.5 }));
    expect(screen.getByText(/偏移 -0.5 秒/)).toBeInTheDocument();
    vi.mocked(api.subtitleAction).mockResolvedValue(empty);
    fireEvent.click(screen.getByRole("button", { name: "关闭字幕" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "提前 0.5 秒" })).not.toBeInTheDocument());
  });
  it("bounds cached results by file identity, TTL and failure; joins in-flight queries", async () => {
    const api = fixture(), cacheVideo = { ...video, sizeBytes: 2222 }, input = { videoId: video.id, query: "Cache Film", provider: "thunder" as const, language: "any" as const };
    let finish!: (value: typeof result) => void;
    vi.mocked(api.searchSubtitles).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = searchSubtitleCache(api, cacheVideo, input), second = searchSubtitleCache(api, cacheVideo, input);
    expect(api.searchSubtitles).toHaveBeenCalledOnce(); finish(result); await Promise.all([first, second]);
    await searchSubtitleCache(api, { ...cacheVideo, modifiedAt: "replaced" }, input); expect(api.searchSubtitles).toHaveBeenCalledTimes(2);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60_000);
    await searchSubtitleCache(api, cacheVideo, input); expect(api.searchSubtitles).toHaveBeenCalledTimes(3);
    vi.mocked(api.searchSubtitles).mockRejectedValueOnce(new Error("offline"));
    await expect(searchSubtitleCache(api, cacheVideo, input, true)).rejects.toThrow("offline");
    await searchSubtitleCache(api, cacheVideo, input); expect(api.searchSubtitles).toHaveBeenCalledTimes(5);
  });
  it("ignores a late download for a replaced file with the same video ID", async () => {
    const api = fixture(); let finish!: (value: SubtitleState) => void;
    vi.mocked(api.subtitleAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PlayerPage video={video} subtitleApi={api} />);
    fireEvent.click(screen.getByRole("button", { name: "查找字幕" })); await screen.findByText("Version 1");
    fireEvent.click(screen.getAllByRole("button", { name: "下载并使用" })[0]);
    view.rerender(<PlayerPage video={{ ...video, modifiedAt: "new file" }} subtitleApi={api} />);
    await act(async () => finish(saved));
    expect(screen.queryByRole("button", { name: "提前 0.5 秒" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("uses explicitly saved source preferences without requesting account sources by default", async () => {
    saveSubtitlePreferences({ language: "chinese", provider: "thunder" }); const api = fixture();
    render(<PlayerPage video={{ ...video, sizeBytes: 5555 }} subtitleApi={api} />);
    fireEvent.click(screen.getByRole("button", { name: "查找字幕" })); await screen.findByText("Version 1");
    expect(api.searchSubtitles).toHaveBeenCalledWith({ videoId: video.id, query: "Quick Movie 2024", language: "chinese", provider: "thunder" });
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoStoryboard } from "../../src/renderer/components/VideoStoryboard";
import type { VideoRecord } from "../../src/shared/videoTypes";

const video = { id: "a", filename: "clip.mp4", path: "D:\\clip.mp4", durationMs: 600_000, sizeBytes: 100, modifiedAt: "T1", metadataStatus: "ready" } as VideoRecord;
const observers: Array<(visible: boolean) => void> = [];
let load: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let metadata: ReturnType<typeof vi.fn>;
let metadataState: ReturnType<typeof vi.fn>;
let cancelMetadata: ReturnType<typeof vi.fn>;
beforeEach(() => {
  observers.length = 0;
  load = vi.fn().mockResolvedValue(new Uint8Array([1, 2]));
  cancel = vi.fn().mockResolvedValue(undefined);
  metadata = vi.fn().mockResolvedValue(video);
  metadataState = vi.fn().mockResolvedValue("active");
  cancelMetadata = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("videoManager", { loadPreviewImage: load, cancelPreviewImage: cancel, loadPreviewMetadata: metadata, getPreviewMetadataState: metadataState, cancelPreviewMetadata: cancelMetadata });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { observers.push((visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver)); }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:frame"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("list storyboard", () => {
  it("automatically obtains duration for visible pending cloud videos before creating frames", async () => {
    let finish!: (next: VideoRecord) => void;
    metadata.mockImplementation(() => new Promise<VideoRecord>((resolve) => { finish = resolve; }));
    const pending = { ...video, durationMs: null, metadataStatus: "pending" as const, providerFileId: "remote" };
    const { container, rerender } = render(<VideoStoryboard video={pending} onPlay={vi.fn()} />);
    expect(metadata).not.toHaveBeenCalled();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    act(() => observers[0](true));
    await waitFor(() => expect(metadata).toHaveBeenCalledOnce());
    expect(metadata.mock.calls[0][0]).toMatchObject({ videoId: "a", retry: false });
    await screen.findByText("正在分析时长，完成后自动加载截图…");
    rerender(<VideoStoryboard video={{ ...pending, updatedAt: "cache-update" }} onPlay={vi.fn()} />);
    expect(metadata).toHaveBeenCalledOnce();
    await act(async () => finish({ ...pending, durationMs: 600_000, metadataStatus: "ready" }));
    expect(container.querySelectorAll("img")).toHaveLength(6);
    expect(load).not.toHaveBeenCalled();
    act(() => observers.slice(1).forEach((observe) => observe(true)));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(6));
  });

  it("debounces visibility and cancels duration requests when leaving the viewport", async () => {
    metadata.mockImplementation(() => new Promise(() => undefined));
    const { unmount } = render(<VideoStoryboard video={{ ...video, durationMs: null, metadataStatus: "pending" }} onPlay={vi.fn()} />);
    act(() => { observers[0](true); });
    act(() => { observers[0](false); });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(metadata).not.toHaveBeenCalled();
    act(() => observers[0](true));
    await waitFor(() => expect(metadata).toHaveBeenCalledOnce());
    act(() => observers[0](false));
    expect(cancelMetadata).toHaveBeenCalledWith(metadata.mock.calls[0][0].requestId);
    act(() => observers[0](true));
    await waitFor(() => expect(metadata).toHaveBeenCalledTimes(2));
    unmount();
    expect(cancelMetadata).toHaveBeenCalledWith(metadata.mock.calls[1][0].requestId);
  });

  it("shows queue state and failure without an infinite retry, then supports an explicit retry", async () => {
    const pending = { ...video, durationMs: null, metadataStatus: "pending" as const };
    metadataState.mockResolvedValue("queued");
    metadata.mockResolvedValueOnce({ ...pending, metadataStatus: "failed" });
    const { container } = render(<VideoStoryboard video={pending} onPlay={vi.fn()} />);
    act(() => observers[0](true));
    await screen.findByText("时长分析失败，截图暂不可用");
    act(() => { observers[0](false); });
    act(() => { observers[0](true); });
    expect(metadata).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "重试时长分析" }));
    await waitFor(() => expect(metadata).toHaveBeenCalledTimes(2));
    expect(metadata.mock.calls[1][0].retry).toBe(true);
    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(6));
  });

  it("does not auto-read failed, missing, zero-byte, or ready-without-duration videos", async () => {
    const { rerender } = render(<VideoStoryboard video={{ ...video, durationMs: null, metadataStatus: "failed" }} onPlay={vi.fn()} />);
    act(() => observers[0](true));
    expect(screen.getByRole("button", { name: "重试时长分析" })).toBeInTheDocument();
    rerender(<VideoStoryboard video={{ ...video, sizeBytes: 0, durationMs: null, metadataStatus: "pending" }} onPlay={vi.fn()} />);
    act(() => observers[1](true));
    expect(screen.getByText("文件大小为 0B，请先重新读取大小")).toBeInTheDocument();
    rerender(<VideoStoryboard video={{ ...video, durationMs: null, isMissing: true, metadataStatus: "pending" }} onPlay={vi.fn()} />);
    act(() => observers[2](true));
    expect(screen.getByText("文件当前不可访问，无法生成截图预览")).toBeInTheDocument();
    expect(metadata).not.toHaveBeenCalled();
  });

  it("ignores an old duration result after the file version changes", async () => {
    let finish!: (next: VideoRecord) => void;
    metadata.mockImplementationOnce(() => new Promise<VideoRecord>((resolve) => { finish = resolve; })).mockImplementation(() => new Promise(() => undefined));
    const pending = { ...video, durationMs: null, metadataStatus: "pending" as const };
    const { container, rerender } = render(<VideoStoryboard video={pending} onPlay={vi.fn()} />);
    act(() => observers[0](true));
    await waitFor(() => expect(metadata).toHaveBeenCalledOnce());
    rerender(<VideoStoryboard video={{ ...pending, modifiedAt: "T2" }} onPlay={vi.fn()} />);
    await act(async () => finish(video));
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(cancelMetadata).toHaveBeenCalledWith(metadata.mock.calls[0][0].requestId);
  });

  it("loads visible frames only, keeps successful images across polling and cancels on leaving", async () => {
    load.mockImplementation(() => new Promise(() => undefined));
    const { container, unmount } = render(<VideoStoryboard video={video} onPlay={vi.fn()} />);
    expect(container.querySelectorAll("img")).toHaveLength(6);
    expect(load).not.toHaveBeenCalled();
    act(() => observers[0](true));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(load.mock.calls[0][0]).toMatchObject({ priority: 1, cachedOnly: false });
    act(() => observers[0](false));
    expect(cancel).toHaveBeenCalledWith(load.mock.calls[0][0].requestId);
    unmount();
  });
  it("expands adaptive screenshots and plays at the clicked timestamp", () => {
    const onPlay = vi.fn();
    const { container } = render(<VideoStoryboard video={video} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole("button", { name: "从 00:50 播放 clip.mp4" }));
    expect(onPlay).toHaveBeenCalledWith(50_000);
    fireEvent.click(screen.getByRole("button", { name: "查看全部 12 张" }));
    expect(container.querySelectorAll("img")).toHaveLength(12);
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "收起截图" }));
    expect(container.querySelectorAll("img")).toHaveLength(6);
  });
  it("retries a failed frame without reloading five successful frames or flashing on cache updates", async () => {
    load.mockResolvedValueOnce(null);
    const { container, rerender } = render(<VideoStoryboard video={video} onPlay={vi.fn()} />);
    act(() => observers.forEach((observe) => observe(true)));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(6));
    await waitFor(() => expect(container.querySelectorAll('[data-preview-state="ready"]')).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "重试失败截图" }));
    act(() => observers[6](true));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(7));
    await waitFor(() => expect(container.querySelectorAll('[data-preview-state="ready"]')).toHaveLength(6));
    rerender(<VideoStoryboard video={{ ...video, updatedAt: "T2", timelinePreviewStatus: "ready" }} onPlay={vi.fn()} />);
    expect(container.querySelectorAll('[data-preview-state="ready"]')).toHaveLength(6);
    expect(load).toHaveBeenCalledTimes(7);
  });
  it("avoids generation for videos without duration and assigns cloud frames lower priority", async () => {
    const { rerender } = render(<VideoStoryboard video={{ ...video, durationMs: null }} onPlay={vi.fn()} />);
    expect(screen.getByText("暂无可用时长，无法生成截图预览")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    rerender(<VideoStoryboard video={{ ...video, providerFileId: "remote-id" }} onPlay={vi.fn()} />);
    act(() => observers[1](true));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(load.mock.calls[0][0]).toMatchObject({ priority: 0 });
  });
});

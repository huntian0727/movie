import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoStoryboard } from "../../src/renderer/components/VideoStoryboard";
import type { VideoRecord } from "../../src/shared/videoTypes";

const video = { id: "a", filename: "clip.mp4", path: "D:\\clip.mp4", durationMs: 600_000, sizeBytes: 100, modifiedAt: "T1", metadataStatus: "ready" } as VideoRecord;
const observers: Array<(visible: boolean) => void> = [];
let load: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
beforeEach(() => {
  observers.length = 0;
  load = vi.fn().mockResolvedValue(new Uint8Array([1, 2]));
  cancel = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("videoManager", { loadPreviewImage: load, cancelPreviewImage: cancel });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { observers.push((visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver)); }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:frame"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("list storyboard", () => {
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
    act(() => observers[0](true));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(load.mock.calls[0][0]).toMatchObject({ priority: 0 });
  });
});

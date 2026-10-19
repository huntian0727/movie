import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageMetadataAutoAnalysis } from "../../src/renderer/components/PageMetadataAutoAnalysis";
import type { VideoRecord } from "../../src/shared/videoTypes";

const pending = (id: string) => ({
  id, filename: id + ".mp4", path: "D:\\\\Movies\\\\" + id + ".mp4",
  sizeBytes: 10_000, modifiedAt: "T1", metadataStatus: "pending",
  isMissing: false
}) as VideoRecord;
let load: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  load = vi.fn();
  cancel = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("videoManager", { loadPreviewMetadata: load, cancelPreviewMetadata: cancel });
  vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("request-1").mockReturnValueOnce("request-2").mockReturnValueOnce("request-3") });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function tick() {
  await act(async () => { await vi.advanceTimersByTimeAsync(310); });
}
describe("page-only metadata analysis", () => {
  it("is opt-in, sends exactly one request at a time, and skips ineligible items", async () => {
    let resolveFirst!: (value: VideoRecord) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ...pending("b"), metadataStatus: "ready" });
    render(<PageMetadataAutoAnalysis videos={[pending("a"), pending("b"), { ...pending("z"), sizeBytes: 0 }, { ...pending("done"), metadataStatus: "ready" }]} active pageLoading={false} scopeKey="page1" />);
    await tick();
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "开启本页自动分析" }));
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({ videoId: "a", retry: false });
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst({ ...pending("a"), metadataStatus: "ready" }); });
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][0].videoId).toBe("b");
  });

  it("cancels only its own old-page request and starts the replacement page", async () => {
    load.mockImplementation(() => new Promise(() => undefined));
    const { rerender } = render(<PageMetadataAutoAnalysis videos={[pending("a")]} active pageLoading={false} scopeKey="page1" />);
    fireEvent.click(screen.getByRole("button", { name: "开启本页自动分析" }));
    await tick();
    const firstId = load.mock.calls[0][0].requestId;
    rerender(<PageMetadataAutoAnalysis videos={[pending("b")]} active pageLoading scopeKey="page2" />);
    expect(cancel).toHaveBeenCalledWith(firstId);
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    rerender(<PageMetadataAutoAnalysis videos={[pending("b")]} active pageLoading={false} scopeKey="page2" />);
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][0].videoId).toBe("b");
    fireEvent.click(screen.getByRole("button", { name: "关闭本页自动分析" }));
    expect(cancel).toHaveBeenCalledWith(load.mock.calls[1][0].requestId);
  });

  it("cancels debounced work before any request is started and does not retry failures in a loop", async () => {
    load.mockRejectedValue(new Error("unavailable"));
    const { rerender } = render(<PageMetadataAutoAnalysis videos={[pending("a")]} active pageLoading={false} scopeKey="page1" />);
    fireEvent.click(screen.getByRole("button", { name: "开启本页自动分析" }));
    rerender(<PageMetadataAutoAnalysis videos={[pending("b")]} active pageLoading={false} scopeKey="page2" />);
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0].videoId).toBe("b");
    await tick();
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

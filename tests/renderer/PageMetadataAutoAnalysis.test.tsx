import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageMetadataAutoAnalysis } from "../../src/renderer/components/PageMetadataAutoAnalysis";
import type { VideoRecord } from "../../src/shared/videoTypes";

const pending = (id: string) => ({
  id, filename: id + ".mp4", path: "D:\\\\Movies\\\\" + id + ".mp4",
  sizeBytes: 10_000, modifiedAt: "T1", metadataStatus: "pending",
  isMissing: false
}) as VideoRecord;
const failed = (id: string) => ({ ...pending(id), metadataStatus: "failed" }) as VideoRecord;
let load: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let getState: ReturnType<typeof vi.fn>;
let requestNumber: number;
beforeEach(() => {
  vi.useFakeTimers();
  requestNumber = 0;
  load = vi.fn();
  cancel = vi.fn().mockResolvedValue(undefined);
  getState = vi.fn().mockResolvedValue("active");
  vi.stubGlobal("videoManager", { loadPreviewMetadata: load, cancelPreviewMetadata: cancel, getPreviewMetadataState: getState });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `request-${++requestNumber}`) });
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
  it("keeps automatic analysis opt-in and fills at most two workers", async () => {
    let resolveA!: (value: VideoRecord) => void;
    let resolveB!: (value: VideoRecord) => void;
    let resolveC!: (value: VideoRecord) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveC = resolve; }));
    render(<PageMetadataAutoAnalysis videos={[
      pending("a"), pending("b"), pending("c"), { ...pending("z"), sizeBytes: 0 },
      { ...pending("done"), metadataStatus: "ready" }
    ]} active pageLoading={false} scopeKey="page1" />);
    await tick();
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "开启本页自动分析" }));
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map((call) => call[0].videoId)).toEqual(["a", "b"]);
    expect(screen.getByRole("status").textContent).toContain("本页请求中 2 部");
    expect(screen.getByRole("status").textContent).toContain("分析进度 0/3");
    expect(screen.getByRole("progressbar", { name: "本页分析进度" })).toHaveAttribute("value", "0");

    await act(async () => { resolveA({ ...pending("a"), metadataStatus: "ready" }); });
    await tick();
    expect(screen.getByRole("progressbar", { name: "本页分析进度" })).toHaveAttribute("value", "1");
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls[2][0].videoId).toBe("c");

    await act(async () => {
      resolveB({ ...pending("b"), metadataStatus: "ready" });
      resolveC({ ...pending("c"), metadataStatus: "ready" });
    });
    await tick();
    expect(screen.getByRole("status").textContent).toContain("本页处理完毕");
  });

  it("separates unanalysable items from retryable failures and retries only valid failed files on click", async () => {
    load.mockResolvedValue({ ...failed("bad"), metadataStatus: "ready" });
    render(<PageMetadataAutoAnalysis videos={[
      pending("pending"), failed("bad"),
      { ...pending("zero"), sizeBytes: 0 },
      { ...failed("missing"), isMissing: true }
    ]} active pageLoading={false} scopeKey="page1" />);
    expect(screen.getByRole("status").textContent).toContain("缺失/0B不可分析 2");
    expect(screen.getByRole("status").textContent).toContain("失败可重试 1");
    expect(load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重试本页失败项（1）" }));
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({ videoId: "bad", retry: true });
    expect(screen.getByRole("alert").textContent).toContain("重试完成：1 部视频分析成功");
  });

  it("retries failed items with two workers and fills a freed slot", async () => {
    let resolveA!: (value: VideoRecord) => void;
    let resolveB!: (value: VideoRecord) => void;
    let resolveC!: (value: VideoRecord) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveC = resolve; }));
    render(<PageMetadataAutoAnalysis videos={[failed("a"), failed("b"), failed("c")]} active pageLoading={false} scopeKey="page1" />);
    fireEvent.click(screen.getByRole("button", { name: "重试本页失败项（3）" }));
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map((call) => call[0].retry)).toEqual([true, true]);
    expect(screen.getByRole("progressbar", { name: "本页重试进度" })).toHaveAttribute("value", "0");

    await act(async () => { resolveA({ ...failed("a"), metadataStatus: "ready" }); });
    await tick();
    expect(screen.getByRole("progressbar", { name: "本页重试进度" })).toHaveAttribute("value", "1");
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls[2][0].videoId).toBe("c");

    await act(async () => {
      resolveB({ ...failed("b"), metadataStatus: "ready" });
      resolveC({ ...failed("c"), metadataStatus: "ready" });
    });
    await tick();
    expect(screen.getByRole("alert").textContent).toContain("重试完成：3 部视频分析成功");
  });

  it("cancels only old-page retry requests when navigating away", async () => {
    load.mockImplementation(() => new Promise(() => undefined));
    const { rerender } = render(<PageMetadataAutoAnalysis videos={[failed("a"), failed("a2")]} active pageLoading={false} scopeKey="page1" />);
    fireEvent.click(screen.getByRole("button", { name: "重试本页失败项（2）" }));
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    const oldIds = load.mock.calls.map((call) => call[0].requestId);

    rerender(<PageMetadataAutoAnalysis videos={[failed("b")]} active pageLoading={false} scopeKey="page2" />);
    expect(cancel).toHaveBeenCalledWith(oldIds[0]);
    expect(cancel).toHaveBeenCalledWith(oldIds[1]);
    await tick();
    expect(load).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "重试本页失败项（1）" }));
    await tick();
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls[2][0]).toMatchObject({ videoId: "b", retry: true });
  });

  it("keeps the visible pending/ready counts in sync with refreshed page records", () => {
    const { rerender } = render(<PageMetadataAutoAnalysis videos={[pending("a"), pending("b")]} active pageLoading={false} scopeKey="page1" />);
    expect(screen.getByRole("status").textContent).toContain("已就绪 0 · 待分析 2");

    rerender(<PageMetadataAutoAnalysis videos={[{ ...pending("a"), metadataStatus: "ready" }, pending("b")]} active pageLoading={false} scopeKey="page1" />);
    expect(screen.getByRole("status").textContent).toContain("已就绪 1 · 待分析 1");

    rerender(<PageMetadataAutoAnalysis videos={[{ ...pending("a"), metadataStatus: "ready" }, { ...pending("b"), metadataStatus: "ready" }]} active pageLoading={false} scopeKey="page1" />);
    expect(screen.getByRole("status").textContent).toContain("已就绪 2 · 待分析 0");
  });

  it("shows actual queued and executing counts for current-page analysis", async () => {
    load.mockImplementation(() => new Promise(() => undefined));
    getState.mockResolvedValue("queued");
    render(<PageMetadataAutoAnalysis videos={[pending("a"), pending("b")]} active pageLoading={false} scopeKey="page1" />);
    fireEvent.click(screen.getByRole("button", { name: "开启本页自动分析" }));
    await tick();
    expect(screen.getByRole("status").textContent).toContain("实际执行 0 · 排队 2");

    getState.mockResolvedValue("active");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("status").textContent).toContain("实际执行 2 · 排队 0");
  });

  it("cancels old-page automatic requests and starts work only for the new page", async () => {
    load.mockImplementation(() => new Promise(() => undefined));
    const { rerender } = render(<PageMetadataAutoAnalysis videos={[pending("a"), pending("a2")]} active pageLoading={false} scopeKey="page1" />);
    fireEvent.click(screen.getByRole("button", { name: "开启本页自动分析" }));
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    const oldIds = load.mock.calls.map((call) => call[0].requestId);

    rerender(<PageMetadataAutoAnalysis videos={[pending("b")]} active pageLoading={false} scopeKey="page2" />);
    expect(cancel).toHaveBeenCalledWith(oldIds[0]);
    expect(cancel).toHaveBeenCalledWith(oldIds[1]);
    await tick();
    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls[2][0]).toMatchObject({ videoId: "b", retry: false });
  });

  it("cancels automatic work while the page is inactive and resumes on reactivation", async () => {
    load.mockImplementation(() => new Promise(() => undefined));
    const { rerender } = render(<PageMetadataAutoAnalysis videos={[pending("a")]} active pageLoading={false} scopeKey="page1" />);
    fireEvent.click(screen.getByRole("button", { name: "开启本页自动分析" }));
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    const oldId = load.mock.calls[0][0].requestId;

    rerender(<PageMetadataAutoAnalysis videos={[pending("a")]} active={false} pageLoading={false} scopeKey="page1" />);
    expect(cancel).toHaveBeenCalledWith(oldId);
    await tick();
    expect(load).toHaveBeenCalledTimes(1);

    rerender(<PageMetadataAutoAnalysis videos={[pending("a")]} active pageLoading={false} scopeKey="page1" />);
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][0]).toMatchObject({ videoId: "a", retry: false });
  });

  it("does not automatically retry failed items and disables manual retry while automatic work is pending", async () => {
    load.mockImplementation(() => new Promise(() => undefined));
    render(<PageMetadataAutoAnalysis videos={[pending("pending"), failed("bad")]} active pageLoading={false} scopeKey="page1" />);
    const retryButton = screen.getByRole("button", { name: "重试本页失败项（1）" });
    expect(retryButton).toBeEnabled();
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "开启本页自动分析" }));
    expect(screen.getByRole("button", { name: "重试本页失败项（1）" })).toBeDisabled();
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({ videoId: "pending", retry: false });
  });
});

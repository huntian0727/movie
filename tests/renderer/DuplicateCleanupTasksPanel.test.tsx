import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DuplicateCleanupTasksPanel } from "../../src/renderer/components/DuplicateCleanupTasksPanel";
import type { DuplicateCleanupItemPage, DuplicateCleanupJob, DuplicateCleanupJobPage } from "../../src/shared/videoTypes";

function job(overrides: Partial<DuplicateCleanupJob> = {}): DuplicateCleanupJob {
  return {
    id: "job-1",
    requestId: "request-1",
    status: "completed",
    sourceView: "duplicates",
    totalGroups: 1,
    totalItems: 2,
    processedItems: 2,
    successItems: 2,
    failedItems: 0,
    skippedItems: 0,
    plannedReclaimableBytes: 2048,
    reclaimedBytes: 2048,
    createdAt: "2026-07-25T00:00:00.000Z",
    startedAt: "2026-07-25T00:00:01.000Z",
    completedAt: "2026-07-25T00:00:02.000Z",
    updatedAt: "2026-07-25T00:00:02.000Z",
    errorSummary: null,
    ...overrides
  };
}

function jobPage(items: DuplicateCleanupJob[]): DuplicateCleanupJobPage {
  return { items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, activeCount: items.filter((item) => ["queued", "running", "cancelling", "interrupted"].includes(item.status)).length };
}

function itemPage(items: DuplicateCleanupItemPage["items"] = []): DuplicateCleanupItemPage {
  return { items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 };
}

function renderPanel(overrides: Partial<Parameters<typeof DuplicateCleanupTasksPanel>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    loadJobs: vi.fn().mockResolvedValue(jobPage([job()])),
    loadItems: vi.fn().mockResolvedValue(itemPage()),
    onCancel: vi.fn().mockResolvedValue(job({ status: "cancelled" })),
    onResume: vi.fn().mockResolvedValue(job({ status: "queued" })),
    onRetry: vi.fn().mockResolvedValue(job({ status: "queued" })),
    onClear: vi.fn().mockResolvedValue(true),
    onOpenItem: vi.fn().mockResolvedValue(true),
    refreshSequence: 0,
    ...overrides
  };
  return { props, rendered: render(<DuplicateCleanupTasksPanel {...props} />) };
}

describe("DuplicateCleanupTasksPanel", () => {
  it("renders nothing when closed", () => {
    const { rendered } = renderPanel({ open: false });
    expect(rendered.container).toBeEmptyDOMElement();
  });

  it("renders the job list with progress and reclaimed bytes", async () => {
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([job()])) });
    expect(await screen.findByText(/已完成/)).toBeInTheDocument();
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
    expect(screen.getByText(/已释放 2 KB/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no jobs", async () => {
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([])) });
    expect(await screen.findByText("暂无后台清理任务")).toBeInTheDocument();
  });

  it("selects a job and shows per-item results", async () => {
    const loadItems = vi.fn().mockResolvedValue(itemPage([
      {
        id: "item-1", jobId: "job-1", groupKey: "g", keepVideoId: "keep", deleteVideoId: "delete",
        filename: "clip-a.mp4", directory: "D:\\Movies", expectedDeleteSizeBytes: 1024,
        plannedReclaimableBytes: 1024, status: "deleted", outcomeCode: "deleted", message: null, updatedAt: "2026-07-25T00:00:00.000Z"
      }
    ]));
    renderPanel({ loadItems });

    fireEvent.click(await screen.findByRole("button", { name: /已完成/ }));
    await waitFor(() => expect(loadItems).toHaveBeenCalledWith("job-1", 1, 50));
    expect(screen.getByText("clip-a.mp4")).toBeInTheDocument();
    expect(screen.getByText(/成功 2 · 失败 0 · 跳过 0/)).toBeInTheDocument();
  });

  it("shows cancel for active jobs and invokes it", async () => {
    const onCancel = vi.fn().mockResolvedValue(job({ status: "cancelled" }));
    const loadJobs = vi.fn().mockResolvedValueOnce(jobPage([job({ status: "running" })])).mockResolvedValue(jobPage([job({ status: "cancelled" })]));
    renderPanel({ loadJobs, onCancel });

    fireEvent.click(await screen.findByRole("button", { name: /正在清理/ }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    await waitFor(() => expect(onCancel).toHaveBeenCalledWith("job-1"));
    expect((await screen.findAllByText(/已取消/)).length).toBeGreaterThan(0);
  });

  it("shows resume only for interrupted jobs", async () => {
    const onResume = vi.fn().mockResolvedValue(job({ status: "queued" }));
    const loadJobs = vi.fn().mockResolvedValueOnce(jobPage([job({ status: "interrupted" })])).mockResolvedValue(jobPage([job({ status: "queued" })]));
    renderPanel({ loadJobs, onResume });

    fireEvent.click(await screen.findByRole("button", { name: /已中断/ }));
    expect(await screen.findByRole("button", { name: "恢复" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));

    await waitFor(() => expect(onResume).toHaveBeenCalledWith("job-1"));
    expect((await screen.findAllByText(/等待执行/)).length).toBeGreaterThan(0);
  });

  it("shows retry only for terminal jobs with failures", async () => {
    const onRetry = vi.fn().mockResolvedValue(job({ status: "queued" }));
    const loadJobs = vi.fn().mockResolvedValueOnce(jobPage([job({ status: "completed_with_errors", failedItems: 1 })])).mockResolvedValue(jobPage([job({ status: "queued" })]));
    renderPanel({ loadJobs, onRetry });

    fireEvent.click(await screen.findByRole("button", { name: /完成但有异常/ }));
    fireEvent.click(await screen.findByRole("button", { name: "重试失败项" }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("job-1"));
    expect((await screen.findAllByText(/等待执行/)).length).toBeGreaterThan(0);
  });

  it("clears terminal records and deselects the job", async () => {
    const onClear = vi.fn().mockResolvedValue(true);
    const loadJobs = vi.fn()
      .mockResolvedValueOnce(jobPage([job()]))
      .mockResolvedValue(jobPage([]));
    renderPanel({ loadJobs, onClear });

    fireEvent.click(await screen.findByRole("button", { name: /已完成/ }));
    fireEvent.click(await screen.findByRole("button", { name: /清除记录/ }));

    await waitFor(() => expect(onClear).toHaveBeenCalledWith("job-1"));
    expect(await screen.findByText("暂无后台清理任务")).toBeInTheDocument();
    expect(screen.getByText("选择任务查看逐项结果。")).toBeInTheDocument();
  });

  it("displays action errors without unmounting", async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error("任务状态不允许重试"));
    const loadJobs = vi.fn().mockResolvedValue(jobPage([job({ status: "completed_with_errors", failedItems: 1 })]));
    renderPanel({ loadJobs, onRetry });

    fireEvent.click(await screen.findByRole("button", { name: /完成但有异常/ }));
    fireEvent.click(await screen.findByRole("button", { name: /重试失败项/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("任务状态不允许重试");
    expect(screen.getByRole("button", { name: /重试失败项/ })).toBeInTheDocument();
  });

  it("closes via the header close button", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(await screen.findByRole("button", { name: "关闭后台任务" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reloads jobs when refreshSequence changes", async () => {
    const loadJobs = vi.fn().mockResolvedValue(jobPage([job()]));
    const { rendered } = renderPanel({ loadJobs });
    await screen.findByText(/已完成/);
    expect(loadJobs).toHaveBeenCalledTimes(1);

    await act(async () => { rendered.rerender(<DuplicateCleanupTasksPanel {...renderPanel({ loadJobs, refreshSequence: 1 }).props} />); });
    await waitFor(() => expect(loadJobs.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

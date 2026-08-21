import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DuplicateCleanupTasksPanel } from "../../src/renderer/components/DuplicateCleanupTasksPanel";
import type { DuplicateCleanupItemPage, DuplicateCleanupJob, DuplicateCleanupJobPage } from "../../src/shared/videoTypes";

function job(overrides: Partial<DuplicateCleanupJob> = {}): DuplicateCleanupJob {
  return {
    id: "11111111-1111-4111-8111-111111111111", requestId: "request-1", status: "completed", sourceView: "duplicates",
    totalGroups: 1, totalItems: 2, processedItems: 0, successItems: 0, failedItems: 0, skippedItems: 0,
    plannedReclaimableBytes: 2048, reclaimedBytes: 0, createdAt: "2026-07-25T00:00:00.000Z",
    startedAt: "2026-07-25T00:00:01.000Z", completedAt: null, updatedAt: "2026-07-25T00:00:02.000Z", errorSummary: null,
    workflowVersion: 2, phase: "awaiting_confirmation", verificationRevision: "22222222-2222-4222-8222-222222222222",
    verificationProcessedItems: 2, identicalItems: 1, differentItems: 1, unverifiableItems: 0,
    verificationCompletedAt: "2026-07-25T00:00:02.000Z", authorizedRevision: null, authorizedAt: null,
    ...overrides
  };
}
function jobPage(items: DuplicateCleanupJob[]): DuplicateCleanupJobPage {
  return { items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, activeCount: items.length };
}
function itemPage(items: DuplicateCleanupItemPage["items"] = []): DuplicateCleanupItemPage {
  return { items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 };
}
function renderPanel(overrides: Partial<Parameters<typeof DuplicateCleanupTasksPanel>[0]> = {}) {
  const props: Parameters<typeof DuplicateCleanupTasksPanel>[0] = {
    open: true, onClose: vi.fn(), loadJobs: vi.fn().mockResolvedValue(jobPage([job()])),
    loadItems: vi.fn().mockResolvedValue(itemPage()), onConfirm: vi.fn().mockResolvedValue(job({ phase: "deletion", status: "queued" })),
    onCancel: vi.fn().mockResolvedValue(job({ phase: "finished", status: "cancelled" })),
    onResume: vi.fn().mockResolvedValue(job({ phase: "verification", status: "queued" })),
    onRetry: vi.fn().mockResolvedValue(job({ phase: "verification", status: "queued" })),
    onClear: vi.fn().mockResolvedValue(true), onOpenItem: vi.fn().mockResolvedValue(true), ...overrides
  };
  return { props, rendered: render(<DuplicateCleanupTasksPanel {...props} />) };
}

describe("DuplicateCleanupTasksPanel SHA-256 safety UI", () => {
  it("renders nothing while closed", () => {
    const { rendered } = renderPanel({ open: false });
    expect(rendered.container).toBeEmptyDOMElement();
  });

  it("shows the three verification outcomes and keeps non-identical results out of deletion", async () => {
    renderPanel();
    await selectTask(/等待第二次确认/);
    expect(screen.getByText(/相同 1 · 不同 1 · 无法验证 0/)).toBeInTheDocument();
    expect(screen.getByText(/其他结果不会删除/)).toBeInTheDocument();
  });

  it("requires exact case-sensitive untrimmed DELETE before enabling the second confirmation", async () => {
    const onConfirm = vi.fn().mockResolvedValue(job({ phase: "deletion", status: "queued" }));
    renderPanel({ onConfirm });
    fireEvent.click(await screen.findByRole("button", { name: /等待第二次确认/ }));
    fireEvent.click(screen.getByRole("button", { name: "第二次确认永久删除" }));
    const input = screen.getByRole("textbox");
    const submit = screen.getByRole("button", { name: "永久删除已验证相同项" });
    for (const invalid of ["delete", " DELETE", "DELETE "]) {
      fireEvent.change(input, { target: { value: invalid } });
      expect(submit).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: "DELETE" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      jobId: "11111111-1111-4111-8111-111111111111",
      verificationRevision: "22222222-2222-4222-8222-222222222222",
      confirmation: "DELETE"
    }));
  });

  it("focuses the typed confirmation, closes it with Escape, and restores focus to its trigger", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /等待第二次确认/ }));
    const trigger = screen.getByRole("button", { name: "第二次确认永久删除" });
    fireEvent.click(trigger);
    const input = screen.getByRole("textbox");
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("uses distinct cancellation wording for verification and deletion", async () => {
    const loadJobs = vi.fn().mockResolvedValue(jobPage([
      job({ id: "v", phase: "verification", status: "running", verificationProcessedItems: 1 }),
      job({ id: "d", phase: "deletion", status: "running", processedItems: 1 })
    ]));
    renderPanel({ loadJobs });
    await selectTask(/正在完整验证/);
    expect(screen.getByRole("button", { name: /取消验证/ })).toBeInTheDocument();
    expect(screen.getByText(/取消验证会等待当前读取安全停止；验证阶段不会删除任何文件/)).toBeInTheDocument();
    await selectTask(/正在永久删除已授权项/);
    expect(screen.getByRole("button", { name: /停止剩余删除/ })).toBeInTheDocument();
    expect(screen.getByText(/已经完成的永久删除无法撤销/)).toBeInTheDocument();
    expect(screen.getByText(/只阻止尚未开始的项目/)).toBeInTheDocument();
  });

  it("labels resume and retry as a new full verification", async () => {
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([job({ phase: "deletion", status: "interrupted" })])) });
    await selectTask(/正在永久删除已授权项/);
    expect(screen.getByRole("button", { name: "重新完整验证" })).toBeInTheDocument();
    expect(screen.getByText(/原删除授权已失效/)).toHaveTextContent(/重新完整验证/);
  });

  it("renders per-item tri-state evidence", async () => {
    const loadItems = vi.fn().mockResolvedValue(itemPage([{
      id: "item-1", jobId: "job-1", groupKey: "g", keepVideoId: "keep", deleteVideoId: "delete",
      filename: "clip-a.mp4", directory: "D:\\Movies", expectedDeleteSizeBytes: 1024, plannedReclaimableBytes: 1024,
      status: "skipped", outcomeCode: "content-different", message: null, updatedAt: "2026-07-25T00:00:00.000Z",
      verificationStatus: "content-different", verificationRevision: "rev", verifiedAt: "2026-07-25T00:00:00.000Z", verificationError: null
    }]));
    renderPanel({ loadItems });
    fireEvent.click(await screen.findByRole("button", { name: /等待第二次确认/ }));
    expect(await screen.findByText("内容不同（不删除）")).toBeInTheDocument();
  });

  it("does not offer permanent deletion for a task without an awaiting-confirmation authorization", async () => {
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([job({ phase: "finished", status: "completed_with_errors", identicalItems: 0, unverifiableItems: 2 })])) });
    await selectTask(/完成但有异常/);
    expect(screen.queryByRole("button", { name: /永久删除/ })).not.toBeInTheDocument();
  });

  it("closes from the header control", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(await screen.findByRole("button", { name: "关闭任务中心" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("selects a task, loads its detail items, and opens the recorded directory", async () => {
    const onOpenItem = vi.fn().mockResolvedValue(true);
    const loadItems = vi.fn().mockResolvedValue(itemPage([{
      id: "item-detail", jobId: "11111111-1111-4111-8111-111111111111", groupKey: "g", keepVideoId: "keep", deleteVideoId: "delete",
      filename: "detail.mp4", directory: "D:\\Movies", expectedDeleteSizeBytes: 1024, plannedReclaimableBytes: 1024,
      status: "skipped", outcomeCode: "content-different", message: "not identical", updatedAt: "2026-07-25T00:00:00.000Z",
      verificationStatus: "content-different", verificationRevision: "rev", verifiedAt: "2026-07-25T00:00:00.000Z",
      verificationError: null, stagedDeletePath: null
    }]));
    renderPanel({ loadItems, onOpenItem });
    fireEvent.click(await screen.findByRole("button", { name: /等待第二次确认/ }));
    expect(await screen.findByText("detail.mp4")).toBeInTheDocument();
    expect(loadItems).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", 1, 50);
    fireEvent.click(screen.getByRole("button", { name: /打开 detail\.mp4 所在文件夹/ }));
    expect(onOpenItem).toHaveBeenCalledWith("item-detail");
  });

  it("surfaces action errors while keeping the selected task mounted", async () => {
    const onCancel = vi.fn().mockRejectedValue(new Error("cancel failed safely"));
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([job({ phase: "verification", status: "running" })])), onCancel });
    fireEvent.click(await screen.findByRole("button", { name: /正在完整验证/ }));
    fireEvent.click(screen.getByRole("button", { name: /取消验证/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cancel failed safely");
    expect(screen.getByRole("button", { name: /取消验证/ })).toBeInTheDocument();
  });

  it("clears a terminal task and deselects its detail", async () => {
    const onClear = vi.fn().mockResolvedValue(true);
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([job({ phase: "finished", status: "completed" })])), onClear });
    fireEvent.click(await screen.findByRole("button", { name: /已完成/ }));
    fireEvent.click(screen.getByRole("button", { name: /清除记录/ }));
    await waitFor(() => expect(onClear).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111"));
    expect(screen.getByText(/选择任务查看完整验证结果/)).toBeInTheDocument();
  });

  it("reloads the task list and selected details when refreshSequence changes", async () => {
    const loadJobs = vi.fn().mockResolvedValue(jobPage([job()]));
    const loadItems = vi.fn().mockResolvedValue(itemPage());
    const { rendered } = renderPanel({ loadJobs, loadItems, refreshSequence: 1 });
    await waitFor(() => expect(loadJobs).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /等待第二次确认/ }));
    await waitFor(() => expect(loadItems).toHaveBeenCalledTimes(1));
    rendered.rerender(<DuplicateCleanupTasksPanel {...renderPanelProps(loadJobs, loadItems)} refreshSequence={2} />);
    await waitFor(() => expect(loadJobs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadItems).toHaveBeenCalledTimes(2));
  });

  it("maps version changes and isolation recovery to stable authorization-invalidated guidance", async () => {
    const loadItems = vi.fn().mockResolvedValue(itemPage([
      {
        id: "changed", jobId: "job", groupKey: "g", keepVideoId: "keep", deleteVideoId: "changed-video",
        filename: "changed.mp4", directory: "D:\\Movies", expectedDeleteSizeBytes: 1024, plannedReclaimableBytes: 1024,
        status: "skipped", outcomeCode: "final-delete-integrity-changed", message: "raw internal mismatch", updatedAt: "2026-07-25T00:00:00.000Z",
        verificationStatus: "verified-identical", verificationRevision: "rev", verifiedAt: "2026-07-25T00:00:00.000Z", verificationError: null, stagedDeletePath: null
      },
      {
        id: "recovery", jobId: "job", groupKey: "g", keepVideoId: "keep", deleteVideoId: "recovery-video",
        filename: "recovery.mp4", directory: "D:\\Movies", expectedDeleteSizeBytes: 1024, plannedReclaimableBytes: 1024,
        status: "failed", outcomeCode: "isolation-recovery-required", message: "raw recovery error", updatedAt: "2026-07-25T00:00:00.000Z",
        verificationStatus: "verified-identical", verificationRevision: "rev", verifiedAt: "2026-07-25T00:00:00.000Z", verificationError: null,
        stagedDeletePath: "D:\\Movies\\.recovery.movie-delete-id"
      }
    ]));
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([job({ phase: "finished", status: "completed_with_errors" })])), loadItems });
    await selectTask(/完成但有异常/);

    expect(await screen.findByText(/未永久删除。文件版本或身份已变化，删除授权已失效。请重新完整验证/)).toBeInTheDocument();
    expect(screen.getByText(/隔离恢复未完成；此项未永久删除。删除授权已失效/)).toHaveTextContent(/\.recovery\.movie-delete-id/);
    expect(screen.queryByText(/raw internal mismatch|raw recovery error/)).not.toBeInTheDocument();
    expect(screen.queryByText(/完整哈希相同 ·/)).not.toBeInTheDocument();
  });

  it("maps isolation failure and restored or pending stop outcomes without raw messages or verified-identical prefixes", async () => {
    const baseItem = {
      jobId: "job", groupKey: "g", keepVideoId: "keep", directory: "D:\\Movies",
      expectedDeleteSizeBytes: 1024, plannedReclaimableBytes: 1024, updatedAt: "2026-07-25T00:00:00.000Z",
      verificationStatus: "verified-identical" as const, verificationRevision: "rev",
      verifiedAt: "2026-07-25T00:00:00.000Z", verificationError: null
    };
    const loadItems = vi.fn().mockResolvedValue(itemPage([
      {
        ...baseItem, id: "isolation-failed", deleteVideoId: "isolation-video", filename: "isolation.mp4",
        status: "failed", outcomeCode: "isolation-failed", message: "Could not isolate EACCES", stagedDeletePath: null
      },
      {
        ...baseItem, id: "stop-restored", deleteVideoId: "stop-restored-video", filename: "stop-restored.mp4",
        status: "cancelled", outcomeCode: "delete-stop-requested", message: "Remaining deletion was stopped.", stagedDeletePath: null
      },
      {
        ...baseItem, id: "stop-recovery", deleteVideoId: "stop-recovery-video", filename: "stop-recovery.mp4",
        status: "failed", outcomeCode: "delete-stop-requested", message: "Isolated file retained at internal path.",
        stagedDeletePath: "D:\\Movies\\.stop-recovery.movie-delete-id"
      },
      {
        ...baseItem, id: "delete-error", deleteVideoId: "delete-error-video", filename: "delete-error.mp4",
        status: "failed", outcomeCode: "EBUSY", message: "resource busy or locked", stagedDeletePath: null
      },
      {
        ...baseItem, id: "deleted", deleteVideoId: "deleted-video", filename: "deleted.mp4",
        status: "deleted", outcomeCode: "deleted", message: null, stagedDeletePath: null
      }
    ]));
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([job({ phase: "finished", status: "completed_with_errors" })])), loadItems });
    await selectTask(/完成但有异常/);

    const isolation = (await screen.findByText("isolation.mp4")).closest("article");
    const stopRestored = screen.getByText("stop-restored.mp4").closest("article");
    const stopRecovery = screen.getByText("stop-recovery.mp4").closest("article");
    const deleteError = screen.getByText("delete-error.mp4").closest("article");
    const deleted = screen.getByText("deleted.mp4").closest("article");
    expect(isolation).toHaveTextContent("安全隔离失败；未永久删除。删除授权已失效");
    expect(isolation).toHaveTextContent("解决文件占用、权限或存储连接问题后重新完整验证");
    expect(stopRestored).toHaveTextContent("停止请求已生效；此项未永久删除。删除授权已失效");
    expect(stopRestored).toHaveTextContent("以后如需清理，请重新完整验证");
    expect(stopRecovery).toHaveTextContent("请先恢复隔离文件，再重新完整验证");
    expect(stopRecovery).toHaveTextContent(".stop-recovery.movie-delete-id");
    expect(deleteError).toHaveTextContent("此项未永久删除。删除授权已失效。请检查文件状态后重新完整验证");
    expect(deleted).toHaveTextContent("已永久删除");
    for (const row of [isolation, stopRestored, stopRecovery, deleteError]) {
      expect(row).not.toHaveTextContent("完整哈希相同");
    }
    expect(screen.queryByText(/Could not isolate|Remaining deletion|Isolated file retained|resource busy/)).not.toBeInTheDocument();
  });

  it("labels progress and publishes throttled item-level live updates", async () => {
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([
      job({ phase: "verification", status: "running", verificationProcessedItems: 1, totalItems: 2 })
    ])) });
    await selectTask(/正在完整验证/);
    expect(screen.getByRole("progressbar", { name: "正在完整验证进度" })).toHaveAttribute("value", "1");
    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(live).toHaveTextContent("已处理 1 / 2 项"), { timeout: 1200 });
  });

  it("shows the full authorization summary before the final destructive action", async () => {
    renderPanel({ loadJobs: vi.fn().mockResolvedValue(jobPage([job({ totalGroups: 2, identicalItems: 3, plannedReclaimableBytes: 4096 })])) });
    await selectTask(/等待第二次确认/);
    const reviewTrigger = screen.getByRole("button", { name: "第二次确认永久删除" });
    expect(reviewTrigger).not.toHaveClass("danger");
    fireEvent.click(reviewTrigger);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/2 个候选组/);
    expect(dialog).toHaveTextContent(/3 个经完整 SHA-256 验证相同的候选移除项/);
    expect(dialog).toHaveTextContent(/候选可释放空间上限为 4 KB/);
    expect(dialog).toHaveTextContent(/再次完整核验哈希、强文件身份、大小和修改时间/);
    expect(screen.getByRole("button", { name: "永久删除已验证相同项" })).toHaveClass("danger");
  });
});

async function selectTask(name: string | RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name }));
  await act(async () => { await Promise.resolve(); });
}

function renderPanelProps(
  loadJobs: Parameters<typeof DuplicateCleanupTasksPanel>[0]["loadJobs"],
  loadItems: Parameters<typeof DuplicateCleanupTasksPanel>[0]["loadItems"]
): Parameters<typeof DuplicateCleanupTasksPanel>[0] {
  return {
    open: true, onClose: vi.fn(), loadJobs, loadItems,
    onConfirm: vi.fn().mockResolvedValue(job({ phase: "deletion", status: "queued" })),
    onCancel: vi.fn().mockResolvedValue(job({ phase: "finished", status: "cancelled" })),
    onResume: vi.fn().mockResolvedValue(job({ phase: "verification", status: "queued" })),
    onRetry: vi.fn().mockResolvedValue(job({ phase: "verification", status: "queued" })),
    onClear: vi.fn().mockResolvedValue(true), onOpenItem: vi.fn().mockResolvedValue(true)
  };
}

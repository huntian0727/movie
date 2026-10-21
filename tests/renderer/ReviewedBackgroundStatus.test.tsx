// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewedBackgroundStatus } from "../../src/renderer/components/ReviewedBackgroundStatus";
import type { ReviewedDeleteBackgroundJob } from "../../src/shared/videoTypes";

const job: ReviewedDeleteBackgroundJob = {
  id: "mock", status: "running", total: 60, processed: 30,
  successCount: 28, failureCount: 2, uncertainCount: 0, unsubmittedCount: 30,
  reclaimedBytes: 123456, recycledCount: 1, failures: [
    { videoId: "failed", groupKey: "group", path: "/cloud/failed.mp4", message: "permission denied" }
  ], message: "已确认 30/60", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z"
};

describe("cross-view background duplicate status", () => {
  it("keeps the task visible and lets the user expand detail without blocking other controls", () => {
    render(<><button type="button">播放其他视频</button><ReviewedBackgroundStatus job={job} /></>);
    expect(screen.getByText("重复文件后台清理中")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "后台重复文件清理进度" })).toHaveAttribute("value", "30");
    fireEvent.click(screen.getByRole("button", { name: "播放其他视频" }));
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
    expect(screen.getByText(/完成前请保持程序开启/)).toBeInTheDocument();
  });
  it("removes a successfully completed checkpoint instead of leaving a permanent progress bar", () => {
    const rendered = render(<ReviewedBackgroundStatus job={job} />);
    expect(screen.getByRole("progressbar", { name: "后台重复文件清理进度" })).toBeInTheDocument();
    rendered.rerender(<ReviewedBackgroundStatus job={{ ...job, status: "completed", processed: 60,
      successCount: 60, failureCount: 0, unsubmittedCount: 0 }} />);
    expect(screen.queryByRole("region", { name: "重复文件后台清理状态" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "后台重复文件清理进度" })).not.toBeInTheDocument();
  });

  it("does not hide failed or blocked outcomes needing manual inspection", () => {
    const rendered = render(<ReviewedBackgroundStatus job={{ ...job, status: "partial" }} />);
    expect(screen.getByText("重复文件清理部分失败")).toBeInTheDocument();
    rendered.rerender(<ReviewedBackgroundStatus job={{ ...job, status: "blocked", uncertainCount: 3 }} />);
    expect(screen.getByText("重复文件后台清理已停止")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.getByText(/结果未知的文件不能自动重试/)).toBeInTheDocument();
  });

  it("shows interrupted and unknown results without suggesting an automatic retry", () => {
    render(<ReviewedBackgroundStatus job={{ ...job, status: "interrupted", uncertainCount: 30,
      message: "任务异常停止，未知结果不可自动重试" }} />);
    expect(screen.getByText("上次重复文件后台清理中断")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.getByText(/结果未知的文件不能自动重试/)).toBeInTheDocument();
  });
});

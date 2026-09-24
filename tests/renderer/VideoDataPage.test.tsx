import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { VideoDataPage } from "../../src/renderer/components/VideoDataPage";
import type { VideoDataQuery, VideoDataRow } from "../../src/shared/videoDataTable";
const video = { id: "v1", filename: "one.mp4", path: "F:\\one.mp4", directory: "F:\\", sizeBytes: 100, durationMs: null, importedAt: "2026-09-08T00:00:00.000Z", sourceType: "local", sourcePath: "F:\\", metadataStatus: "ready" } as VideoDataRow;
beforeEach(() => localStorage.clear());
it("selects all filtered results without loading all rows and exports exclusions", async () => {
  const load = vi.fn(async (query: VideoDataQuery) => ({ items: [{ ...video, id: `v${query.page}`, filename: `${query.page}.mp4` }], totalCount: 320000, totalBytes: 32000000, totalPages: 3200, page: query.page, pageSize: query.pageSize }));
  const exportCsv = vi.fn(async () => ({ cancelled: false, count: 319999, path: "test.csv" }));
  render(<VideoDataPage load={load} exportCsv={exportCsv} folders={[]} onPlay={vi.fn()} onDetails={vi.fn()} onDiagnostic={vi.fn()} />);
  await screen.findByText("1.mp4");
  fireEvent.click(screen.getByRole("button", { name: "选择全部筛选结果" }));
  expect(load).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择 1.mp4" }));
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("2.mp4");
  expect(screen.getByRole("checkbox", { name: "选择 2.mp4" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "导出选中 CSV" }));
  await waitFor(() => expect(exportCsv).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }), { all: true, ids: [], excludedIds: ["v1"] }));
  expect(document.querySelector("img")).toBeNull();
});
it("plays only the clicked video, keeps details separate, and clears selection when filters change", async () => {
  const load = vi.fn(async (query: VideoDataQuery) => ({ items: [video], totalCount: 1, totalBytes: 100, totalPages: 1, page: query.page, pageSize: query.pageSize }));
  const play = vi.fn();
  const details = vi.fn();
  render(<VideoDataPage load={load} exportCsv={vi.fn()} folders={[]} onPlay={play} onDetails={details} onDiagnostic={vi.fn()} />);
  await screen.findByText("one.mp4");
  fireEvent.click(screen.getByRole("checkbox", { name: "全选本页" }));
  fireEvent.click(screen.getByRole("button", { name: "播放 one.mp4" }));
  expect(play).toHaveBeenCalledWith(video);
  expect(details).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "详情" }));
  expect(details).toHaveBeenCalledWith(video);
  fireEvent.change(screen.getByLabelText("状态"), { target: { value: "missing" } });
  await waitFor(() => expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ status: "missing", page: 1 })));
  expect(screen.getByRole("button", { name: "导出选中 CSV" })).toBeDisabled();
});
it("prevents repeat player opens and reports a launch failure without blocking table actions", async () => {
  const load = vi.fn(async (query: VideoDataQuery) => ({ items: [video], totalCount: 1, totalBytes: 100, totalPages: 1, page: query.page, pageSize: query.pageSize }));
  let rejectOpen!: (error: Error) => void;
  const play = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectOpen = reject; }));
  const details = vi.fn();
  render(<VideoDataPage load={load} exportCsv={vi.fn()} folders={[]} onPlay={play} onDetails={details} onDiagnostic={vi.fn()} />);
  await screen.findByText("one.mp4");
  fireEvent.click(screen.getByRole("button", { name: "播放 one.mp4" }));
  expect(screen.getByRole("button", { name: "播放 one.mp4" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "详情" }));
  expect(details).toHaveBeenCalledWith(video);
  expect(play).toHaveBeenCalledTimes(1);

  rejectOpen(new Error("文件暂不可访问"));
  expect(await screen.findByText("打开播放窗口失败：文件暂不可访问")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "播放 one.mp4" })).toBeEnabled();
});
it("deletes all filtered results after confirmation and removes visible rows immediately", async () => {
  const load = vi.fn(async (query: VideoDataQuery) => ({ items: [video], totalCount: 12, totalBytes: 1200, totalPages: 1, page: query.page, pageSize: query.pageSize }));
  let finish!: (value: { successCount: number; failureCount: number; reclaimedBytes: number; failures: [] }) => void;
  const deleteSelection = vi.fn(() => new Promise<{ successCount: number; failureCount: number; reclaimedBytes: number; failures: [] }>(resolve => { finish = resolve; }));
  render(<VideoDataPage load={load} exportCsv={vi.fn()} deleteSelection={deleteSelection} folders={[]} onPlay={vi.fn()} onDetails={vi.fn()} onDiagnostic={vi.fn()} />);
  await screen.findByText("one.mp4");
  fireEvent.click(screen.getByRole("button", { name: "选择全部筛选结果" }));
  fireEvent.click(screen.getByRole("button", { name: "批量永久删除" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("12 个视频");
  expect(screen.getByRole("alertdialog")).toHaveTextContent("不进行重复判定或 SHA-256 内容验证");
  fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));

  expect(deleteSelection).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }), { all: true, ids: [], excludedIds: [] });
  expect(screen.queryByText("one.mp4")).not.toBeInTheDocument();
  expect(screen.getByText(/正在永久删除 12 条选中记录/)).toBeInTheDocument();

  finish({ successCount: 12, failureCount: 0, reclaimedBytes: 1200, failures: [] });
  await waitFor(() => expect(screen.getByText(/批量删除完成：成功 12 条/)).toBeInTheDocument());
});

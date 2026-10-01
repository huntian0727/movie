import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoGrid } from "../../src/renderer/components/VideoGrid";
import { VideoTable } from "../../src/renderer/components/VideoTable";
import type { VideoRecord } from "../../src/shared/videoTypes";

vi.mock("../../src/renderer/components/VideoStoryboard", () => ({ VideoStoryboard: () => <div>截图条</div> }));
const video = { id: "v1", filename: "clip.mp4", extension: ".mp4", sizeBytes: 1024, durationMs: 90000, width: 1920, height: 1080, metadataStatus: "ready", modifiedAt: "2026-10-02T00:00:00Z", isFavorite: false, isPendingDelete: false, coverCachePath: null } as VideoRecord;
const callbacks = () => ({ onOpen: vi.fn(), onViewDetails: vi.fn(), onToggleFavorite: vi.fn(), onTogglePendingDelete: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onRegenerateCover: vi.fn().mockResolvedValue(undefined), onRetryMetadata: vi.fn(), onRevealInFolder: vi.fn().mockResolvedValue(undefined), onShowDirectory: vi.fn() });

describe("grid and list action parity", () => {
  it.each(["ready", "failed"] as const)("shares the exact order, labels, tooltips and icons for %s metadata", (metadataStatus) => {
    const item = { ...video, metadataStatus };
    const props = callbacks();
    const grid = render(<VideoGrid videos={[item]} {...props} />);
    const describeButtons = (root: Element) => [...root.querySelectorAll("button")].map((button) => ({ label: button.getAttribute("aria-label"), title: button.title, icon: button.querySelector("svg")?.getAttribute("class") }));
    const expected = describeButtons(grid.container.querySelector(".card-actions")!);
    expect(expected.map((item) => item.title)).toEqual(["收藏", "标记待删除", "重命名", "永久删除", "重新生成预览", ...(metadataStatus === "failed" ? ["重试读取视频时长、分辨率和格式"] : []), "打开所在文件夹", "只看同目录视频"]);
    grid.unmount();
    const table = render(<VideoTable videos={[item]} {...props} />);
    expect(describeButtons(table.container.querySelector(".row-actions")!).slice(1)).toEqual(expected);
    expect(screen.getByRole("button", { name: "查看 clip.mp4 详情" })).toBeInTheDocument();
  });

  it("passes the selected record to each list action and preserves selection", async () => {
    const props = callbacks();
    const onToggleSelection = vi.fn();
    render(<VideoTable videos={[{ ...video, metadataStatus: "failed" }]} {...props} selectionMode selectedIds={new Set(["v1"])} onToggleSelection={onToggleSelection} />);
    for (const [name, handler] of [
      ["查看 clip.mp4 详情", props.onViewDetails], ["收藏", props.onToggleFavorite], ["标记待删除", props.onTogglePendingDelete], ["重命名", props.onRename], ["删除", props.onDelete],
      ["重新生成 clip.mp4 的预览", props.onRegenerateCover], ["重新分析 clip.mp4", props.onRetryMetadata], ["打开 clip.mp4 所在文件夹", props.onRevealInFolder], ["查看 clip.mp4 同目录视频", props.onShowDirectory]
    ] as const) {
      await act(async () => fireEvent.click(screen.getByRole("button", { name })));
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", metadataStatus: "failed" }));
    }
    expect(screen.getByRole("checkbox", { name: "选择 clip.mp4" })).toBeChecked();
    expect(onToggleSelection).not.toHaveBeenCalled();
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("disables duplicate preview resets, shows failure and permits a retry", async () => {
    const props = callbacks();
    let reject!: (error: Error) => void;
    props.onRegenerateCover.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
    render(<VideoTable videos={[video]} {...props} />);
    const button = screen.getByRole("button", { name: "重新生成 clip.mp4 的预览" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByText("正在重置封面预览…")).toBeInTheDocument();
    fireEvent.click(button);
    expect(props.onRegenerateCover).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("offline")));
    expect(button).not.toBeDisabled();
    expect(screen.getByText("预览重置失败，可点击重新生成重试")).toBeInTheDocument();
    await act(async () => fireEvent.click(button));
    expect(props.onRegenerateCover).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/封面缓存已重置/)).toBeInTheDocument();
  });

  it.each([VideoGrid, VideoTable])("does not start playback when double-clicking an action", (View) => {
    const props = callbacks();
    render(<View videos={[video]} {...props} />);
    fireEvent.doubleClick(screen.getByRole("button", { name: "重命名" }));
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("omits unsupported optional actions instead of displaying dead buttons", () => {
    const props = callbacks();
    const { container } = render(<VideoTable videos={[video]} onOpen={props.onOpen} onViewDetails={props.onViewDetails} onToggleFavorite={props.onToggleFavorite} onRename={props.onRename} onDelete={props.onDelete} />);
    expect(within(container.querySelector(".row-actions")! as HTMLElement).getAllByRole("button")).toHaveLength(4);
  });
});

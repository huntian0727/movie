import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarDirectorySearch } from "../../src/renderer/components/SidebarDirectorySearch";
import type { DirectoryBrowserResult, SourceFolder } from "../../src/shared/videoTypes";

const source: SourceFolder = { id: "one", path: "D:\\Library", recursive: true, enabled: true, lastScannedAt: null, createdAt: "", updatedAt: "", scanError: null };
const result = (name: string): DirectoryBrowserResult => ({ items: [{ sourceFolderId: source.id, path: `${source.path}\\${name}`, name, videoCount: 1, sizeBytes: 1, modifiedAt: null }], totalCount: 1, truncated: false });
const defaults = { folders: [source], currentPath: source.path, selectedSourceId: source.id, refreshSequence: 0, focusSequence: 0, onActiveChange: vi.fn(), onNavigate: vi.fn() };
const input = () => screen.getByRole("searchbox", { name: "搜索资料库目录" });
const tick = () => act(async () => { vi.advanceTimersByTime(200); });

describe("SidebarDirectorySearch", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => vi.useRealTimers());

  it("debounces input and ignores an older response without navigating", async () => {
    let resolveOld!: (value: DirectoryBrowserResult) => void;
    const load = vi.fn().mockReturnValueOnce(new Promise<DirectoryBrowserResult>((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(result("Latest"));
    render(<SidebarDirectorySearch {...defaults} load={load} />);
    fireEvent.change(input(), { target: { value: "O" } });
    fireEvent.change(input(), { target: { value: "Old" } });
    expect(load).not.toHaveBeenCalled();
    await tick();
    fireEvent.change(input(), { target: { value: "Latest" } });
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith({ search: "Latest", sourceFolderId: undefined, limit: 100 }, "sidebar-directory-search");
    await act(async () => resolveOld(result("Old")));
    expect(screen.getByRole("button", { name: "进入目录 Latest" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入目录 Old" })).not.toBeInTheDocument();
    expect(defaults.onNavigate).not.toHaveBeenCalled();
  });

  it("changes source scope explicitly and follows the current source without retaining old results", async () => {
    const other = { ...source, id: "two", path: "E:\\Other" };
    const load = vi.fn().mockResolvedValue(result("Drama"));
    const rendered = render(<SidebarDirectorySearch {...defaults} folders={[source, other]} load={load} />);
    fireEvent.change(input(), { target: { value: "Drama" } });
    await tick();
    fireEvent.change(screen.getByRole("combobox", { name: "目录搜索范围" }), { target: { value: "current" } });
    expect(screen.queryByRole("button", { name: "进入目录 Drama" })).not.toBeInTheDocument();
    await tick();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ sourceFolderId: "one" }), "sidebar-directory-search");
    rendered.rerender(<SidebarDirectorySearch {...defaults} folders={[source, other]} currentPath={other.path} selectedSourceId={other.id} load={load} />);
    await tick();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ sourceFolderId: "two" }), "sidebar-directory-search");
    rendered.rerender(<SidebarDirectorySearch {...defaults} folders={[]} currentPath={null} selectedSourceId={undefined} load={load} />);
    await tick();
    expect(screen.getByText("请先选择一个资料库目录")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("highlights results, distinguishes paths and supports keyboard selection and clear", async () => {
    const load = vi.fn().mockResolvedValue({ ...result("Travel"), truncated: true, totalCount: 101 });
    const { container } = render(<SidebarDirectorySearch {...defaults} load={load} />);
    fireEvent.change(input(), { target: { value: "Travel" } });
    await tick();
    expect(container.querySelector("mark")).toHaveTextContent("Travel");
    expect(screen.getByText(`Library · ${source.path}`)).toBeInTheDocument();
    expect(screen.getByText("结果较多，仅显示前 100 个；请细化关键词。")).toBeInTheDocument();
    expect(screen.queryByText("101")).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    const choice = screen.getByRole("button", { name: "进入目录 Travel" });
    expect(choice).toHaveFocus();
    fireEvent.click(choice);
    expect(defaults.onNavigate).toHaveBeenCalledWith(`${source.path}\\Travel`, "one");
    expect(input()).toHaveValue("Travel");
    fireEvent.keyDown(choice, { key: "Escape" });
    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();
    expect(screen.queryByRole("region", { name: "目录搜索结果" })).not.toBeInTheDocument();
    expect(defaults.onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("retries failures, reports no matches and resets a temporary query on remount", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ items: [], totalCount: 0, truncated: false });
    const rendered = render(<SidebarDirectorySearch {...defaults} load={load} />);
    fireEvent.change(input(), { target: { value: "Absent" } });
    await tick();
    expect(screen.getByRole("alert")).toHaveTextContent("目录搜索失败");
    fireEvent.click(screen.getByRole("button", { name: "重试搜索" }));
    await tick();
    expect(screen.getByText("没有匹配的已入库目录")).toBeInTheDocument();
    rendered.unmount();
    render(<SidebarDirectorySearch {...defaults} load={load} />);
    await tick();
    expect(input()).toHaveValue("");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryFilterTree } from "../../src/renderer/components/DirectoryFilterTree";
import { DIRECTORY_TREE_ORDER_KEY } from "../../src/renderer/components/directoryTreeOrder";
import type { DirectoryBrowserResult, SourceFolder } from "../../src/shared/videoTypes";

const source: SourceFolder = { id: "source", path: "D:\\Library", recursive: true, enabled: true, lastScannedAt: null, createdAt: "", updatedAt: "", scanError: null };
const empty: DirectoryBrowserResult = { items: [], totalCount: 0, truncated: false };
const childResult = (name: string): DirectoryBrowserResult => ({ items: [{ sourceFolderId: source.id, path: `${source.path}\\${name}`, name, videoCount: 1, sizeBytes: 10, modifiedAt: null }], totalCount: 1, truncated: false });
const defaults = { folders: [source], currentPath: null, refreshSequence: 0, onNavigate: vi.fn(), onSearch: vi.fn(), renderSource: () => <button>Library</button> };
const handles = () => within(screen.getByRole("navigation", { name: "资料库来源" })).getAllByRole("button", { name: /^拖拽排序 / }).map((button) => button.getAttribute("aria-label"));
const dragOnto = (from: HTMLElement, to: HTMLElement, after = false) => {
  const row = to.parentElement!;
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 0, height: 50 } as DOMRect);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(to);
  pointer("pointerDown", from, 0, 0);
  pointer("pointerMove", from, 10, after ? 45 : 5);
  pointer("pointerUp", from, 10, after ? 45 : 5);
};
const pointer = (type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", target: HTMLElement, x: number, y: number) => {
  const event = createEvent[type](target);
  for (const [key, value] of Object.entries({ pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y })) Object.defineProperty(event, key, { value });
  fireEvent(target, event);
};

describe("DirectoryFilterTree", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); Object.defineProperty(document, "elementFromPoint", { value: () => null, configurable: true, writable: true }); });
  afterEach(() => vi.restoreAllMocks());
  it("does not read unopened sources and offers a read-only retry after failure", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(childResult("Drama"));
    render(<DirectoryFilterTree {...defaults} load={load} />);
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "展开或收起 Library" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目录读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByTitle(`${source.path}\\Drama`)).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps newer refresh results when an older request finishes later", async () => {
    let resolveOld!: (result: DirectoryBrowserResult) => void;
    const old = new Promise<DirectoryBrowserResult>((resolve) => { resolveOld = resolve; });
    const load = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(childResult("New"));
    const rendered = render(<DirectoryFilterTree {...defaults} load={load} />);
    fireEvent.click(screen.getByRole("button", { name: "展开或收起 Library" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rendered.rerender(<DirectoryFilterTree {...defaults} load={load} refreshSequence={1} />);
    expect(await screen.findByTitle(`${source.path}\\New`)).toBeInTheDocument();
    await act(async () => resolveOld(childResult("Old")));
    expect(screen.queryByTitle(`${source.path}\\Old`)).not.toBeInTheDocument();
  });

  it("reveals a selected search result beyond the sibling limit and offers directory search", async () => {
    const path = `${source.path}\\Season 101\\Episodes`;
    const load = vi.fn().mockImplementation((query) => Promise.resolve(query.parentPath === source.path ? { ...childResult("First"), truncated: true, totalCount: 101 } : empty));
    render(<DirectoryFilterTree {...defaults} load={load} currentPath={path} selectedSourceId={source.id} />);
    const selected = await screen.findByTitle(path);
    expect(selected).toHaveAttribute("aria-current", "location");
    fireEvent.click(screen.getByRole("button", { name: "仅显示前 100 个，搜索其他目录" }));
    expect(defaults.onSearch).toHaveBeenCalledOnce();
    const scopes = load.mock.calls.map((call) => call[1]);
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it("drags roots before and after siblings, persists across remounts, and resets without navigating", () => {
    const folders = [source, { ...source, id: "other", path: "E:\\Other" }, { ...source, id: "third", path: "F:\\Third" }];
    const props = { ...defaults, folders, renderSource: (folder: SourceFolder) => <button>{folder.id}</button> };
    const first = render(<DirectoryFilterTree {...props} />);
    dragOnto(screen.getByRole("button", { name: "拖拽排序 Third" }), screen.getByRole("button", { name: "拖拽排序 Library" }));
    expect(handles()).toEqual(["拖拽排序 Third", "拖拽排序 Library", "拖拽排序 Other"]);
    dragOnto(screen.getByRole("button", { name: "拖拽排序 Third" }), screen.getByRole("button", { name: "拖拽排序 Other" }), true);
    expect(handles()).toEqual(["拖拽排序 Library", "拖拽排序 Other", "拖拽排序 Third"]);
    dragOnto(screen.getByRole("button", { name: "拖拽排序 Other" }), screen.getByRole("button", { name: "拖拽排序 Library" }));
    first.unmount();
    render(<DirectoryFilterTree {...props} />);
    expect(handles()).toEqual(["拖拽排序 Other", "拖拽排序 Library", "拖拽排序 Third"]);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认排序" }));
    expect(handles()).toEqual(["拖拽排序 Library", "拖拽排序 Other", "拖拽排序 Third"]);
    expect(defaults.onNavigate).not.toHaveBeenCalled();
  });

  it("only reorders siblings in one branch and retains that order when refreshing adds a directory", async () => {
    const list = (names: string[], parent = source.path): DirectoryBrowserResult => ({ items: names.map((name) => ({ ...childResult(name).items[0], path: `${parent}\\${name}` })), totalCount: names.length, truncated: false });
    const load = vi.fn().mockImplementation((query) => Promise.resolve(query.parentPath === source.path ? list(["A", "B"]) : list(["Nested"], `${source.path}\\A`)));
    const props = { ...defaults, load, currentPath: `${source.path}\\A`, selectedSourceId: source.id };
    const first = render(<DirectoryFilterTree {...props} />);
    await screen.findByRole("button", { name: "拖拽排序 Nested" });
    dragOnto(screen.getByRole("button", { name: "拖拽排序 A" }), screen.getByRole("button", { name: "拖拽排序 B" }), true);
    expect(handles()).toEqual(["拖拽排序 Library", "拖拽排序 B", "拖拽排序 A", "拖拽排序 Nested"]);
    const saved = localStorage.getItem(DIRECTORY_TREE_ORDER_KEY);
    dragOnto(screen.getByRole("button", { name: "拖拽排序 Nested" }), screen.getByRole("button", { name: "拖拽排序 B" }));
    dragOnto(screen.getByRole("button", { name: "拖拽排序 B" }), screen.getByRole("button", { name: "拖拽排序 Library" }));
    expect(localStorage.getItem(DIRECTORY_TREE_ORDER_KEY)).toBe(saved);
    load.mockImplementation((query) => Promise.resolve(query.parentPath === source.path ? list(["A", "B", "C"]) : empty));
    first.rerender(<DirectoryFilterTree {...props} refreshSequence={1} />);
    await screen.findByRole("button", { name: "拖拽排序 C" });
    expect(handles()).toEqual(["拖拽排序 Library", "拖拽排序 B", "拖拽排序 A", "拖拽排序 C"]);
    expect(defaults.onNavigate).not.toHaveBeenCalled();
  });

  it("supports keyboard reorder, ignores external drops and reports persistence failures", () => {
    const folders = [source, { ...source, id: "other", path: "E:\\Other" }];
    localStorage.setItem(DIRECTORY_TREE_ORDER_KEY, "invalid JSON");
    render(<DirectoryFilterTree {...defaults} folders={folders} />);
    const other = screen.getByRole("button", { name: "拖拽排序 Other" });
    fireEvent.drop(other.parentElement!, { dataTransfer: { files: [new File([""], "test.txt")] } });
    expect(handles()).toEqual(["拖拽排序 Library", "拖拽排序 Other"]);
    const save = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.keyDown(other, { key: "ArrowUp", altKey: true });
    expect(handles()).toEqual(["拖拽排序 Other", "拖拽排序 Library"]);
    expect(screen.getByRole("status")).toHaveTextContent("无法保存");
    save.mockRestore();
  });

  it("does not reorder a handle click or a canceled pointer drag", () => {
    const folders = [source, { ...source, id: "other", path: "E:\\Other" }];
    render(<DirectoryFilterTree {...defaults} folders={folders} />);
    const handle = screen.getByRole("button", { name: "拖拽排序 Other" });
    const target = screen.getByRole("button", { name: "拖拽排序 Library" });
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    pointer("pointerDown", handle, 0, 0);
    pointer("pointerMove", handle, 1, 1);
    pointer("pointerUp", handle, 1, 1);
    expect(localStorage.getItem(DIRECTORY_TREE_ORDER_KEY)).toBeNull();
    pointer("pointerDown", handle, 0, 0);
    pointer("pointerMove", handle, 10, 10);
    fireEvent.keyDown(handle, { key: "Escape" });
    pointer("pointerUp", handle, 10, 10);
    pointer("pointerDown", handle, 0, 0);
    pointer("pointerMove", handle, 10, 10);
    pointer("pointerCancel", handle, 10, 10);
    pointer("pointerUp", handle, 10, 10);
    expect(handles()).toEqual(["拖拽排序 Library", "拖拽排序 Other"]);
    expect(localStorage.getItem(DIRECTORY_TREE_ORDER_KEY)).toBeNull();
    expect(defaults.onNavigate).not.toHaveBeenCalled();
  });

});

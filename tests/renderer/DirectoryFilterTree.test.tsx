import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DirectoryFilterTree } from "../../src/renderer/components/DirectoryFilterTree";
import type { DirectoryBrowserResult, SourceFolder } from "../../src/shared/videoTypes";

const source: SourceFolder = { id: "source", path: "D:\\Library", recursive: true, enabled: true, lastScannedAt: null, createdAt: "", updatedAt: "", scanError: null };
const empty: DirectoryBrowserResult = { items: [], totalCount: 0, truncated: false };
const childResult = (name: string): DirectoryBrowserResult => ({ items: [{ sourceFolderId: source.id, path: `${source.path}\\${name}`, name, videoCount: 1, sizeBytes: 10, modifiedAt: null }], totalCount: 1, truncated: false });
const defaults = { folders: [source], currentPath: null, refreshSequence: 0, onNavigate: vi.fn(), onSearch: vi.fn(), renderSource: () => <button>Library</button> };

describe("DirectoryFilterTree", () => {
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
    const onSearch = vi.fn();
    const load = vi.fn().mockImplementation((query) => Promise.resolve(query.parentPath === source.path ? { ...childResult("First"), truncated: true, totalCount: 101 } : empty));
    render(<DirectoryFilterTree {...defaults} load={load} currentPath={path} selectedSourceId={source.id} onSearch={onSearch} />);
    const selected = await screen.findByTitle(path);
    expect(selected).toHaveAttribute("aria-current", "location");
    fireEvent.click(screen.getByRole("button", { name: "仅显示前 100 个，搜索其他目录" }));
    expect(onSearch).toHaveBeenCalledOnce();
    const scopes = load.mock.calls.map((call) => call[1]);
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});

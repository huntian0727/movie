import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DirectoryBrowserPage } from "../../src/renderer/components/DirectoryBrowserPage";
import type { SourceFolder } from "../../src/shared/videoTypes";

it("merges image-only children into the normal directory cards and preserves indexed counts", async () => {
  const onNavigate = vi.fn();
  const indexed = { name: "已索引", path: "D:\\图库\\已索引", sourceFolderId: "source", videoCount: 7, sizeBytes: 0, modifiedAt: null };
  const listing = vi.fn().mockResolvedValue({
    sessionId: "session", offset: 0, totalCount: 0, truncated: false, files: [],
    directories: [indexed, { name: "只有图片", path: "D:\\图库\\只有图片" }]
  });
  const props = {
    compact: true, folders: [{ id: "source", path: "D:\\图库" } as SourceFolder], recentDirectories: [],
    selectedSourceId: "source", currentPath: "D:\\图库", scope: "exact" as const, focusSequence: 0, refreshSequence: 0,
    loadDirectories: vi.fn().mockResolvedValue({ items: [indexed], totalCount: 1, truncated: false }),
    loadVideos: vi.fn(), onNavigate, onScopeChange: vi.fn(), onViewAll: vi.fn(), onOpenVideo: vi.fn(), onVideoDetails: vi.fn(),
    imageApi: { listDirectoryImages: listing, closeImageDirectory: vi.fn().mockResolvedValue(undefined) }
  };
  const view = render(<DirectoryBrowserPage {...props} />);
  const imageDirectory = await screen.findByRole("button", { name: "打开文件夹 只有图片" });
  expect(screen.getAllByRole("button", { name: "打开文件夹 已索引" })).toHaveLength(1);
  expect(screen.getByText("含子目录 · 7 个视频")).toBeInTheDocument();
  fireEvent.click(imageDirectory);
  expect(onNavigate).toHaveBeenCalledWith("D:\\图库\\只有图片", "source");
  fireEvent.click(screen.getByRole("button", { name: "子目录" }));
  expect(imageDirectory).not.toBeInTheDocument();
  listing.mockResolvedValue({ sessionId: "next", offset: 0, totalCount: 0, truncated: false, files: [], directories: [] });
  props.loadDirectories.mockResolvedValue({ items: [], totalCount: 0, truncated: false });
  view.rerender(<DirectoryBrowserPage {...props} currentPath="D:\\图库\\只有图片" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "子目录" })).toHaveAttribute("aria-expanded", "true"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "打开文件夹 已索引" })).not.toBeInTheDocument());
});

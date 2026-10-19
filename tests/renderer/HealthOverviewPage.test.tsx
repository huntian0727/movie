import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HealthOverviewPage } from "../../src/renderer/components/HealthOverviewPage";
import type { AssetCenterSummary, LibraryNavigationSnapshot, SourceFolder } from "../../src/shared/videoTypes";

const fixture = (id: number, scanError: string | null): SourceFolder => ({
  id: "source-" + id, path: "D:\\Synthetic\\" + id,
  recursive: true, enabled: true, scanError, lastScannedAt: null,
  createdAt: "2026-10-19", updatedAt: "2026-10-19"
});
const makeSummary = (offlineSourceCount = 0, checkFailedSourceCount = 0) => ({
  offlineSourceCount, checkFailedSourceCount, scanFailureCount: 119_701,
  missingVideoCount: 299, metadataFailedCount: 5, metadataPendingCount: 10,
  generatedAt: "2026-10-19T06:00:00.000Z"
} as AssetCenterSummary);
function mount(folders: SourceFolder[], summary: AssetCenterSummary) {
  const onOpenAssetCenter = vi.fn();
  render(<HealthOverviewPage
    folders={folders} navigation={{ healthIssueCount: 120_000 } as LibraryNavigationSnapshot}
    refreshSequence={0} loadSummary={vi.fn().mockResolvedValue(summary)}
    onOpenScanFailures={vi.fn()} onOpenMissingVideos={vi.fn()}
    onOpenMetadataIssues={vi.fn()} onOpenAssetCenter={onOpenAssetCenter}
  />);
  return { onOpenAssetCenter };
}

describe("HealthOverviewPage source-level count semantics", () => {
  it("counts recorded source-level errors even when the latest accessibility report says zero", async () => {
    const folders = [1, 2, 3].map(id => fixture(id, "12 unresolved scan issue(s): network timeout"));
    mount(folders, makeSummary());
    await waitFor(() => expect(screen.getByText("至少 3")).toBeInTheDocument());
    expect(screen.getByText("至少 3 个来源")).toBeInTheDocument();
    expect(screen.getByText(/记录错误 3 · 最近离线 0 · 检查失败 0/)).toBeInTheDocument();
    expect(screen.getByText("需要核查的记录")).toBeInTheDocument();
    expect(screen.getByText("同一来源的多条记录不代表多个独立故障原因", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(/该来源有 12 条未解决的扫描记录/)).toHaveLength(3);
    expect(screen.queryByText(/unresolved scan issue\(s\)/)).not.toBeInTheDocument();
  });

  it("keeps accessibility-only problems visible without falsely asserting a distinct union", async () => {
    const { onOpenAssetCenter } = mount([fixture(1, null)], makeSummary(2, 1));
    await waitFor(() => expect(screen.getByText("至少 3")).toBeInTheDocument());
    expect(screen.getByText("至少 3 个来源")).toBeInTheDocument();
    expect(screen.getByText(/最近离线 2 · 检查失败 1/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "资料库来源需要检查" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /检查来源状态/ }));
    expect(onOpenAssetCenter).toHaveBeenCalledOnce();
  });
});

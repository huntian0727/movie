import { describe, expect, it } from "vitest";
import type { DuplicateCleanupJob, DuplicateGroup, DuplicateResolveChangedItem, VideoRecord } from "../../src/shared/videoTypes";
import { changeTypeLabel, formatRemainingTime, isCleanupJobFinished, normalizeDirectoryForComparison, planVideoIds, toDuplicateActionMessage } from "../../src/renderer/components/duplicatePageHelpers";
import { operationErrorMessage } from "../../src/renderer/components/operationErrorMessage";

function group(groupKey: string, ids: string[], recommendedKeepVideoId: string): DuplicateGroup {
  return {
    groupKey,
    identityStatus: "size_duration_match",
    items: ids.map((id) => ({ video: { id } as VideoRecord, isRecommendedToKeep: id === recommendedKeepVideoId, keepReason: null })),
    recommendedKeepVideoId,
    reclaimableBytes: 0
  };
}

describe("duplicate page pure helpers", () => {
  it("plans IDs with recommended keepers first when no manual choice exists", () => {
    expect(planVideoIds([group("g1", ["a", "b", "c"], "a"), group("g2", ["d", "e"], "d")], {})).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("honors the manually selected keeper and keeps the remaining group order", () => {
    expect(planVideoIds([group("g1", ["a", "b", "c"], "a"), group("g2", ["d", "e"], "d")], { g1: "c" })).toEqual(["c", "a", "b", "d", "e"]);
  });

  it("normalizes slash direction, trailing separators and case for directory comparison", () => {
    expect(normalizeDirectoryForComparison("D:/Movies/Sub///")).toBe("d:\\movies\\sub");
    expect(normalizeDirectoryForComparison("D:\\Movies\\Sub")).toBe("d:\\movies\\sub");
    expect(normalizeDirectoryForComparison("\\\\SERVER\\Share\\")).toBe("\\\\server\\share");
  });

  it("only marks cancelled and terminal completion states as finished", () => {
    const finished: DuplicateCleanupJob["status"][] = ["cancelled", "completed", "completed_with_errors"];
    const active: DuplicateCleanupJob["status"][] = ["queued", "running", "cancelling", "interrupted"];
    for (const status of finished) expect(isCleanupJobFinished({ status })).toBe(true);
    for (const status of active) expect(isCleanupJobFinished({ status })).toBe(false);
  });

  it("formats unknown and invalid durations as calculating", () => {
    expect(formatRemainingTime(null)).toBe("计算中");
    expect(formatRemainingTime(Number.NaN)).toBe("计算中");
    expect(formatRemainingTime(Number.POSITIVE_INFINITY)).toBe("计算中");
  });

  it("rounds remaining seconds up and clamps negative durations", () => {
    expect(formatRemainingTime(-1)).toBe("0 秒");
    expect(formatRemainingTime(0)).toBe("0 秒");
    expect(formatRemainingTime(1)).toBe("1 秒");
    expect(formatRemainingTime(59_000)).toBe("59 秒");
    expect(formatRemainingTime(59_001)).toBe("1 分钟");
  });

  it("formats minute and hour boundaries using the existing ceiling rules", () => {
    expect(formatRemainingTime(60_000)).toBe("1 分钟");
    expect(formatRemainingTime(3_600_000)).toBe("1 小时 0 分钟");
    expect(formatRemainingTime(3_660_000)).toBe("1 小时 1 分钟");
    expect(formatRemainingTime(7_200_000)).toBe("2 小时 0 分钟");
  });

  it("maps duplicate preview/resolve errors to refresh guidance", () => {
    expect(toDuplicateActionMessage(new Error("duplicate:preview-resolve failed"))).toBe("候选项检查失败，请刷新候选项后重试。");
    expect(toDuplicateActionMessage(new Error("duplicate:resolve failed"))).toBe("候选项检查失败，请刷新候选项后重试。");
  });

  it("normalizes Electron-wrapped errors but preserves ordinary backend messages", () => {
    expect(operationErrorMessage(new Error("Error invoking remote method 'duplicate:delete': Error: 权限拒绝"))).toBe("权限拒绝");
    expect(toDuplicateActionMessage(new Error("Error invoking remote method 'duplicate:delete': Error: 权限拒绝"))).toBe("权限拒绝");
  });

  it("maps each stale-item change type to its existing Chinese label", () => {
    const cases: Array<[DuplicateResolveChangedItem["changeType"], string]> = [
      ["missing", "文件不存在"],
      ["size-changed", "文件大小变化"],
      ["mtime-changed", "修改时间变化"],
      ["size-and-mtime-changed", "大小和修改时间变化"],
      ["unreadable", "文件无法访问"]
    ];
    for (const [type, label] of cases) expect(changeTypeLabel(type)).toBe(label);
  });
});

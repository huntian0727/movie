import type { DuplicateCleanupJob, DuplicateGroup, DuplicateResolveChangedItem } from "../../shared/videoTypes";
import { operationErrorMessage } from "./operationErrorMessage";

/** Return video IDs in the exact planned order: selected/recommended keeper first, then other group members. */
export function planVideoIds(groups: DuplicateGroup[], selectedKeepByGroup: Record<string, string>): string[] {
  return groups.flatMap((group) => {
    const keepVideoId = selectedKeepByGroup[group.groupKey] ?? group.recommendedKeepVideoId;
    return [keepVideoId, ...group.items.map((item) => item.video.id).filter((videoId) => videoId !== keepVideoId)];
  });
}

export function isCleanupJobFinished(job: Pick<DuplicateCleanupJob, "status">): boolean {
  return ["cancelled", "completed", "completed_with_errors"].includes(job.status);
}

export function normalizeDirectoryForComparison(directoryPath: string): string {
  return directoryPath.replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

export function changeTypeLabel(changeType: DuplicateResolveChangedItem["changeType"]): string {
  if (changeType === "missing") return "文件不存在";
  if (changeType === "size-changed") return "文件大小变化";
  if (changeType === "mtime-changed") return "修改时间变化";
  if (changeType === "size-and-mtime-changed") return "大小和修改时间变化";
  return "文件无法访问";
}

export function formatRemainingTime(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return "计算中";
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分钟`;
}

export function toDuplicateActionMessage(cause: unknown): string {
  const message = operationErrorMessage(cause);
  if (/duplicate:preview-resolve|duplicate:resolve/i.test(message)) {
    return "候选项检查失败，请刷新候选项后重试。";
  }
  return message;
}

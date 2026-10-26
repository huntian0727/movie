import type { DuplicateDirectoryOption } from "../../shared/videoTypes";

export type DuplicateDirectorySortMode = "space" | "files" | "groups" | "path";
export type DuplicateDirectoryFilterPreset = "all" | "files-10" | "files-100" | "space-10gb" | "space-100gb" | "space-1tb";

const GIBIBYTE = 1024 ** 3;

/** Apply the existing directory-size preset and ranking rules without mutating the caller's options. */
export function filterAndSortDirectoryOptions(
  options: DuplicateDirectoryOption[],
  preset: DuplicateDirectoryFilterPreset,
  mode: DuplicateDirectorySortMode
): DuplicateDirectoryOption[] {
  return options
    .filter((option) => matchesDirectoryFilter(option, preset))
    .sort((left, right) => compareDirectoryOptions(left, right, mode));
}

function compareDirectoryOptions(left: DuplicateDirectoryOption, right: DuplicateDirectoryOption, mode: DuplicateDirectorySortMode): number {
  if (mode === "files") {
    return right.estimatedCleanupFileCount - left.estimatedCleanupFileCount ||
      right.estimatedReclaimableBytes - left.estimatedReclaimableBytes ||
      right.groupCount - left.groupCount ||
      left.path.localeCompare(right.path, "zh-CN", { numeric: true });
  }
  if (mode === "groups") {
    return right.groupCount - left.groupCount ||
      right.estimatedReclaimableBytes - left.estimatedReclaimableBytes ||
      right.estimatedCleanupFileCount - left.estimatedCleanupFileCount ||
      left.path.localeCompare(right.path, "zh-CN", { numeric: true });
  }
  if (mode === "path") return left.path.localeCompare(right.path, "zh-CN", { numeric: true });
  return right.estimatedReclaimableBytes - left.estimatedReclaimableBytes ||
    right.estimatedCleanupFileCount - left.estimatedCleanupFileCount ||
    right.groupCount - left.groupCount ||
    left.path.localeCompare(right.path, "zh-CN", { numeric: true });
}

function matchesDirectoryFilter(option: DuplicateDirectoryOption, preset: DuplicateDirectoryFilterPreset): boolean {
  if (preset === "files-10") return option.estimatedCleanupFileCount >= 10;
  if (preset === "files-100") return option.estimatedCleanupFileCount >= 100;
  if (preset === "space-10gb") return option.estimatedReclaimableBytes >= 10 * GIBIBYTE;
  if (preset === "space-100gb") return option.estimatedReclaimableBytes >= 100 * GIBIBYTE;
  if (preset === "space-1tb") return option.estimatedReclaimableBytes >= 1024 * GIBIBYTE;
  return true;
}

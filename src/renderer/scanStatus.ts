import type { FolderScanStatus } from "../shared/videoTypes";

/**
 * `updatedAt` is deliberately ignored: the renderer does not display it, and
 * timestamp-only polling changes should not redraw the full library.
 */
export function areVisibleScanStatusesEqual(current: FolderScanStatus[], next: FolderScanStatus[]): boolean {
  if (current.length !== next.length) return false;
  const currentByFolderId = new Map(current.map((status) => [status.folderId, status]));

  return next.every((status) => {
    const previous = currentByFolderId.get(status.folderId);
    return previous?.mode === status.mode
      && previous.state === status.state
      && previous.phase === status.phase
      && previous.totalFiles === status.totalFiles
      && previous.processedFiles === status.processedFiles
      && previous.currentPath === status.currentPath
      && previous.message === status.message
      && JSON.stringify(previous.counters) === JSON.stringify(status.counters);
  });
}

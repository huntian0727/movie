import type { DuplicateGroup, ReviewedDeleteBackgroundJob } from "../../shared/videoTypes";

/**
 * Hide acknowledged, queued targets ONLY for the duration of a running job.
 * Database/source files remain intact until the deletion API confirms success.
 * After the job ends, the real database query determines which files remain.
 */
export function hideQueuedDuplicateVideos(
  groups: readonly DuplicateGroup[],
  job: ReviewedDeleteBackgroundJob | null | undefined
): { groups: DuplicateGroup[]; hiddenVideos: number; hiddenGroups: number } {
  if ((job?.status !== "running" && job?.status !== "queued") || !job.queuedVideoIds?.length) {
    return { groups: groups as DuplicateGroup[], hiddenVideos: 0, hiddenGroups: 0 };
  }
  const queued = new Set(job.queuedVideoIds);
  let hiddenVideos = 0;
  let hiddenGroups = 0;
  const next: DuplicateGroup[] = [];
  for (const group of groups) {
    if (!group.items.some(({ video }) => queued.has(video.id))) {
      next.push(group);
      continue;
    }
    const items = group.items.filter(({ video }) => !queued.has(video.id));
    hiddenVideos += group.items.length - items.length;
    if (items.length < 2) {
      hiddenGroups++;
      continue;
    }
    const keepVideoId = items.some(({ video }) => video.id === group.recommendedKeepVideoId)
      ? group.recommendedKeepVideoId : items[0]!.video.id;
    next.push({
      ...group,
      items,
      recommendedKeepVideoId: keepVideoId,
      reclaimableBytes: items.reduce((sum, { video }) =>
        sum + (video.id === keepVideoId ? 0 : video.sizeBytes), 0)
    });
  }
  return { groups: next, hiddenVideos, hiddenGroups };
}

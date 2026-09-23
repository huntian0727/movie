import { useEffect, useState } from "react";

/**
 * Splits large pages over animation frames so a single React commit does not
 * occupy the renderer for hundreds of milliseconds.
 */
export function useProgressiveRenderCount(itemKey: string, total: number, firstBatch: number, batchSize: number): number {
  const [progress, setProgress] = useState(() => ({ itemKey, count: Math.min(total, firstBatch) }));
  const visibleCount = progress.itemKey === itemKey ? Math.min(total, progress.count) : Math.min(total, firstBatch);

  useEffect(() => {
    if (total <= firstBatch) return;
    if (progress.itemKey !== itemKey) {
      setProgress({ itemKey, count: firstBatch });
      return;
    }
    if (progress.count >= total) return;
    const timer = window.setTimeout(() => {
      setProgress((current) => current.itemKey === itemKey
        ? { itemKey, count: Math.min(total, current.count + batchSize) }
        : current);
    }, 16);
    return () => window.clearTimeout(timer);
  }, [itemKey, total, firstBatch, batchSize, progress]);

  return visibleCount;
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DuplicateGroup } from "../../shared/videoTypes";

interface Props {
  groups: DuplicateGroup[];
  renderGroup(group: DuplicateGroup, index: number): ReactNode;
}

const ALWAYS_MOUNTED = 4;
const ESTIMATED_ROW_HEIGHT = 132;
const ESTIMATED_HEADER_HEIGHT = 75;

// Keep the complete page in the layout, but mount expensive cards only near the viewport.
// Selection and cleanup planning remain in the parent and still use every page item.
export function WindowedDuplicateGroups({ groups, renderGroup }: Props) {
  const canVirtualize = groups.length > 20 && typeof IntersectionObserver !== "undefined";
  const containerRef = useRef<HTMLDivElement>(null);
  const observedRef = useRef(new Map<string, HTMLDivElement>());
  const measuredHeightsRef = useRef(new Map<string, number>());
  const [nearbyKeys, setNearbyKeys] = useState<Set<string>>(() => new Set());
  const [heightRevision, setHeightRevision] = useState(0);

  useEffect(() => {
    if (!canVirtualize || !containerRef.current) return;
    const root = containerRef.current.closest(".content");
    const observer = new IntersectionObserver((entries) => {
      setNearbyKeys((current) => {
        const next = new Set(current);
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.groupKey;
          if (!key) continue;
          if (entry.isIntersecting) next.add(key);
          else next.delete(key);
        }
        if (next.size === current.size && [...next].every((key) => current.has(key))) return current;
        return next;
      });
    }, { root, rootMargin: "800px 0px" });
    for (const element of observedRef.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [canVirtualize, groups]);

  useEffect(() => {
    if (!canVirtualize || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const key = element.dataset.groupKey;
        const height = Math.ceil(entry.contentRect.height);
        if (key && height > 0 && measuredHeightsRef.current.get(key) !== height) {
          measuredHeightsRef.current.set(key, height);
          changed = true;
        }
      }
      if (changed) setHeightRevision((value) => value + 1);
    });
    for (const element of observedRef.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [canVirtualize, groups]);

  void heightRevision;
  return (
    <div className="duplicate-groups" ref={containerRef}>
      {groups.map((group, index) => {
        const mounted = !canVirtualize || index < ALWAYS_MOUNTED || nearbyKeys.has(group.groupKey);
        const estimatedHeight = ESTIMATED_HEADER_HEIGHT + group.items.length * ESTIMATED_ROW_HEIGHT;
        return (
          <div
            className="duplicate-group-slot"
            data-group-key={group.groupKey}
            key={group.groupKey}
            ref={(element) => {
              if (element) observedRef.current.set(group.groupKey, element);
              else observedRef.current.delete(group.groupKey);
            }}
            style={mounted ? undefined : { height: measuredHeightsRef.current.get(group.groupKey) ?? estimatedHeight }}
          >
            {mounted ? renderGroup(group, index) : null}
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  initiallyVisible: boolean;
  estimatedHeight: number;
}

/**
 * Keeps masonry slot geometry stable while mounting expensive video-card content
 * only near the viewport. The wrapper stays in the multicolumn flow; card content
 * and its controls are released once it is safely offscreen.
 */
export function WindowedVideoGridCard({ children, initiallyVisible, estimatedHeight }: Props) {
  const shouldWindow = typeof IntersectionObserver !== "undefined";
  const slotRef = useRef<HTMLDivElement>(null);
  const measuredHeight = useRef(estimatedHeight);
  const [nearby, setNearby] = useState(() => !shouldWindow || initiallyVisible);
  const [focused, setFocused] = useState(false);
  const mounted = !shouldWindow || nearby || focused;

  useEffect(() => {
    if (!shouldWindow || !slotRef.current) return;
    const element = slotRef.current;
    const root = element.closest(".content");
    const observer = new IntersectionObserver(([entry]) => {
      const isNearby = entry?.isIntersecting ?? false;
      if (!isNearby && element.dataset.windowedMounted === "true") {
        const height = Math.ceil(element.getBoundingClientRect().height);
        if (height > 0) measuredHeight.current = height;
        if (element.contains(document.activeElement)) setFocused(true);
      }
      setNearby(isNearby);
    }, { root, rootMargin: "800px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldWindow]);

  useEffect(() => {
    if (!mounted || !shouldWindow || typeof ResizeObserver === "undefined" || !slotRef.current) return;
    const element = slotRef.current;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (element.dataset.windowedMounted !== "true") continue;
        const height = Math.ceil(entry.contentRect.height);
        if (height > 0) measuredHeight.current = height;
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted, shouldWindow]);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    const element = slotRef.current;
    if (element && nextTarget && element.contains(nextTarget)) return;
    setFocused(false);
  };

  return <div className="video-grid-slot"
    data-windowed-mounted={mounted ? "true" : "false"}
    ref={slotRef}
    aria-hidden={mounted ? undefined : true}
    style={mounted ? undefined : { height: measuredHeight.current }}
    onFocusCapture={shouldWindow ? () => setFocused(true) : undefined}
    onBlurCapture={shouldWindow ? handleBlur : undefined}
  >
    {mounted ? children : null}
  </div>;
}
import { memo, useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";

interface Props<T> {
  items: T[];
  getKey(item: T): string;
  renderItem(item: T, index: number): ReactNode;
  threshold?: number;
  estimatedHeight?: number;
}

interface DuplicateItemSlotProps {
  itemKey: string;
  mounted: boolean;
  height: number | undefined;
  refCallback(element: HTMLDivElement | null): void;
  onFocusCapture?: () => void;
  onBlurCapture?: (event: FocusEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

const DuplicateItemSlot = memo(function DuplicateItemSlot({
  itemKey,
  mounted,
  height,
  refCallback,
  onFocusCapture,
  onBlurCapture,
  children
}: DuplicateItemSlotProps) {
  return (
    <div
      className="duplicate-item-slot"
      data-item-key={itemKey}
      data-windowed-mounted={mounted ? "true" : "false"}
      ref={refCallback}
      aria-hidden={mounted ? undefined : true}
      style={mounted ? undefined : { height }}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      {mounted ? children : null}
    </div>
  );
});

const ALWAYS_MOUNTED = 8;
const DEFAULT_THRESHOLD = 40;
const DEFAULT_ESTIMATED_HEIGHT = 124;

/**
 * Keep the complete item order and scroll space, but mount expensive row content
 * only near the content viewport. Business operations still use the full input array.
 * Memoized slots keep an observer update from re-rendering every unchanged row.
 */
export function WindowedDuplicateItems<T>({
  items,
  getKey,
  renderItem,
  threshold = DEFAULT_THRESHOLD,
  estimatedHeight = DEFAULT_ESTIMATED_HEIGHT,
}: Props<T>) {
  const shouldWindow = items.length > threshold && typeof IntersectionObserver !== "undefined";
  const containerRef = useRef<HTMLDivElement>(null);
  const observedRef = useRef(new Map<string, HTMLDivElement>());
  const refCallbacksRef = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
  const focusHandlersRef = useRef(new Map<string, () => void>());
  const blurHandlersRef = useRef(new Map<string, (event: FocusEvent<HTMLDivElement>) => void>());
  const measuredHeightsRef = useRef(new Map<string, number>());
  const handleFocusRef = useRef<(key: string) => void>(() => undefined);
  const handleBlurRef = useRef<(key: string, event: FocusEvent<HTMLDivElement>) => void>(() => undefined);
  const [nearbyKeys, setNearbyKeys] = useState<Set<string>>(() => new Set());
  const [focusedKeys, setFocusedKeys] = useState<Set<string>>(() => new Set());
  const [heightRevision, setHeightRevision] = useState(0);
  const keyedItems = useMemo(
    () => items.map((item, index) => ({ item, index, key: getKey(item) })),
    [items, getKey]
  );

  useEffect(() => {
    if (!shouldWindow || !containerRef.current) return;
    const root = containerRef.current.closest(".content");
    const observer = new IntersectionObserver((entries) => {
      const changedKeys: string[] = [];
      const focusedOffscreen: string[] = [];
      let changedHeight = false;
      for (const entry of entries) {
        const element = entry.target as HTMLDivElement;
        const key = element.dataset.itemKey;
        if (!key) continue;
        changedKeys.push(key);
        if (!entry.isIntersecting && element.dataset.windowedMounted === "true") {
          const height = Math.ceil(element.getBoundingClientRect().height);
          if (height > 0 && measuredHeightsRef.current.get(key) !== height) {
            measuredHeightsRef.current.set(key, height);
            changedHeight = true;
          }
          if (element.contains(document.activeElement)) focusedOffscreen.push(key);
        }
      }
      if (changedKeys.length) {
        setNearbyKeys((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset.itemKey;
            if (!key) continue;
            if (entry.isIntersecting) next.add(key);
            else next.delete(key);
          }
          if (next.size === current.size && [...next].every((key) => current.has(key))) return current;
          return next;
        });
      }
      if (focusedOffscreen.length) {
        setFocusedKeys((current) => {
          const next = new Set(current);
          for (const key of focusedOffscreen) next.add(key);
          return next;
        });
      }
      if (changedHeight) setHeightRevision((value) => value + 1);
    }, { root, rootMargin: "800px 0px" });

    for (const element of observedRef.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [shouldWindow, items]);

  useEffect(() => {
    if (!shouldWindow || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const element = entry.target as HTMLDivElement;
        if (element.dataset.windowedMounted !== "true") continue;
        const key = element.dataset.itemKey;
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
  }, [shouldWindow, items]);

  const handleFocus = (key: string) => {
    if (!shouldWindow) return;
    setFocusedKeys((current) => current.has(key) ? current : new Set(current).add(key));
  };
  const handleBlur = (key: string, event: FocusEvent<HTMLDivElement>) => {
    if (!shouldWindow) return;
    const nextTarget = event.relatedTarget as Node | null;
    const element = observedRef.current.get(key);
    if (element && nextTarget && element.contains(nextTarget)) return;
    setFocusedKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };
  handleFocusRef.current = handleFocus;
  handleBlurRef.current = handleBlur;

  const getRefCallback = (key: string) => {
    const existing = refCallbacksRef.current.get(key);
    if (existing) return existing;
    const callback = (element: HTMLDivElement | null) => {
      if (element) {
        observedRef.current.set(key, element);
      } else {
        observedRef.current.delete(key);
        refCallbacksRef.current.delete(key);
        focusHandlersRef.current.delete(key);
        blurHandlersRef.current.delete(key);
      }
    };
    refCallbacksRef.current.set(key, callback);
    return callback;
  };
  const getFocusHandler = (key: string) => {
    const existing = focusHandlersRef.current.get(key);
    if (existing) return existing;
    const callback = () => handleFocusRef.current(key);
    focusHandlersRef.current.set(key, callback);
    return callback;
  };
  const getBlurHandler = (key: string) => {
    const existing = blurHandlersRef.current.get(key);
    if (existing) return existing;
    const callback = (event: FocusEvent<HTMLDivElement>) => handleBlurRef.current(key, event);
    blurHandlersRef.current.set(key, callback);
    return callback;
  };

  void heightRevision;
  return <div className="duplicate-group-items" ref={containerRef}>
    {keyedItems.map(({ item, index, key }) => {
      const mounted = !shouldWindow || index < ALWAYS_MOUNTED || nearbyKeys.has(key) || focusedKeys.has(key);
      if (!shouldWindow || !mounted) {
        focusHandlersRef.current.delete(key);
        blurHandlersRef.current.delete(key);
      }
      const height = mounted ? undefined : measuredHeightsRef.current.get(key) ?? estimatedHeight;
      return (
        <DuplicateItemSlot
          key={key}
          itemKey={key}
          mounted={mounted}
          height={height}
          refCallback={getRefCallback(key)}
          onFocusCapture={shouldWindow && mounted ? getFocusHandler(key) : undefined}
          onBlurCapture={shouldWindow && mounted ? getBlurHandler(key) : undefined}
        >
          {mounted ? renderItem(item, index) : null}
        </DuplicateItemSlot>
      );
    })}
  </div>;
}
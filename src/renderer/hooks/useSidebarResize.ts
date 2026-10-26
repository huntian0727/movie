import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

export const DEFAULT_SIDEBAR_WIDTH = 300;
export const MIN_SIDEBAR_WIDTH = 250;
export const MAX_SIDEBAR_WIDTH = 460;

const SIDEBAR_WIDTH_STORAGE_KEY = "video-manager:sidebar-width";

interface SidebarResizeStart {
  pointerX: number;
  width: number;
}

export function useSidebarResize() {
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarResizeStartRef = useRef<SidebarResizeStart | null>(null);

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    sidebarResizeStartRef.current = { pointerX: event.clientX, width: sidebarWidth };
    setIsResizingSidebar(true);
    event.preventDefault();
  }, [sidebarWidth]);

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }, []);

  const handleSidebarResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    setSidebarWidth((current) => clampSidebarWidth(current + (event.key === "ArrowRight" ? 10 : -10)));
    event.preventDefault();
  }, []);

  useEffect(() => {
    if (isResizingSidebar) return;
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Renderer storage can be unavailable in hardened or test environments.
    }
  }, [sidebarWidth, isResizingSidebar]);

  useEffect(() => {
    if (!isResizingSidebar) return;
    let frame: number | undefined;
    let pendingWidth: number | undefined;
    const onPointerMove = (event: PointerEvent) => {
      const start = sidebarResizeStartRef.current;
      if (!start) return;
      pendingWidth = clampSidebarWidth(start.width + event.clientX - start.pointerX);
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        if (pendingWidth !== undefined) setSidebarWidth(pendingWidth);
      });
    };
    const stopResizing = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      if (pendingWidth !== undefined) setSidebarWidth(pendingWidth);
      sidebarResizeStartRef.current = null;
      setIsResizingSidebar(false);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizingSidebar]);

  return { sidebarWidth, isResizingSidebar, startSidebarResize, resetSidebarWidth, handleSidebarResizeKeyDown };
}

function readStoredSidebarWidth(): number {
  try {
    const storedValue = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (storedValue === null) return DEFAULT_SIDEBAR_WIDTH;
    const value = Number(storedValue);
    if (Number.isFinite(value)) return clampSidebarWidth(value);
  } catch {
    // Fall through to the default when storage is unavailable.
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

function clampSidebarWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)));
}

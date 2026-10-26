import { Profiler, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { VideoRecord } from "../../src/shared/videoTypes";
import { VideoGrid } from "../../src/renderer/components/VideoGrid";
import { WindowedDuplicateItems } from "../../src/renderer/components/WindowedDuplicateItems";
import "../../src/renderer/styles.css";

const search = new URLSearchParams(window.location.search);
const surface = search.get("surface") === "duplicate-items" ? "duplicate-items" : "video-grid";
const requestedItemCount = Number(search.get("count") ?? (surface === "duplicate-items" ? 10000 : 300));
const maximumItemCount = surface === "duplicate-items" ? 10000 : 1000;
const ITEM_COUNT = Number.isInteger(requestedItemCount) && requestedItemCount >= 1 && requestedItemCount <= maximumItemCount
  ? requestedItemCount
  : (surface === "duplicate-items" ? 10000 : 300);
const windowingMode = search.get("windowing") === "off" ? "off" : "on";
const resizeObserverMode = search.get("resizeObserver") === "off" ? "off" : "on";
const profileObservers = search.get("profileObservers") === "on";
if (resizeObserverMode === "off") Object.defineProperty(window, "ResizeObserver", { configurable: true, value: undefined });

type BenchmarkSurface = "video-grid" | "duplicate-items";
type ScrollBenchmarkState = {
  ready: boolean;
  itemCount: number;
  totalVideos: number;
  slotCount: number;
  mountedSlots: number;
  peakMountedSlots: number;
  surface: BenchmarkSurface;
  windowingMode: "on" | "off";
  observerStats: {
    observeCalls: number;
    callbackCount: number;
    entryCount: number;
    callbackTotalMs: number;
    callbackMaxMs: number;
    reactCommitCount: number;
    reactActualDurationMs: number;
    reactActualMaxDurationMs: number;
    reactBaseDurationMs: number;
    renderItemCalls: number;
  };
};

if (windowingMode === "off") Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: undefined });

const benchmarkState: ScrollBenchmarkState = {
  ready: false,
  itemCount: ITEM_COUNT,
  totalVideos: surface === "video-grid" ? ITEM_COUNT : 0,
  slotCount: 0,
  mountedSlots: 0,
  peakMountedSlots: 0,
  surface,
  windowingMode,
  observerStats: {
    observeCalls: 0,
    callbackCount: 0,
    entryCount: 0,
    callbackTotalMs: 0,
    callbackMaxMs: 0,
    reactCommitCount: 0,
    reactActualDurationMs: 0,
    reactActualMaxDurationMs: 0,
    reactBaseDurationMs: 0,
    renderItemCalls: 0
  }
};
(window as Window & { __movieScrollBenchmark?: ScrollBenchmarkState }).__movieScrollBenchmark = benchmarkState;

if (profileObservers && surface === "duplicate-items" && windowingMode === "on" && typeof window.IntersectionObserver !== "undefined") {
  const NativeIntersectionObserver = window.IntersectionObserver;
  class ProfiledIntersectionObserver extends NativeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      super((entries, observer) => {
        const startedAt = performance.now();
        benchmarkState.observerStats.callbackCount += 1;
        benchmarkState.observerStats.entryCount += entries.length;
        try {
          callback(entries, observer);
        } finally {
          const elapsed = performance.now() - startedAt;
          benchmarkState.observerStats.callbackTotalMs += elapsed;
          benchmarkState.observerStats.callbackMaxMs = Math.max(benchmarkState.observerStats.callbackMaxMs, elapsed);
        }
      }, options);
    }

    override observe(target: Element) {
      benchmarkState.observerStats.observeCalls += 1;
      super.observe(target);
    }
  }
  Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: ProfiledIntersectionObserver });
}

const videos: VideoRecord[] = surface === "video-grid" ? Array.from({ length: ITEM_COUNT }, (_, index) => {
  const filename = "synthetic-video-" + String(index + 1).padStart(3, "0") + ".mp4";
  return {
    id: "electron-scroll-bench-" + (index + 1),
    sourceFolderId: "synthetic-source",
    path: "D:\\synthetic-library\\" + filename,
    directory: "D:\\synthetic-library",
    filename,
    basename: filename.slice(0, -4),
    extension: ".mp4",
    sizeBytes: 8_000_000 + index * 1024,
    durationMs: 60_000 + index * 997,
    width: 1920,
    height: 1080,
    format: "mp4",
    videoCodec: null,
    videoProfile: null,
    pixelFormat: null,
    audioCodec: null,
    codecProbeStatus: "ready",
    modifiedAt: "2026-10-25T00:00:00.000Z",
    importedAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    isFavorite: false,
    isPendingDelete: false,
    isMissing: false,
    metadataStatus: "ready",
    thumbnailStatus: "pending",
    timelinePreviewStatus: "pending",
    coverCachePath: null,
    contentFingerprint: null,
    fingerprintStatus: "pending",
    fingerprintUpdatedAt: null,
    fingerprintError: null
  };
}) : [];

const duplicateItems = surface === "duplicate-items" ? Array.from({ length: ITEM_COUNT }, (_, index) => ({
  id: "electron-duplicate-bench-" + (index + 1),
  label: "合成重复候选 " + String(index + 1).padStart(5, "0")
})) : [];

const renderDuplicateItem = (item: { id: string; label: string }) => {
  if (profileObservers) benchmarkState.observerStats.renderItemCalls += 1;
  return <article className="duplicate-benchmark-row" data-duplicate-benchmark-row style={{
    boxSizing: "border-box",
    width: "100%",
    height: "124px",
    minHeight: "124px",
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "16px 20px",
    borderBottom: "1px solid #d1d5db"
  }}>
    <div aria-hidden="true" style={{ width: "56px", height: "80px", flexShrink: 0, borderRadius: "6px", background: "#e5e7eb" }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
      <div style={{ marginTop: "8px", fontSize: "12px" }}>合成重复候选 · 文件大小 128 MB · 时长 01:23:45</div>
    </div>
    <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
      <button type="button" tabIndex={-1}>打开</button>
      <button type="button" tabIndex={-1}>详情</button>
    </div>
  </article>;
};

const noop = (_video: VideoRecord) => undefined;

function ScrollBenchmarkPage() {
  useEffect(() => {
    const scrollRoot = document.getElementById("scroll-root");
    if (!scrollRoot) return;

    if (surface === "duplicate-items") {
      const slots = Array.from(scrollRoot.querySelectorAll<HTMLElement>(".duplicate-item-slot"));
      const mountedBySlot = new Map<HTMLElement, boolean>();
      let mounted = 0;
      for (const slot of slots) {
        const isMounted = slot.dataset.windowedMounted === "true";
        mountedBySlot.set(slot, isMounted);
        if (isMounted) mounted += 1;
      }
      benchmarkState.slotCount = slots.length;
      benchmarkState.mountedSlots = mounted;
      benchmarkState.peakMountedSlots = mounted;
      benchmarkState.ready = slots.length === ITEM_COUNT;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== "attributes" || mutation.attributeName !== "data-windowed-mounted") continue;
          const slot = mutation.target as HTMLElement;
          const previous = mountedBySlot.get(slot);
          const next = slot.dataset.windowedMounted === "true";
          if (previous === undefined) {
            mountedBySlot.set(slot, next);
            if (next) mounted += 1;
          } else if (previous !== next) {
            mounted += next ? 1 : -1;
            mountedBySlot.set(slot, next);
          }
        }
        benchmarkState.mountedSlots = mounted;
        benchmarkState.peakMountedSlots = Math.max(benchmarkState.peakMountedSlots, mounted);
      });
      observer.observe(scrollRoot, { subtree: true, attributes: true, attributeFilter: ["data-windowed-mounted"] });
      return () => observer.disconnect();
    }

    const publish = () => {
      const slots = scrollRoot.querySelectorAll<HTMLElement>(".video-grid-slot");
      const mountedSlots = scrollRoot.querySelectorAll('.video-grid-slot[data-windowed-mounted="true"]').length;
      benchmarkState.slotCount = slots.length;
      benchmarkState.mountedSlots = mountedSlots;
      benchmarkState.peakMountedSlots = Math.max(benchmarkState.peakMountedSlots, mountedSlots);
      benchmarkState.ready = slots.length === ITEM_COUNT;
    };
    const observer = new MutationObserver(publish);
    observer.observe(scrollRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-windowed-mounted"] });
    publish();
    return () => observer.disconnect();
  }, []);

  const duplicateList = <WindowedDuplicateItems
    items={duplicateItems}
    getKey={(item) => item.id}
    threshold={40}
    estimatedHeight={124}
    renderItem={renderDuplicateItem}
  />;
  const onDuplicateListRender = (_id: string, _phase: "mount" | "update" | "nested-update", actualDuration: number, baseDuration: number) => {
    if (!profileObservers) return;
    benchmarkState.observerStats.reactCommitCount += 1;
    benchmarkState.observerStats.reactActualDurationMs += actualDuration;
    benchmarkState.observerStats.reactActualMaxDurationMs = Math.max(benchmarkState.observerStats.reactActualMaxDurationMs, actualDuration);
    benchmarkState.observerStats.reactBaseDurationMs = baseDuration;
  };

  return <main id="scroll-root" className="content" style={{ height: "100vh", width: "100vw", display: "block", overflowY: "auto", overflowX: "hidden" }}>
    {surface === "duplicate-items" ? (
      profileObservers ? (
        <Profiler id="duplicate-items" onRender={onDuplicateListRender}>
          {duplicateList}
        </Profiler>
      ) : duplicateList
    ) : (
      <VideoGrid
        videos={videos}
        onOpen={noop}
        onViewDetails={noop}
        onToggleFavorite={noop}
        onRename={noop}
        onDelete={noop}
        cardWidth={260}
      />
    )}
  </main>;
}

document.documentElement.style.height = "100%";
document.body.style.height = "100%";
document.body.style.margin = "0";
document.body.style.overflow = "hidden";
const root = document.getElementById("root");
if (!root) throw new Error("Benchmark root element is missing");
root.style.height = "100%";
createRoot(root).render(<ScrollBenchmarkPage />);
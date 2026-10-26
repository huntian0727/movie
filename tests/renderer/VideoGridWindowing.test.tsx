import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import type { VideoRecord } from "../../src/shared/videoTypes";
import { VideoGrid } from "../../src/renderer/components/VideoGrid";

vi.mock("../../src/renderer/components/VideoItemActions", () => ({ VideoItemActions: () => <div data-testid="video-actions" /> }));
afterEach(() => vi.unstubAllGlobals());

function videos(count: number): VideoRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: "video-" + index,
    filename: "video-" + index + ".mp4",
    path: "C:/Videos/video-" + index + ".mp4",
    directory: "C:/Videos",
    extension: ".mp4",
    coverCachePath: null,
    width: 1920,
    height: 1080,
    sizeBytes: 1000000,
    durationMs: 60000,
    metadataStatus: "ready",
    thumbnailStatus: "ready",
    isFavorite: false,
  } as unknown as VideoRecord));
}
function renderGrid(count: number) {
  return render(
    <VideoGrid
      videos={videos(count)}
      getCoverUrl={() => null}
      onOpen={vi.fn()}
      onViewDetails={vi.fn()}
      onToggleFavorite={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}
function stubIntersectionObserver() {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("ResizeObserver", undefined);
}

class ControlledIntersectionObserver {
  static instances: ControlledIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(private readonly callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
    ControlledIntersectionObserver.instances.push(this);
  }
  observe(target: Element) { this.targets.add(target); }
  disconnect() { this.targets.clear(); }
  static trigger(target: Element, isIntersecting: boolean) {
    const observer = ControlledIntersectionObserver.instances.find((item) => item.targets.has(target));
    if (!observer) throw new Error("No IntersectionObserver is watching the requested slot");
    observer.callback([{ target, isIntersecting }]);
  }
  static reset() { ControlledIntersectionObserver.instances = []; }
}

describe("VideoGrid large-page windowing", () => {
  it("keeps the existing progressive slots but mounts only eight heavy cards for large pages", () => {
    stubIntersectionObserver();
    const { container } = renderGrid(100);
    expect(container.querySelector(".video-grid--masonry.is-windowed")).not.toBeNull();
    expect(container.querySelectorAll(".video-grid-slot")).toHaveLength(48);
    expect(container.querySelectorAll(".video-card")).toHaveLength(8);
    expect(container.querySelectorAll("[data-testid=\"video-actions\"]")).toHaveLength(8);
  });

  it("keeps normal small pages on the original direct-card layout", () => {
    stubIntersectionObserver();
    const { container } = renderGrid(20);
    expect(container.querySelector(".video-grid--masonry.is-windowed")).toBeNull();
    expect(container.querySelectorAll(".video-grid-slot")).toHaveLength(0);
    expect(container.querySelectorAll(".video-card")).toHaveLength(20);
  });

  it("keeps a focused card mounted after it leaves the viewport, then releases it on blur", () => {
    ControlledIntersectionObserver.reset();
    vi.stubGlobal("IntersectionObserver", ControlledIntersectionObserver);
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = renderGrid(100);
    const slot = container.querySelector(".video-grid-slot") as HTMLDivElement;
    const cover = slot.querySelector(".video-cover") as HTMLDivElement;
    expect(slot.dataset.windowedMounted).toBe("true");
    act(() => cover.focus());
    expect(document.activeElement).toBe(cover);

    act(() => ControlledIntersectionObserver.trigger(slot, false));
    expect(slot.dataset.windowedMounted).toBe("true");
    expect(slot.querySelector(".video-card")).not.toBeNull();

    fireEvent.blur(cover, { relatedTarget: document.body });
    expect(slot.dataset.windowedMounted).toBe("false");
    expect(slot.querySelector(".video-card")).toBeNull();
  });
  it("mounts cards near the viewport and preserves measured slot height when they leave", () => {
    ControlledIntersectionObserver.reset();
    vi.stubGlobal("IntersectionObserver", ControlledIntersectionObserver);
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = renderGrid(100);
    const slot = container.querySelectorAll(".video-grid-slot")[8] as HTMLDivElement;
    expect(slot.dataset.windowedMounted).toBe("false");
    expect(slot.getAttribute("aria-hidden")).toBe("true");

    act(() => ControlledIntersectionObserver.trigger(slot, true));
    expect(slot.dataset.windowedMounted).toBe("true");
    expect(slot.querySelector(".video-card")).not.toBeNull();
    expect(slot.getAttribute("aria-hidden")).toBeNull();

    vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({ height: 420 } as DOMRect);
    act(() => ControlledIntersectionObserver.trigger(slot, false));
    expect(slot.dataset.windowedMounted).toBe("false");
    expect(slot.style.height).toBe("420px");
    expect(slot.querySelector(".video-card")).toBeNull();

    act(() => ControlledIntersectionObserver.trigger(slot, true));
    expect(slot.dataset.windowedMounted).toBe("true");
    expect(slot.style.height).toBe("");
    expect(slot.querySelector(".video-card")).not.toBeNull();
  });
});
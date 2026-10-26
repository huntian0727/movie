import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowedVideoGridCard } from "../../src/renderer/components/WindowedVideoGridCard";

afterEach(() => vi.unstubAllGlobals());

type MockObserver = { callback: IntersectionObserverCallback; elements: Element[]; };
let observers: MockObserver[] = [];
function installIntersectionObserver() {
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    private record: MockObserver;
    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, elements: [] };
      observers.push(this.record);
    }
    observe(element: Element) { this.record.elements.push(element); }
    disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", undefined);
}
function notify(element: Element, isIntersecting: boolean) {
  const observer = observers.find((candidate) => candidate.elements.includes(element));
  if (!observer) throw new Error("No IntersectionObserver is observing this slot");
  act(() => observer.callback([{ target: element, isIntersecting } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
}

describe("windowed video grid cards", () => {
  it("mounts only nearby card contents and preserves measured masonry height offscreen", () => {
    installIntersectionObserver();
    const { container } = render(
      <div className="content">
        {Array.from({ length: 100 }, (_, index) => (
          <WindowedVideoGridCard key={index} initiallyVisible={index < 8} estimatedHeight={320}>
            <article><button>{"视频 " + index}</button></article>
          </WindowedVideoGridCard>
        ))}
      </div>
    );
    expect(container.querySelectorAll(".video-grid-slot")).toHaveLength(100);
    const slots = Array.from(container.querySelectorAll(".video-grid-slot"));
    expect(slots.filter((slot) => slot.getAttribute("data-windowed-mounted") === "true")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: "视频 8" })).not.toBeInTheDocument();
    const slot = slots[8] as HTMLDivElement;
    expect(slot.style.height).toBe("320px");
    notify(slot, true);
    expect(screen.getByRole("button", { name: "视频 8" })).toBeInTheDocument();
    vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({ height: 468 } as DOMRect);
    notify(slot, false);
    expect(screen.queryByRole("button", { name: "视频 8" })).not.toBeInTheDocument();
    expect(slot.style.height).toBe("468px");
    notify(slot, true);
    expect(screen.getByRole("button", { name: "视频 8" })).toBeInTheDocument();
  });

  it("retains a focused card offscreen, then releases it after focus leaves", () => {
    installIntersectionObserver();
    const { container } = render(
      <div className="content">
        <WindowedVideoGridCard initiallyVisible={false} estimatedHeight={280}><article><button>远处视频</button></article></WindowedVideoGridCard>
      </div>
    );
    const slot = container.querySelector(".video-grid-slot") as HTMLDivElement;
    notify(slot, true);
    const button = screen.getByRole("button", { name: "远处视频" });
    fireEvent.focus(button);
    notify(slot, false);
    expect(screen.getByRole("button", { name: "远处视频" })).toBeInTheDocument();
    fireEvent.blur(button, { relatedTarget: null });
    expect(screen.queryByRole("button", { name: "远处视频" })).not.toBeInTheDocument();
  });

  it("renders all card contents when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(
      <div>
        {Array.from({ length: 100 }, (_, index) => (
          <WindowedVideoGridCard key={index} initiallyVisible={index < 8} estimatedHeight={300}>
            <article>{"视频 " + index}</article>
          </WindowedVideoGridCard>
        ))}
      </div>
    );
    expect(container.querySelectorAll(".video-grid-slot")).toHaveLength(100);
    expect(container.textContent).toContain("视频 99");
  });
});
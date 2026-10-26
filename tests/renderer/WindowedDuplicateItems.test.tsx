import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowedDuplicateItems } from "../../src/renderer/components/WindowedDuplicateItems";

afterEach(() => vi.unstubAllGlobals());

function makeItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: "item-" + index, label: "候选文件 " + index }));
}

describe("windowed duplicate group items", () => {
  it("mounts nearby row content, retains measured space offscreen, and restores it on re-entry", () => {
    let update!: IntersectionObserverCallback;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { update = callback; }
      observe() {}
      disconnect() {}
    });
    const items = makeItems(45);
    const { container } = render(
      <WindowedDuplicateItems
        items={items}
        getKey={(item) => item.id}
        threshold={40}
        estimatedHeight={124}
        renderItem={(item) => <article><button>{item.label}</button></article>}
      />
    );
    expect(screen.getByRole("button", { name: "候选文件 0" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "候选文件 8" })).not.toBeInTheDocument();
    const slot = container.querySelector("[data-item-key=\"item-8\"]") as HTMLDivElement;
    expect(slot.style.height).toBe("124px");
    act(() => update([{ target: slot, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole("button", { name: "候选文件 8" })).toBeInTheDocument();
    vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({ height: 178 } as DOMRect);
    act(() => update([{ target: slot, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.queryByRole("button", { name: "候选文件 8" })).not.toBeInTheDocument();
    expect(slot.style.height).toBe("178px");
    act(() => update([{ target: slot, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole("button", { name: "候选文件 8" })).toBeInTheDocument();
  });

  it("keeps an offscreen focused row mounted until focus leaves it", () => {
    let update!: IntersectionObserverCallback;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { update = callback; }
      observe() {}
      disconnect() {}
    });
    const items = makeItems(45);
    const { container } = render(
      <WindowedDuplicateItems items={items} getKey={(item) => item.id} renderItem={(item) => <article><button>{item.label}</button></article>} />
    );
    const slot = container.querySelector("[data-item-key=\"item-8\"]") as HTMLDivElement;
    act(() => update([{ target: slot, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    const button = screen.getByRole("button", { name: "候选文件 8" });
    fireEvent.focus(button);
    act(() => update([{ target: slot, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole("button", { name: "候选文件 8" })).toBeInTheDocument();
    fireEvent.blur(button, { relatedTarget: null });
    expect(screen.queryByRole("button", { name: "候选文件 8" })).not.toBeInTheDocument();
  });

  it("mounts only a small initial window for a 500-item duplicate group", () => {
    vi.stubGlobal("IntersectionObserver", class {
      constructor(_callback: IntersectionObserverCallback) {}
      observe() {}
      disconnect() {}
    });
    const items = makeItems(500);
    const renderItem = vi.fn((item: { id: string; label: string }) => <article>{item.label}</article>);
    const { container } = render(<WindowedDuplicateItems items={items} getKey={(item) => item.id} renderItem={renderItem} />);
    expect(renderItem).toHaveBeenCalledTimes(8);
    const slots = Array.from(container.querySelectorAll(".duplicate-item-slot"));
    expect(slots).toHaveLength(500);
    expect(slots.filter((slot) => slot.getAttribute("data-windowed-mounted") === "true")).toHaveLength(8);
  });
  it("keeps expensive row content windowed for a 10,000-item duplicate group", () => {
    vi.stubGlobal("IntersectionObserver", class {
      constructor(_callback: IntersectionObserverCallback) {}
      observe() {}
      disconnect() {}
    });
    const items = makeItems(10_000);
    const renderItem = vi.fn((item: { id: string; label: string }) => <article data-expensive-row>{item.label}</article>);
    const startedAt = performance.now();
    const { container } = render(<WindowedDuplicateItems items={items} getKey={(item) => item.id} renderItem={renderItem} />);
    const renderElapsedMs = performance.now() - startedAt;
    const slots = Array.from(container.querySelectorAll(".duplicate-item-slot"));
    const mountedSlots = slots.filter((slot) => slot.getAttribute("data-windowed-mounted") === "true");

    expect(slots).toHaveLength(10_000);
    expect(mountedSlots).toHaveLength(8);
    expect(container.querySelectorAll("[data-expensive-row]")).toHaveLength(8);
    expect(renderItem).toHaveBeenCalledTimes(8);
    console.info(`Windowed duplicate items 10k: ${renderElapsedMs.toFixed(2)} ms; slots=${slots.length}; mounted=${mountedSlots.length}`);
  }, 20_000);

  it("releases focus retention when a row blurs before scrolling offscreen", () => {
    let update!: IntersectionObserverCallback;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { update = callback; }
      observe() {}
      disconnect() {}
    });
    const items = makeItems(45);
    const { container } = render(<WindowedDuplicateItems items={items} getKey={(item) => item.id} renderItem={(item) => <button>{item.label}</button>} />);
    const slot = container.querySelector("[data-item-key=\"item-8\"]") as HTMLDivElement;
    act(() => update([{ target: slot, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    const button = screen.getByRole("button", { name: "候选文件 8" });
    fireEvent.focus(button);
    fireEvent.blur(button, { relatedTarget: null });
    expect(screen.getByRole("button", { name: "候选文件 8" })).toBeInTheDocument();
    act(() => update([{ target: slot, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.queryByRole("button", { name: "候选文件 8" })).not.toBeInTheDocument();
  });

  it("observes newly inserted items without replacing unchanged slots", () => {
    let update!: IntersectionObserverCallback;
    const observed: string[] = [];
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { update = callback; }
      observe(element: Element) { observed.push((element as HTMLElement).dataset.itemKey ?? ""); }
      disconnect() {}
    });
    const items = makeItems(45);
    const getKey = (item: { id: string }) => item.id;
    const renderItem = (item: { id: string; label: string }) => <button>{item.label}</button>;
    const { container, rerender } = render(<WindowedDuplicateItems items={items} getKey={getKey} renderItem={renderItem} />);
    const stableSlot = container.querySelector('[data-item-key="item-20"]');
    expect(stableSlot).not.toBeNull();
    const changed = [...items.slice(0, 20), { id: "added", label: "新加入候选" }, ...items.slice(20)];
    rerender(<WindowedDuplicateItems items={changed} getKey={getKey} renderItem={renderItem} />);
    expect(container.querySelectorAll(".duplicate-item-slot")).toHaveLength(46);
    expect(container.querySelector('[data-item-key="item-20"]')).toBe(stableSlot);
    expect(observed).toContain("added");
    const addedSlot = container.querySelector('[data-item-key="added"]') as HTMLDivElement;
    act(() => update([{ target: addedSlot, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole("button", { name: "新加入候选" })).toBeInTheDocument();
  });

  it("does not rerender small groups just because a row receives focus", () => {
    const items = makeItems(2);
    const renderItem = vi.fn((item: { id: string; label: string }) => <button>{item.label}</button>);
    render(<WindowedDuplicateItems items={items} getKey={(item) => item.id} renderItem={renderItem} />);
    expect(renderItem).toHaveBeenCalledTimes(2);
    fireEvent.focus(screen.getByRole("button", { name: "候选文件 0" }));
    expect(renderItem).toHaveBeenCalledTimes(2);
  });
  it("falls back to rendering every item when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const items = makeItems(45);
    render(<WindowedDuplicateItems items={items} getKey={(item) => item.id} renderItem={(item) => <article>{item.label}</article>} />);
    expect(screen.getByText("候选文件 44")).toBeInTheDocument();
  });
});
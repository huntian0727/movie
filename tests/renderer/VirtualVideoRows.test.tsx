import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VirtualVideoRows } from "../../src/renderer/components/VirtualVideoRows";

afterEach(() => vi.unstubAllGlobals());

describe("visible video rows", () => {
  it("unmounts offscreen controls and keeps their measured table space until re-entry", () => {
    let update!: IntersectionObserverCallback;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { update = callback; }
      observe() {} disconnect() {}
    });
    const { container } = render(<table><VirtualVideoRows columns={6} estimatedHeight={210} initiallyVisible>
      <tr><td><button>播放测试视频</button></td></tr>
    </VirtualVideoRows></table>);
    const tbody = container.querySelector("tbody")!;
    vi.spyOn(tbody, "getBoundingClientRect").mockReturnValue({ height: 325 } as DOMRect);
    act(() => update([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(tbody.querySelector("td")?.style.height).toBe("325px");
    act(() => update([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole("button", { name: "播放测试视频" })).toBeInTheDocument();
  });
});

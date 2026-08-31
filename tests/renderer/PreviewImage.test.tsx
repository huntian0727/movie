import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewImage } from "../../src/renderer/components/PreviewImage";

const observers: Array<(visible: boolean) => void> = [];
let load: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  observers.length = 0;
  load = vi.fn().mockImplementation(() => new Promise(() => undefined));
  cancel = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("videoManager", { loadPreviewImage: load, cancelPreviewImage: cancel });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      observers.push((visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    observe() {} disconnect() {}
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("visible-page preview requests", () => {
  it("waits for visibility and cancels the outstanding request when the page leaves", async () => {
    const { unmount } = render(<PreviewImage src="local-video://cover/a" delayMs={0} />);
    expect(load).not.toHaveBeenCalled();
    act(() => observers[0](true));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    const request = load.mock.calls[0][0];
    expect(request).toMatchObject({ url: "local-video://cover/a", priority: 1, cachedOnly: false });
    unmount();
    expect(cancel).toHaveBeenCalledWith(request.requestId);
  });

  it("cancels an old hover request on position change and ignores its late response", async () => {
    let oldResolve!: (value: Uint8Array) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { oldResolve = resolve; }));
    const { rerender } = render(<PreviewImage src="local-video://preview/a/5000" eager priority={2} delayMs={0} />);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    const id = load.mock.calls[0][0].requestId;
    rerender(<PreviewImage src="local-video://preview/a/10000" eager priority={2} delayMs={0} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(cancel).toHaveBeenCalledWith(id);
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL }));
    await act(async () => oldResolve(new Uint8Array([1, 2])));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("uses cache-only mode on the exception page and keeps request priority", async () => {
    render(<PreviewImage src="local-video://cover/a" eager cachedOnly priority={0} delayMs={0} />);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(load.mock.calls[0][0]).toMatchObject({ cachedOnly: true, priority: 0 });
  });

  it("cancels invisible cards before serving another page", async () => {
    render(<PreviewImage src="local-video://cover/a" delayMs={0} />);
    act(() => observers[0](true));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    act(() => observers[0](false));
    expect(cancel).toHaveBeenCalledWith(load.mock.calls[0][0].requestId);
  });
});

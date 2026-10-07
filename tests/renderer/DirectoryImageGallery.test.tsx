import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryImageGallery, VisibleImage } from "../../src/renderer/components/DirectoryImageGallery";
import type { DirectoryImagePage } from "../../src/shared/imageViewing";

let observers: Array<(visible: boolean) => void>;
let fetchImage: ReturnType<typeof vi.fn>;
const revoke = vi.fn();
beforeEach(() => {
  observers = []; revoke.mockClear();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { observers.push(visible => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver)); }
    observe() {} disconnect() {}
  });
  fetchImage = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["image"]) });
  vi.stubGlobal("fetch", fetchImage);
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:image"), revokeObjectURL: revoke }));
});
afterEach(() => vi.unstubAllGlobals());
describe("lightweight image viewing", () => {
  it("reads no offscreen images, then releases and aborts reads when hidden", async () => {
    const { container } = render(<VisibleImage url="local-video://image/test/0/thumbnail" alt="" enabled />);
    expect(fetchImage).not.toHaveBeenCalled();
    act(() => observers[0](true));
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    const signal = fetchImage.mock.calls[0][1].signal;
    act(() => observers[0](false));
    expect(signal.aborted).toBe(true);
    expect(revoke).toHaveBeenCalledWith("blob:image");
    expect(container.querySelector("img")).toBeNull();
  });
  it("cancels a pending thumbnail before allowing a late response to allocate a blob", async () => {
    let resolve!: (value: unknown) => void;
    fetchImage.mockReturnValue(new Promise(done => { resolve = done; }));
    const { container } = render(<VisibleImage url="local-video://image/test/0/thumbnail" alt="" enabled />);
    act(() => observers[0](true));
    await waitFor(() => expect(fetchImage).toHaveBeenCalledOnce());
    act(() => observers[0](false));
    await act(async () => { resolve({ ok: true, blob: async () => new Blob(["late"]) }); });
    expect(container.querySelector("img")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("opens only the selected original, navigates with arrows and releases the directory", async () => {
    const data: DirectoryImagePage = { sessionId: "session", offset: 0, totalCount: 2, truncated: false, directories: [], files: [
      { name: "a.jpg", thumbnailUrl: "local-video://image/test/0/thumbnail", originalUrl: "local-video://image/test/0/original" },
      { name: "b.jpg", thumbnailUrl: "local-video://image/test/1/thumbnail", originalUrl: "local-video://image/test/1/original" }
    ] };
    const api = { listDirectoryImages: vi.fn().mockResolvedValue(data), closeImageDirectory: vi.fn().mockResolvedValue(undefined) };
    const { getByRole, unmount } = render(<DirectoryImageGallery api={api} sourceFolderId="source" directoryPath="D:\\四姑娘山" refreshSequence={0} onNavigate={vi.fn()} />);
    await waitFor(() => expect(getByRole("button", { name: "查看图片 a.jpg" })).toBeTruthy());
    expect(fetchImage).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: "查看图片 a.jpg" }));
    await waitFor(() => expect(fetchImage).toHaveBeenCalledWith(data.files[0].originalUrl, expect.anything()));
    fireEvent.keyDown(getByRole("dialog"), { key: "ArrowRight" });
    await waitFor(() => expect(fetchImage).toHaveBeenCalledWith(data.files[1].originalUrl, expect.anything()));
    expect(fetchImage.mock.calls[0][1].signal.aborted).toBe(true);
    fireEvent.keyDown(getByRole("dialog"), { key: "Escape" });
    expect(getByRole("button", { name: "查看图片 a.jpg" })).toHaveFocus();
    unmount();
    expect(api.closeImageDirectory).toHaveBeenCalledWith("session");
  });
});

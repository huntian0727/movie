import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePlayerWindowFullscreen } from "../../src/renderer/components/usePlayerWindowFullscreen";
import type { EmbeddedRequest, EmbeddedState } from "../../src/shared/embeddedPlayback";

const result = (fullscreen: boolean) => ({ fullscreen } as EmbeddedState);
describe("player window fullscreen adapter", () => {
  it("ignores a state read started before a toggle and bounds rapid clicks", async () => {
    let releaseRead!: (s: EmbeddedState) => void, releaseToggle!: (s: EmbeddedState) => void;
    const onChange = vi.fn();
    const api = { embeddedPlayback: vi.fn((r: EmbeddedRequest) => new Promise<EmbeddedState>(resolve => {
      if (r.op === "window-state") releaseRead = resolve;
      else releaseToggle = resolve;
    })) };
    const view = renderHook(() => usePlayerWindowFullscreen(api, onChange));
    let toggle!: Promise<void>;
    act(() => { toggle = view.result.current.toggle(); void view.result.current.toggle(); });
    expect(api.embeddedPlayback.mock.calls.filter(([r]) => r.op === "fullscreen")).toHaveLength(1);
    await act(async () => { releaseToggle(result(true)); await toggle; releaseRead(result(false)); });
    expect(onChange.mock.calls).toEqual([[true]]); view.unmount();
  });
  it("refreshes from the OS on resize and removes listeners when unmounted", async () => {
    const onChange = vi.fn(), remove = vi.spyOn(window, "removeEventListener");
    const api = { embeddedPlayback: vi.fn(async () => result(false)) };
    const view = renderHook(() => usePlayerWindowFullscreen(api, onChange));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(false));
    api.embeddedPlayback.mockResolvedValue(result(true));
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
    view.unmount(); const count = api.embeddedPlayback.mock.calls.length;
    window.dispatchEvent(new Event("resize"));
    expect(api.embeddedPlayback).toHaveBeenCalledTimes(count);
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function)); remove.mockRestore();
  });
});

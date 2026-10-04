import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEmbeddedEngine } from "../../src/renderer/components/useEmbeddedEngine";
import type { EmbeddedRequest, EmbeddedState } from "../../src/shared/embeddedPlayback";

afterEach(() => vi.useRealTimers());
const state = (key: string, paused = true): EmbeddedState => ({ sessionKey: key, phase: paused ? "paused" : "playing", paused, time: 3, duration: 12, volume: 20, rotation: 0, fullscreen: false, tracks: [] });
function fixture(implementation?: (request: EmbeddedRequest) => Promise<EmbeddedState>) {
  const api = { embeddedPlayback: vi.fn(implementation ?? (async r => state(r.sessionKey))), subscribeEmbeddedInput: vi.fn(() => vi.fn()) };
  const hook = renderHook(({ videoId }) => useEmbeddedEngine({ api, enabled: true, videoId, autoplay: false, stage: { current: null }, visible: true, layoutKey: "", onInput: () => undefined }), { initialProps: { videoId: "one" } });
  return { ...hook, api };
}
describe("confirmed pause state reconciliation", () => {
  it("does not let a poll started before a pause overwrite its confirmation", async () => {
    vi.useFakeTimers();
    let oldPoll!: () => void;
    const f = fixture(r => r.op === "state" ? new Promise(resolve => { oldPoll = () => resolve(state(r.sessionKey)); }) : Promise.resolve(state(r.sessionKey, r.op !== "pause" || r.value)));
    await act(async () => undefined);
    await act(async () => vi.advanceTimersByTimeAsync(250));
    await act(async () => f.result.current.send({ op: "pause", value: false }));
    expect(f.result.current.state?.paused).toBe(false);
    await act(async () => oldPoll());
    expect(f.result.current.state?.paused).toBe(false);
    f.unmount();
  });
  it("reports a failed control without pretending playback changed and clears pending intent", async () => {
    const f = fixture(async r => { if (r.op === "pause") throw Error("native rejected"); return state(r.sessionKey); });
    await act(async () => undefined);
    await act(async () => f.result.current.send({ op: "pause", value: false }));
    expect(f.result.current.state?.paused).toBe(true);
    expect(f.result.current.getPaused()).toBe(true);
    expect(f.result.current.error).toBe("播放操作未完成，请重试");
    f.unmount();
  });
  it("drops a confirmation from a replaced session", async () => {
    let finish!: () => void;
    const f = fixture(r => r.op === "pause" ? new Promise(resolve => { finish = () => resolve(state(r.sessionKey, false)); }) : Promise.resolve(state(r.sessionKey)));
    await act(async () => undefined);
    let pending!: Promise<void>;
    act(() => { pending = f.result.current.send({ op: "pause", value: false }); });
    const oldKey = f.result.current.state?.sessionKey;
    f.rerender({ videoId: "two" });
    await act(async () => undefined);
    const newKey = f.result.current.state?.sessionKey;
    expect(newKey).not.toBe(oldKey);
    await act(async () => { finish(); await pending; });
    expect(f.result.current.state).toMatchObject({ sessionKey: newKey, paused: true });
    f.unmount();
  });
});

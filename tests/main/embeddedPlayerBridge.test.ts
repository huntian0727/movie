import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";

// Execute the real preload, not a complete VideoManagerApi mock that hides role-specific omissions.
const source = readFileSync(path.resolve("src/main/preload.cts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function bridge(location = "file:///fixture/index.html", role = "player") {
  let api: any;
  const invoke = vi.fn(async () => ({ phase: "loading" })), on = vi.fn(), removeListener = vi.fn();
  const electron = { contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { api = value; } }, ipcRenderer: { invoke, on, removeListener } };
  vm.runInNewContext(compiled, {
    exports: {}, URL, window: { location: { href: location } },
    process: { argv: [`--video-manager-window-role=${role}`, "--video-manager-entry-url=file%3A%2F%2F%2Ffixture%2Findex.html"] },
    require: (name: string) => { if (name !== "electron") throw Error("unexpected preload dependency"); return electron; }
  });
  return { api, invoke, on, removeListener };
}
describe("real player-role preload embedded bridge", () => {
  it("gives the floating preview only image methods and buffers the first content update", () => {
    const b = bridge("file:///fixture/index.html", "timeline-preview");
    expect(b.api.windowMode).toBe("timeline-preview");
    expect(Object.keys(b.api).sort()).toEqual(["windowMode", "loadPreviewImage", "cancelPreviewImage", "getPreviewImageState", "subscribePlayerTimelinePreview"].sort());
    const [channel, handler] = b.on.mock.calls[0];
    expect(channel).toBe("player:timeline-preview");
    const payload = { url: "local-video://preview/v1/45000", timeMs: 45000, imageHeight: 90 };
    handler({}, payload);
    const listener = vi.fn(), dispose = b.api.subscribePlayerTimelinePreview(listener);
    expect(listener).toHaveBeenCalledWith(payload);
    handler({}, null); expect(listener).toHaveBeenLastCalledWith(null);
    dispose(); listener.mockClear(); handler({}, payload); expect(listener).not.toHaveBeenCalled();
  });
  it("exposes the typed preview-position request only on the normal player/main bridge", async () => {
    const b = bridge();
    await b.api.showPlayerTimelinePreview(null);
    expect(b.invoke).toHaveBeenCalledWith("player:timeline-preview", null);
  });
  it("exposes typed playback and forwards an ID-only request without broadening the player bridge", async () => {
    const b = bridge();
    expect(typeof b.api.embeddedPlayback).toBe("function");
    expect(typeof b.api.subscribeEmbeddedKeys).toBe("function");
    expect(typeof b.api.subscribeEmbeddedInput).toBe("function");
    const request = { op: "start", sessionKey: "key", videoId: "v", autoplay: false };
    await b.api.embeddedPlayback(request);
    expect(b.invoke).toHaveBeenCalledWith("player:embedded", request);
    for (const forbidden of ["invoke", "setSettings", "deleteVideos", "moveVideos", "clearCache", "exportDiagnostics"]) expect(b.api[forbidden]).toBeUndefined();
  });
  it("filters embedded hotkeys and removes the exact listener", () => {
    const b = bridge(), listener = vi.fn(); const dispose = b.api.subscribeEmbeddedKeys(listener);
    const [channel, handler] = b.on.mock.calls[0]; expect(channel).toBe("player:embedded-key");
    handler({}, "Space"); handler({}, "KeyF"); handler({}, "Escape"); handler({}, "Delete");
    expect(listener.mock.calls).toEqual([["Space"], ["KeyF"], ["Escape"]]);
    dispose(); expect(b.removeListener).toHaveBeenCalledWith(channel, handler);
  });
  it("does not expose any bridge to a non-entry page", () => {
    expect(bridge("https://example.com/untrusted").api).toBeUndefined();
  });
  it("filters native input, preserves shortcut modifiers and disposes the input listener", () => {
    const b = bridge(), listener = vi.fn(); const dispose = b.api.subscribeEmbeddedInput(listener);
    const [channel, handler] = b.on.mock.calls[0]; expect(channel).toBe("player:embedded-input");
    const key = { kind: "key", code: "ArrowLeft", control: true, shift: false, alt: false };
    handler({}, key); handler({}, { kind: "double-click" });
    handler({}, { kind: "key", code: "Delete", control: true, shift: false, alt: false });
    handler({}, { ...key, alt: "invalid" }); handler({}, { kind: "command", command: "loadfile" });
    expect(listener.mock.calls).toEqual([[key], [{ kind: "double-click" }]]);
    dispose(); expect(b.removeListener).toHaveBeenCalledWith(channel, handler);
  });
});

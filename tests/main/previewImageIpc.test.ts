// @vitest-environment node
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerPreviewImageHandlers } from "../../src/main/media/previewImageIpc";
import type { ImageRequestOptions } from "../../src/main/media/imageGenerationQueue";
import { getAllowedIpcRoles } from "../../src/main/security";
import { IPC_CHANNELS } from "../../src/shared/videoTypes";

function setup() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>();
  const load = vi.fn((_url: string, options: ImageRequestOptions) => new Promise<Uint8Array | null>((resolve) =>
    options.signal!.addEventListener("abort", () => resolve(null), { once: true })));
  registerPreviewImageHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, load);
  const sender = Object.assign(new EventEmitter(), { id: 1 });
  const event = { sender } as unknown as IpcMainInvokeEvent;
  return { load, sender, invoke: (channel: string, payload: unknown, owner = event) => handlers.get(channel)!(owner, payload) };
}
const request = (requestId = randomUUID()) => ({ requestId, url: "local-video://preview/video/5000", cachedOnly: false, priority: 1 });

describe("preview image IPC state", () => {
  it("isolates state/cancellation by owner and releases active requests on navigation", async () => {
    const s = setup();
    const input = request();
    const result = s.invoke(IPC_CHANNELS.previewImageLoad, input);
    const other = { sender: { id: 2 } } as IpcMainInvokeEvent;
    expect(s.invoke(IPC_CHANNELS.previewImageState, input.requestId, other)).toBeNull();
    s.invoke(IPC_CHANNELS.previewImageCancel, input.requestId, other);
    expect(s.load.mock.calls[0][1].signal!.aborted).toBe(false);
    expect(s.invoke(IPC_CHANNELS.previewImageState, input.requestId)).toBe("queued");
    s.load.mock.calls[0][1].onStateChange!("active");
    expect(s.invoke(IPC_CHANNELS.previewImageState, input.requestId)).toBe("active");
    expect(s.load).toHaveBeenCalledOnce();
    s.sender.emit("did-start-navigation");
    expect(await result).toBeNull();
    expect(s.invoke(IPC_CHANNELS.previewImageState, input.requestId)).toBeNull();
  });

  it("rejects untrusted options and duplicate/oversized request sets, and clears them on close", async () => {
    const s = setup();
    await expect(s.invoke(IPC_CHANNELS.previewImageLoad, { ...request(), remote: true })).rejects.toThrow();
    expect(() => s.invoke(IPC_CHANNELS.previewImageState, "bad-id")).toThrow();
    const input = request();
    const work = [s.invoke(IPC_CHANNELS.previewImageLoad, input)];
    await expect(s.invoke(IPC_CHANNELS.previewImageLoad, input)).rejects.toThrow("duplicate");
    for (let i = 1; i < 256; i++) work.push(s.invoke(IPC_CHANNELS.previewImageLoad, request()));
    await expect(s.invoke(IPC_CHANNELS.previewImageLoad, request())).rejects.toThrow("Too many");
    s.sender.emit("destroyed");
    await Promise.all(work);
    expect(s.invoke(IPC_CHANNELS.previewImageState, input.requestId)).toBeNull();
    expect(getAllowedIpcRoles(IPC_CHANNELS.previewImageState)).toEqual(["main", "player"]);
  });
});

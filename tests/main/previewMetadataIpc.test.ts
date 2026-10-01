// @vitest-environment node
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { registerPreviewMetadataHandlers } from "../../src/main/media/previewMetadataIpc";
import { getAllowedIpcRoles } from "../../src/main/security";
import { IPC_CHANNELS, type VideoRecord } from "../../src/shared/videoTypes";
import type { MetadataQueue } from "../../src/main/media/metadataQueue";
import type { VideoRepository } from "../../src/main/db/videoRepository";

function setup() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>();
  const video = { id: "video", path: "D:\\video.mp4", sizeBytes: 100, modifiedAt: "T1", metadataStatus: "pending", durationMs: null } as VideoRecord;
  const getVideo = vi.fn(() => video);
  const markMetadataPending = vi.fn();
  const requestVisible = vi.fn((_id: string, signal: AbortSignal) => new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true })));
  const getVideoState = vi.fn(() => "active");
  registerPreviewMetadataHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, { getVideo, markMetadataPending } as unknown as VideoRepository, { requestVisible, getVideoState } as unknown as MetadataQueue);
  const sender = Object.assign(new EventEmitter(), { id: 1 });
  const event = { sender } as unknown as IpcMainInvokeEvent;
  const invoke = (channel: string, payload: unknown, owner = event) => handlers.get(channel)!(owner, payload);
  return { video, sender, event, invoke, getVideo, markMetadataPending, requestVisible, getVideoState };
}

describe("visible preview metadata IPC", () => {
  it("owns state and cancellation by renderer, and cancels on navigation", async () => {
    const s = setup();
    const id = randomUUID();
    const result = s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: id, videoId: "video", retry: false });
    const other = { sender: { id: 2 } } as IpcMainInvokeEvent;
    expect(s.invoke(IPC_CHANNELS.previewMetadataState, id, other)).toBeNull();
    s.invoke(IPC_CHANNELS.previewMetadataCancel, id, other);
    expect(s.requestVisible.mock.calls[0][1].aborted).toBe(false);
    expect(s.invoke(IPC_CHANNELS.previewMetadataState, id)).toBe("active");
    s.sender.emit("did-start-navigation");
    expect(await result).toBeNull();
    expect(s.requestVisible.mock.calls[0][1].aborted).toBe(true);
    expect(s.invoke(IPC_CHANNELS.previewMetadataState, id)).toBeNull();
  });

  it("validates payloads and bounds outstanding requests", async () => {
    const s = setup();
    await expect(s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: "bad", videoId: "video", retry: false })).rejects.toThrow();
    await expect(s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: randomUUID(), videoId: "video", retry: false, path: "arbitrary" })).rejects.toThrow();
    const first = randomUUID();
    const requests = [s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: first, videoId: "video", retry: false })];
    await expect(s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: first, videoId: "video", retry: false })).rejects.toThrow("duplicate");
    for (let i = 1; i < 64; i += 1) requests.push(s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: randomUUID(), videoId: "video", retry: false }));
    await expect(s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: randomUUID(), videoId: "video", retry: false })).rejects.toThrow("Too many");
    s.sender.emit("destroyed");
    await Promise.all(requests);
  });

  it("retries failed metadata only by explicit request and never analyzes zero-byte or missing files", async () => {
    const s = setup();
    s.getVideo.mockReturnValue({ ...s.video, metadataStatus: "failed" });
    s.requestVisible.mockResolvedValue(null);
    await s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: randomUUID(), videoId: "video", retry: false });
    expect(s.markMetadataPending).not.toHaveBeenCalled();
    await s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: randomUUID(), videoId: "video", retry: true });
    expect(s.markMetadataPending).toHaveBeenCalledWith("video", "D:\\video.mp4", 100, "T1");
    s.requestVisible.mockClear();
    for (const blocked of [{ sizeBytes: 0 }, { isMissing: true }]) {
      s.getVideo.mockReturnValue({ ...s.video, ...blocked });
      await s.invoke(IPC_CHANNELS.previewMetadataLoad, { requestId: randomUUID(), videoId: "video", retry: true });
    }
    expect(s.requestVisible).not.toHaveBeenCalled();
    for (const channel of [IPC_CHANNELS.previewMetadataLoad, IPC_CHANNELS.previewMetadataState, IPC_CHANNELS.previewMetadataCancel]) expect(getAllowedIpcRoles(channel)).toEqual(["main"]);
  });
});

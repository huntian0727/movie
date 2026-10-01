import type { IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { IPC_CHANNELS } from "../../shared/videoTypes.js";
import type { VideoRepository } from "../db/videoRepository.js";
import type { MetadataQueue } from "./metadataQueue.js";

interface HandlerRegistry {
  handle(channel: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown): void;
}

/** Request ownership is limited to the trusted main window that registered each request. */
export function registerPreviewMetadataHandlers(registry: HandlerRegistry, repo: VideoRepository, queue: MetadataQueue): void {
  const owners = new Map<number, Map<string, { controller: AbortController; videoId: string }>>();
  const observed = new Set<number>();
  const requestSchema = z.object({ requestId: z.string().uuid(), videoId: z.string().min(1).max(200), retry: z.boolean() }).strict();
  const idSchema = z.string().uuid();
  registry.handle(IPC_CHANNELS.previewMetadataLoad, async (event, payload) => {
    const request = requestSchema.parse(payload);
    const owner = event.sender.id;
    if (!observed.has(owner)) {
      observed.add(owner);
      const cancel = () => {
        for (const item of owners.get(owner)?.values() ?? []) item.controller.abort();
        owners.delete(owner);
      };
      event.sender.on("did-start-navigation", cancel);
      event.sender.once("destroyed", () => { cancel(); observed.delete(owner); });
    }
    const requests = owners.get(owner) ?? new Map();
    if (requests.size >= 64 || requests.has(request.requestId)) throw new Error("Too many or duplicate metadata requests");
    const video = repo.getVideo(request.videoId);
    if (video.isMissing || video.sizeBytes <= 0) return video;
    if (request.retry && video.metadataStatus === "failed") repo.markMetadataPending(video.id, video.path, video.sizeBytes, video.modifiedAt);
    const controller = new AbortController();
    requests.set(request.requestId, { controller, videoId: video.id });
    owners.set(owner, requests);
    try {
      return await queue.requestVisible(video.id, controller.signal, request.retry);
    } finally {
      requests.delete(request.requestId);
    }
  });
  registry.handle(IPC_CHANNELS.previewMetadataState, (event, payload) => {
    const request = owners.get(event.sender.id)?.get(idSchema.parse(payload));
    return request ? queue.getVideoState(request.videoId) : null;
  });
  registry.handle(IPC_CHANNELS.previewMetadataCancel, (event, payload) => {
    owners.get(event.sender.id)?.get(idSchema.parse(payload))?.controller.abort();
  });
}

import type { IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { IPC_CHANNELS } from "../../shared/videoTypes.js";
import type { ImageRequestOptions } from "./imageGenerationQueue.js";

interface HandlerRegistry {
  handle(channel: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown): void;
}

/** State reads are owner-scoped memory lookups, with no database or media access. */
export function registerPreviewImageHandlers(registry: HandlerRegistry,
  load: (url: string, options: ImageRequestOptions) => Promise<Uint8Array | null>): void {
  const owners = new Map<number, Map<string, { controller: AbortController; state: "queued" | "active" }>>();
  const observed = new Set<number>();
  const requestSchema = z.object({
    requestId: z.string().uuid(), url: z.string().max(4096), cachedOnly: z.boolean(),
    priority: z.union([z.literal(0), z.literal(1), z.literal(2)])
  }).strict();
  const idSchema = z.string().uuid();
  registry.handle(IPC_CHANNELS.previewImageLoad, async (event, payload) => {
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
    if (requests.size >= 256 || requests.has(request.requestId)) throw new Error("Too many or duplicate image requests");
    const tracked = { controller: new AbortController(), state: "queued" as "queued" | "active" };
    requests.set(request.requestId, tracked);
    owners.set(owner, requests);
    try {
      return await load(request.url, {
        signal: tracked.controller.signal, priority: request.priority, cachedOnly: request.cachedOnly,
        onStateChange: (state) => { tracked.state = state; }
      });
    } finally {
      requests.delete(request.requestId);
    }
  });
  registry.handle(IPC_CHANNELS.previewImageCancel, (event, payload) => {
    const id = idSchema.parse(payload);
    owners.get(event.sender.id)?.get(id)?.controller.abort();
  });
  registry.handle(IPC_CHANNELS.previewImageState, (event, payload) => {
    const id = idSchema.parse(payload);
    return owners.get(event.sender.id)?.get(id)?.state ?? null;
  });
}

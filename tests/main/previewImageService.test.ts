// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ protocol: { handle: vi.fn() } }));
vi.mock("../../src/main/media/cacheService", async (original) => ({
  ...await original<object>(),
  generateCover: vi.fn(async (_input: string, output: string) => { await writeFile(output, "jpeg"); }),
  generateTimelineFrame: vi.fn(async (_input: string, output: string) => { await writeFile(output, "frame"); })
}));
import { generateCover, generateTimelineFrame } from "../../src/main/media/cacheService";
import { MediaCacheManager } from "../../src/main/media/cacheManager";
import { loadPreviewImage } from "../../src/main/media/mediaProtocol";
import type { VideoRepository } from "../../src/main/db/videoRepository";

const roots: string[] = [];
afterEach(async () => { vi.clearAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup(missing = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "preview-service-")); roots.push(root);
  const cache = new MediaCacheManager(root);
  await cache.initialize();
  const repo = {
    getVideo: vi.fn(() => ({ id: "a", path: "F:\\Cloud\\a.mp4", sizeBytes: 100, modifiedAt: "2026-08-31", durationMs: null as number | null, providerFileId: undefined as string | undefined, metadataStatus: "pending", isMissing: missing })),
    markThumbnailReady: vi.fn(), markThumbnailFailed: vi.fn(), markThumbnailPending: vi.fn(),
    markTimelinePreviewReady: vi.fn(), markTimelinePreviewFailed: vi.fn()
  };
  return { cache, repo, repository: repo as unknown as VideoRepository };
}

describe("on-demand preview service", () => {
  it("classifies remote work in Main and supplies six current-version baseline frame paths", async () => {
    const { cache, repo, repository } = await setup();
    const original = repo.getVideo();
    repo.getVideo.mockReturnValue({ ...original, durationMs: 60_000, providerFileId: "cloud-id" } as typeof original);
    const state = vi.fn();
    await loadPreviewImage(repository, cache, "local-video://preview/a/5000", 5, { onStateChange: state });
    expect(generateTimelineFrame).toHaveBeenCalledWith(original.path, expect.any(String), 5000, expect.objectContaining({ fastSeek: true }));
    expect(state.mock.calls.map(([value]) => value)).toEqual(["queued", "active"]);
    expect(repo.markTimelinePreviewReady.mock.calls[0][3]).toHaveLength(6);
    await loadPreviewImage(repository, cache, "local-video://preview/a/5000", 5);
    expect(generateTimelineFrame).toHaveBeenCalledOnce();
    repo.getVideo.mockReturnValue({ ...original, durationMs: 60_000 });
    await loadPreviewImage(repository, cache, "local-video://preview/a/15000", 5, { remote: true });
    expect(generateTimelineFrame).toHaveBeenLastCalledWith(original.path, expect.any(String), 15000, expect.objectContaining({ fastSeek: false }));
  });

  it("generates a pending-metadata API video's cover and reuses its local cache", async () => {
    const { cache, repo, repository } = await setup();
    expect(await loadPreviewImage(repository, cache, "local-video://cover/a", 5)).not.toBeNull();
    expect(await loadPreviewImage(repository, cache, "local-video://cover/a", 5)).not.toBeNull();
    expect(generateCover).toHaveBeenCalledOnce();
    expect(repo.markThumbnailReady).toHaveBeenCalled();
  });
  it("does not generate or mark a failure for a cache-only miss", async () => {
    const { cache, repo, repository } = await setup();
    expect(await loadPreviewImage(repository, cache, "local-video://cover/a", 5, { cachedOnly: true })).toBeNull();
    expect(generateCover).not.toHaveBeenCalled();
    expect(repo.markThumbnailFailed).not.toHaveBeenCalled();
  });
  it("does not read a missing video and does not mark cancellation as failure", async () => {
    const { cache, repo, repository } = await setup(true);
    expect(await loadPreviewImage(repository, cache, "local-video://cover/a", 5)).toBeNull();
    const controller = new AbortController(); controller.abort();
    expect(await loadPreviewImage(repository, cache, "local-video://cover/a", 5, { signal: controller.signal })).toBeNull();
    expect(generateCover).not.toHaveBeenCalled();
    expect(repo.markThumbnailFailed).not.toHaveBeenCalled();
  });
  it("rejects arbitrary URLs before resolving a video", async () => {
    const { cache, repo, repository } = await setup();
    await expect(loadPreviewImage(repository, cache, "file:///C:/private.txt", 5)).rejects.toThrow();
    expect(repo.getVideo).not.toHaveBeenCalled();
  });
});

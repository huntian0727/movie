// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DirectoryImageService } from "../../src/main/media/directoryImageService";
import type { MediaCacheManager } from "../../src/main/media/cacheManager";
import type { SourceFolder } from "../../src/shared/videoTypes";

let root: string;
let folders: SourceFolder[];
let service: DirectoryImageService;
const cacheRead = vi.fn();
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "movie-images-"));
  folders = [{ id: "source", path: root, providerType: "local" } as SourceFolder];
  cacheRead.mockReset().mockResolvedValue(Buffer.from("thumbnail"));
  service = new DirectoryImageService(() => folders, { root: path.join(root, "cache"), getOrCreateImage: cacheRead } as unknown as MediaCacheManager);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe("on-demand directory images", () => {
  it("lists supported names and image-only child directories without decoding or generating anything", async () => {
    await Promise.all([writeFile(path.join(root, "IMG10.JPG"), "ten"), writeFile(path.join(root, "IMG2.png"), "two"), writeFile(path.join(root, "clip.mp4"), "video"), writeFile(path.join(root, "file.jpg.tmp"), "partial"), mkdir(path.join(root, "只有图片"))]);
    const page = await service.list({ sourceFolderId: "source", directoryPath: root });
    expect(page.files.map(file => file.name)).toEqual(["IMG2.png", "IMG10.JPG"]);
    expect(page.directories[0].name).toBe("只有图片");
    expect(cacheRead).not.toHaveBeenCalled();
    expect(page.files[0].originalUrl).not.toContain(root);
    const response = await service.respond(new Request(page.files[0].originalUrl));
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("two");
    expect(cacheRead).not.toHaveBeenCalled();
  });
  it("generates only the requested thumbnail with shared cache, cancellation, and source classification", async () => {
    await writeFile(path.join(root, "one.jpg"), "one");
    const page = await service.list({ sourceFolderId: "source", directoryPath: root });
    const request = new Request(page.files[0].thumbnailUrl);
    const response = await service.respond(request);
    expect(await response.text()).toBe("thumbnail");
    expect(cacheRead).toHaveBeenCalledOnce();
    expect(cacheRead.mock.calls[0][0]).toMatch(/covers[\\/]still-v1-.*\.jpg$/);
    expect(cacheRead.mock.calls[0][2]).toMatchObject({ signal: request.signal, sourceKey: "source", remote: false, priority: 0 });
  });
  it("paginates the same snapshot and releases sessions", async () => {
    await Promise.all(Array.from({ length: 125 }, (_, index) => writeFile(path.join(root, `${index}.jpg`), "x")));
    const first = await service.list({ sourceFolderId: "source", directoryPath: root });
    await writeFile(path.join(root, "new.jpg"), "x");
    const second = await service.list({ sourceFolderId: "source", directoryPath: root, sessionId: first.sessionId, offset: 120 });
    expect(first.files).toHaveLength(120);
    expect(second.totalCount).toBe(125);
    expect(second.files).toHaveLength(5);
    service.close(first.sessionId);
    await expect(service.respond(new Request(first.files[0].originalUrl))).rejects.toThrow("过期");
  });
  it("rejects arbitrary paths, traversal URLs and removed sources", async () => {
    await expect(service.list({ sourceFolderId: "source", directoryPath: path.dirname(root) })).rejects.toThrow("不在");
    await writeFile(path.join(root, "one.jpg"), "one");
    const page = await service.list({ sourceFolderId: "source", directoryPath: root });
    await expect(service.respond(new Request(`local-video://image/${page.sessionId}/../secret/original`))).rejects.toThrow("无效");
    folders = [];
    await expect(service.respond(new Request(page.files[0].originalUrl))).rejects.toThrow("移除");
  });
  it("blocks directory junctions escaping a managed source", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "movie-images-outside-"));
    try {
      await symlink(outside, path.join(root, "escape"), "junction");
      await expect(service.list({ sourceFolderId: "source", directoryPath: path.join(root, "escape") })).rejects.toThrow("之外");
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
  it("honors already-aborted original requests", async () => {
    await writeFile(path.join(root, "one.jpg"), "one");
    const page = await service.list({ sourceFolderId: "source", directoryPath: root });
    const controller = new AbortController(); controller.abort();
    await expect(service.respond(new Request(page.files[0].originalUrl, { signal: controller.signal }))).rejects.toThrow("取消");
    expect(cacheRead).not.toHaveBeenCalled();
  });
});

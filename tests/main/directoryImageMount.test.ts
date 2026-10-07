// @vitest-environment node
import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DirectoryImageService } from "../../src/main/media/directoryImageService";
import type { MediaCacheManager } from "../../src/main/media/cacheManager";
import type { SourceFolder } from "../../src/shared/videoTypes";

// Reproduce the mounted filesystem: native realpath fails while directory reads
// and the compatibility resolver work. Previously listing and image reads failed.
vi.mock("node:fs/promises", async (original) => ({
  ...await original<typeof import("node:fs/promises")>(),
  realpath: vi.fn().mockRejectedValue(Object.assign(new Error("UNKNOWN: realpath"), { code: "UNKNOWN" }))
}));

it("lists mounted children and reads images when native realpath is unsupported", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "movie-mount-images-"));
  try {
    const directory = path.join(root, "中文 空格 ⭐");
    await mkdir(directory);
    await mkdir(path.join(directory, "只有图片"));
    await writeFile(path.join(directory, "one.jpg"), "original");
    const service = new DirectoryImageService(() => [{ id: "mounted", path: root, providerType: "clouddrive" } as SourceFolder], {
      root, getOrCreateImage: vi.fn().mockResolvedValue(Buffer.from("thumbnail"))
    } as unknown as MediaCacheManager);
    const page = await service.list({ sourceFolderId: "mounted", directoryPath: directory });
    expect(page.directories).toEqual([{ name: "只有图片", path: path.join(directory, "只有图片") }]);
    expect(await (await service.respond(new Request(page.files[0].originalUrl))).text()).toBe("original");
    expect(await (await service.respond(new Request(page.files[0].thumbnailUrl))).text()).toBe("thumbnail");
  } finally { await rm(root, { recursive: true, force: true }); }
});

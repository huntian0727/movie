// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as fs from "node:fs/promises";
import { createDatabase } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { DataDirectoryManager, DataDirectoryUnavailableError } from "../../src/main/storage/dataDirectory";
vi.mock("node:fs/promises", { spy: true });
const actualFs = await vi.importActual<typeof fs>("node:fs/promises");

let root: string, source: string, parent: string;
const managers: DataDirectoryManager[] = [];
const manager = () => { const value = new DataDirectoryManager(source, path.join(root, "program")); managers.push(value); return value; };
async function put(relative: string, value: string) {
  const file = path.join(source, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value);
}
async function restart(value: DataDirectoryManager) {
  await value.dispose(); const next = manager(); await next.initialize(); return next;
}
beforeEach(async () => {
  vi.mocked(fs.statfs).mockImplementation(actualFs.statfs);
  vi.mocked(fs.copyFile).mockImplementation(actualFs.copyFile);
  root = await fs.realpath(await mkdtemp(path.join(os.tmpdir(), "movie-data-migration-")));
  source = path.join(root, "default-profile"); parent = path.join(root, "用户选择 空格");
  await mkdir(source); await mkdir(parent);
  const db = createDatabase(path.join(source, "library.sqlite"));
  const repo = new VideoRepository(db), folder = repo.addSourceFolder(path.join(root, "videos"), true);
  const video = repo.upsertVideo({ sourceFolderId: folder.id, path: path.join(folder.path, "movie.mp4"), directory: folder.path,
    filename: "movie.mp4", basename: "movie", extension: ".mp4", sizeBytes: 1200, durationMs: 5000,
    width: 640, height: 360, format: "mp4", modifiedAt: "2026-10-18T00:00:00.000Z" });
  repo.setFavorite(video.id, true);
  repo.markThumbnailReady(video.id, path.join(source, "media-cache", "covers", "cover.jpg"));
  repo.markTimelinePreviewReady(video.id, 1000, path.join(source, "media-cache", "timeline", "frame.jpg"));
  db.close();
  await put("settings.json", '{"startupSync":false}');
  await put("media-cache/covers/cover.jpg", "cover");
  await put("media-cache/timeline/frame.jpg", "frame");
  await put("subtitles/example/selection.json", '{"selectedId":"test"}');
  await put("subtitles/example/test.srt", "subtitle");
  await put("clouddrive-credentials.bin", "test-ciphertext");
  await put("subtitle-credentials.bin", "test-ciphertext-2");
  await put("logs/app.jsonl", "test-log");
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of managers.splice(0)) await item.dispose();
  // All test cleanup is confined to the mkdtemp fixture root.
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe("application data directory migration", () => {
  it("retains the existing default and excludes media, exports and Chromium cache", async () => {
    await put("original.mp4", "source-video"); await put("export.csv", "user-export"); await put("Cache/Cache_Data/runtime", "chromium");
    const first = manager(); await first.initialize();
    expect(first.getStatus().currentDirectory).toBe(source);
    const preview = await first.choose(parent); expect(preview.fileCount).toBe(10);
    expect(preview.targetDirectory).toContain("映匣数据-default-profile");
    await first.schedule(preview.token);
    // Scheduling does not copy a database while the current process is active.
    await expect(stat(preview.targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    const next = await restart(first); await next.prepareStartup();
    expect(next.getStatus().currentDirectory).toBe(preview.targetDirectory);
    await next.finishStartup();
    for (const name of ["original.mp4", "export.csv", "Cache/Cache_Data/runtime"]) {
      expect(await readFile(path.join(source, name), "utf8")).toBeTruthy();
      await expect(stat(path.join(preview.targetDirectory, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(stat(path.join(source, "library.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(path.join(source, "data-location.json"), "utf8")).current).toBe(preview.targetDirectory);
  });
  it("preserves favourites, source paths, subtitle selections and ciphertext, and rewrites asset references", async () => {
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first); await next.prepareStartup();
    const db = new Database(path.join(preview.targetDirectory, "library.sqlite"));
    try {
      const row = db.prepare("SELECT path, is_favorite, cover_cache_path FROM videos").get() as Record<string, unknown>;
      expect(row.path).toBe(path.join(root, "videos", "movie.mp4")); expect(row.is_favorite).toBe(1);
      expect(row.cover_cache_path).toBe(path.join(preview.targetDirectory, "media-cache", "covers", "cover.jpg"));
      expect((db.prepare("SELECT cache_path FROM timeline_previews").get() as { cache_path: string }).cache_path).toBe(path.join(preview.targetDirectory, "media-cache", "timeline", "frame.jpg"));
      expect(db.pragma("quick_check", { simple: true })).toBe("ok");
    } finally { db.close(); }
    for (const file of ["settings.json", "subtitles/example/selection.json", "subtitles/example/test.srt", "clouddrive-credentials.bin", "subtitle-credentials.bin"]) {
      expect(await readFile(path.join(preview.targetDirectory, file))).toEqual(await readFile(path.join(source, file)));
    }
    // Upgrade/restart finds the custom directory using the fixed locator.
    const again = await restart(next); await again.prepareStartup();
    expect(again.getStatus().currentDirectory).toBe(preview.targetDirectory);
  });
  it("rejects overlap, program directories, existing data and a stale preview token", async () => {
    const first = manager(); await first.initialize();
    await expect(first.choose(source)).rejects.toThrow(/嵌套/);
    const program = path.join(root, "program"); await mkdir(program);
    await expect(first.choose(program)).rejects.toThrow(/程序目录/);
    const preview = await first.choose(parent);
    await expect(first.schedule(randomUUID())).rejects.toThrow(/失效/);
    await mkdir(preview.targetDirectory); await writeFile(path.join(preview.targetDirectory, "keep.txt"), "keep");
    await expect(first.schedule(preview.token)).rejects.toThrow(/已经存在/);
    expect(await readFile(path.join(preview.targetDirectory, "keep.txt"), "utf8")).toBe("keep");
  });
  it("includes managed directories whose Windows casing was changed", async () => {
    await rename(path.join(source, "media-cache"), path.join(source, "MEDIA-CACHE"));
    const first = manager(); await first.initialize(); const preview = await first.choose(parent);
    expect(preview.fileCount).toBe(10); await first.schedule(preview.token);
    const next = await restart(first); await next.prepareStartup();
    expect(await readFile(path.join(preview.targetDirectory, "MEDIA-CACHE", "covers", "cover.jpg"), "utf8")).toBe("cover");
  });
  it("refuses source symlinks without copying outside files", async () => {
    const outside = path.join(root, "outside"); await mkdir(outside);
    await symlink(outside, path.join(source, "subtitles", "junction"), "junction");
    const first = manager(); await first.initialize();
    await expect(first.choose(parent)).rejects.toThrow(/链接/);
  });
  it("checks available space both at preview and at startup", async () => {
    const first = manager(); await first.initialize();
    const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first);
    vi.spyOn(fs, "statfs").mockResolvedValue({ bavail: 0, bsize: 4096 } as Awaited<ReturnType<typeof fs.statfs>>);
    await next.prepareStartup();
    expect(next.getStatus().currentDirectory).toBe(source);
    expect(next.getStatus().message).toContain("继续使用原数据");
    await expect(next.choose(parent)).rejects.toThrow(/空间不足/);
    expect((await stat(path.join(source, "library.sqlite"))).size).toBeGreaterThan(0);
  });
  it("preserves the source when copying fails or a target appears after preview", async () => {
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first);
    vi.spyOn(fs, "copyFile").mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
    await next.prepareStartup();
    expect(next.getStatus().currentDirectory).toBe(source);
    expect(await readFile(path.join(source, "settings.json"), "utf8")).toContain("startupSync");
    expect(JSON.parse(await readFile(path.join(source, "data-location.json"), "utf8")).pending).toBeUndefined();
  });
  it("rejects corrupted database copies without changing the locator", async () => {
    await writeFile(path.join(source, "library.sqlite"), "broken database");
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first); await next.prepareStartup();
    expect(next.getStatus().currentDirectory).toBe(source);
    expect(await readFile(path.join(source, "library.sqlite"), "utf8")).toBe("broken database");
  });
  it("rejects byte corruption and preserves the source", async () => {
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first);
    const originalCopy = actualFs.copyFile;
    vi.spyOn(fs, "copyFile").mockImplementation(async (from, to, flags) => {
      await originalCopy(from, to, flags);
      if (String(to).endsWith("settings.json")) writeFileSync(to, "corrupt");
    });
    await next.prepareStartup();
    expect(next.getStatus().currentDirectory).toBe(source);
    expect(await readFile(path.join(source, "settings.json"), "utf8")).toContain("startupSync");
  });
  it("resumes pending migration after interruption while retaining an incomplete stage", async () => {
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const state = JSON.parse(await readFile(path.join(source, "data-location.json"), "utf8"));
    const stage = path.join(parent, `.movie-migration-${state.pending.id}`);
    await mkdir(stage); await writeFile(path.join(stage, "partial"), "incomplete");
    const next = await restart(first); await next.prepareStartup();
    expect(next.getStatus().currentDirectory).toBe(preview.targetDirectory);
    expect(await readFile(path.join(stage, "partial"), "utf8")).toBe("incomplete");
  });
  it("recovers a verified published directory when the pointer switch was interrupted", async () => {
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const pending = await readFile(path.join(source, "data-location.json"), "utf8");
    const next = await restart(first); await next.prepareStartup(); await next.dispose();
    // Simulate crash between directory publication and locator commit.
    await writeFile(path.join(source, "data-location.json"), pending);
    const recovered = manager(); await recovered.initialize(); await recovered.prepareStartup();
    expect(recovered.getStatus().currentDirectory).toBe(preview.targetDirectory);
  });
  it("never removes changed originals or unrelated files", async () => {
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first); await next.prepareStartup();
    await put("settings.json", "changed by another program");
    await next.finishStartup();
    expect(await readFile(path.join(source, "settings.json"), "utf8")).toBe("changed by another program");
    expect((await stat(path.join(source, "library.sqlite"))).isFile()).toBe(true);
    expect(next.getStatus().message).toContain("保留原数据");
  });
  it("preserves every original when new managed files appear during cleanup", async () => {
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first); await next.prepareStartup();
    await put("logs/new.jsonl", "a later run");
    await next.finishStartup();
    expect(await readFile(path.join(source, "logs/new.jsonl"), "utf8")).toBe("a later run");
    expect((await stat(path.join(source, "library.sqlite"))).isFile()).toBe(true);
  });
  it("does not adopt another release identity during recovery", async () => {
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first); await next.prepareStartup(); await next.dispose();
    const other = new DataDirectoryManager(path.join(root, "other-profile")); managers.push(other); await other.initialize();
    await expect(other.recoverExistingDirectory(preview.targetDirectory)).rejects.toThrow(/其他发行身份/);
  });
  it("updates legacy media references without touching Chromium cache", async () => {
    await put("cache/covers/legacy.jpg", "legacy"); await put("cache/Cache_Data/keep", "chromium");
    const db = new Database(path.join(source, "library.sqlite"));
    db.prepare("UPDATE videos SET cover_cache_path = ?").run(path.join(source, "cache", "covers", "legacy.jpg")); db.close();
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first); await next.prepareStartup();
    const copied = new Database(path.join(preview.targetDirectory, "library.sqlite"));
    expect((copied.prepare("SELECT cover_cache_path FROM videos").get() as { cover_cache_path: string }).cover_cache_path).toBe(path.join(preview.targetDirectory, "media-cache", "covers", "legacy.jpg")); copied.close();
    await next.finishStartup(); expect(await readFile(path.join(source, "cache", "Cache_Data", "keep"), "utf8")).toBe("chromium");
  });
  it("can move from one custom directory to another", async () => {
    const first = manager(); await first.initialize(); const a = await first.choose(parent); await first.schedule(a.token);
    const next = await restart(first); await next.prepareStartup(); await next.finishStartup();
    const other = path.join(root, "other"); await mkdir(other);
    const b = await next.choose(other); await next.schedule(b.token);
    const last = await restart(next); await last.prepareStartup(); await last.finishStartup();
    expect(last.getStatus().currentDirectory).toBe(b.targetDirectory);
    await expect(stat(path.join(a.targetDirectory, "library.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not silently create an empty library when a custom disk disappears", async () => {
    const first = manager(); await first.initialize(); const preview = await first.choose(parent); await first.schedule(preview.token);
    const next = await restart(first); await next.prepareStartup(); await next.dispose();
    const moved = `${preview.targetDirectory}-moved`; await rename(preview.targetDirectory, moved);
    const unavailable = manager(); await expect(unavailable.initialize()).rejects.toBeInstanceOf(DataDirectoryUnavailableError);
    await expect(stat(preview.targetDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await unavailable.recoverExistingDirectory(moved);
    expect(unavailable.getStatus().currentDirectory).toBe(moved);
  });
  it("stops on invalid locator JSON and excludes a second writer", async () => {
    const first = manager(); await first.initialize();
    await expect(manager().initialize()).rejects.toThrow(/另一个程序/);
    await first.dispose(); await writeFile(path.join(source, "data-location.json"), "{");
    await expect(manager().initialize()).rejects.toThrow(/定位记录/);
    expect((await readdir(source))).toContain("library.sqlite");
  });
});

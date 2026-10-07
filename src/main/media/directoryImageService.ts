import { randomUUID } from "node:crypto";
import { createReadStream, realpath as resolveRealPath } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { IMAGE_EXTENSIONS, IMAGE_PAGE_SIZE, type DirectoryImagePage, type DirectoryImageQuery } from "../../shared/imageViewing.js";
import type { SourceFolder } from "../../shared/videoTypes.js";
import { isManagedPathWithin } from "../files/pathNormalization.js";
import { buildCacheKey, generateStillThumbnail } from "./cacheService.js";
import type { MediaCacheManager } from "./cacheManager.js";

interface ImageSession {
  sourceFolderId: string;
  directory: string;
  sourcePath: string;
  names: string[];
  directories: DirectoryImagePage["directories"];
  directoriesTruncated: boolean;
  truncated: boolean;
  touchedAt: number;
}
const SESSION_TTL_MS = 30 * 60_000;
// fs/promises.realpath uses the native resolver, which returns UNKNOWN on some
// Windows virtual mounts. The asynchronous compatibility resolver still follows
// junctions/symlinks, preserving the managed-source boundary without blocking UI.
const realpath = promisify(resolveRealPath);
const MAX_IMAGES = 20_000;
const MAX_ORIGINAL_BYTES = 256 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".bmp": "image/bmp", ".avif": "image/avif"
};

/** Ephemeral names only. Nothing is inserted into the video library or metadata queue. */
export class DirectoryImageService {
  private readonly sessions = new Map<string, ImageSession>();
  constructor(private readonly folders: () => SourceFolder[], private readonly cache: MediaCacheManager) {}

  async list(query: DirectoryImageQuery): Promise<DirectoryImagePage> {
    this.prune();
    const folder = this.requireFolder(query.sourceFolderId);
    if (!isManagedPathWithin(query.directoryPath, folder.path)) throw new Error("图片目录不在此资料库中");
    let id = query.sessionId;
    let session = id ? this.sessions.get(id) : undefined;
    if (id && (!session || session.sourceFolderId !== folder.id || !samePath(session.directory, query.directoryPath))) {
      throw new Error("图片目录已过期，请刷新目录");
    }
    if (!session) {
      const directory = await this.checkedDirectory(query.directoryPath, folder.path);
      const names: string[] = [];
      const directories: DirectoryImagePage["directories"] = [];
      let truncated = false;
      let directoriesTruncated = false;
      let inspected = 0;
      const startedAt = Date.now();
      const entries = await opendir(directory, { bufferSize: 128 });
      for await (const entry of entries) {
        if (++inspected > 100_000 || Date.now() - startedAt > 30_000) { truncated = true; break; }
        if (entry.isDirectory()) {
          if (directories.length < 200) directories.push({ name: entry.name, path: path.join(query.directoryPath, entry.name) });
          else directoriesTruncated = true;
        }
        if (!entry.isFile() || !IMAGE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase() as typeof IMAGE_EXTENSIONS[number])) continue;
        names.push(entry.name);
        if (names.length >= MAX_IMAGES) { truncated = true; break; }
      }
      names.sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
      directories.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
      id = randomUUID();
      session = { sourceFolderId: folder.id, sourcePath: folder.path, directory: query.directoryPath, names, directories, directoriesTruncated, truncated, touchedAt: Date.now() };
      // A bounded number of name lists; browsing never builds a persistent image index.
      this.prune();
      while (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value!);
      this.sessions.set(id, session);
    }
    session.touchedAt = Date.now();
    const offset = query.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) throw new Error("图片页码无效");
    return {
      sessionId: id!, offset, totalCount: session.names.length, truncated: session.truncated, directories: session.directories, directoriesTruncated: session.directoriesTruncated,
      files: session.names.slice(offset, offset + IMAGE_PAGE_SIZE).map((name, index) => ({
        name, thumbnailUrl: `local-video://image/${id}/${offset + index}/thumbnail`, originalUrl: `local-video://image/${id}/${offset + index}/original`
      }))
    };
  }

  close(id: string): void { this.sessions.delete(id); }

  async respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/([a-f0-9-]{36})\/(\d+)\/(thumbnail|original)$/.exec(url.pathname);
    if (url.protocol !== "local-video:" || url.hostname !== "image" || !match) throw new Error("图片地址无效");
    this.prune();
    const [, id, indexText, mode] = match;
    const session = this.sessions.get(id);
    const name = session?.names[Number(indexText)];
    if (!session || !name) throw new Error("图片目录已过期，请刷新目录");
    const folder = this.requireFolder(session.sourceFolderId);
    if (!samePath(folder.path, session.sourcePath)) throw new Error("图片来源已更改");
    session.touchedAt = Date.now();
    const directory = await this.checkedDirectory(session.directory, folder.path);
    const filePath = await realpath(path.join(directory, name));
    if (!samePath(path.dirname(filePath), directory)) throw new Error("图片文件不在当前目录中");
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0 || info.size > MAX_ORIGINAL_BYTES) throw new Error("图片无法读取或超过 256 MB");
    if (request.signal.aborted) throw new Error("图片读取已取消");
    if (mode === "thumbnail") {
      const key = buildCacheKey(filePath, info.size, info.mtime.toISOString());
      const output = path.join(this.cache.root, "covers", `still-v1-${key}.jpg`);
      const body = await this.cache.getOrCreateImage(output,
        (temporary, signal) => generateStillThumbnail(filePath, temporary, { signal }),
        { signal: request.signal, sourceKey: folder.id, remote: folder.providerType === "clouddrive" || filePath.startsWith("\\\\"), priority: 0 });
      return new Response(new Uint8Array(body), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
    }
    return new Response(Readable.toWeb(createReadStream(filePath, { signal: request.signal })) as BodyInit, {
      headers: { "Content-Type": CONTENT_TYPES[path.extname(name).toLowerCase()], "Content-Length": String(info.size), "Cache-Control": "no-store" }
    });
  }

  private requireFolder(id: string): SourceFolder {
    const folder = this.folders().find((entry) => entry.id === id);
    if (!folder) throw new Error("图片资料库来源已移除");
    return folder;
  }
  private async checkedDirectory(directory: string, source: string): Promise<string> {
    const [resolved, root] = await Promise.all([realpath(directory), realpath(source)]);
    if (!isManagedPathWithin(resolved, root)) throw new Error("图片目录指向资料库之外");
    return resolved;
  }
  private prune(): void {
    for (const [id, session] of this.sessions) if (Date.now() - session.touchedAt > SESSION_TTL_MS) this.sessions.delete(id);
  }
}
function samePath(a: string, b: string): boolean {
  return isManagedPathWithin(a, b) && isManagedPathWithin(b, a);
}

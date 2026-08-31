import { protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { VideoRepository } from "../db/videoRepository.js";
import { buildCacheKey, generateCover, generateTimelineFrame, getCoverPath, getCoverTimeSeconds, getTimelineFramePath } from "./cacheService.js";
import { CacheGenerationSupersededError, ImageCacheMissError, type MediaCacheManager } from "./cacheManager.js";
import { ImageRequestCancelledError, type ImageRequestOptions } from "./imageGenerationQueue.js";
import { getTimelinePreviewFromUrl, getVideoIdFromCoverUrl, getVideoIdFromMediaUrl, MEDIA_SCHEME } from "./mediaUrl.js";

export { MEDIA_SCHEME } from "./mediaUrl.js";

export async function loadPreviewImage(
  repo: VideoRepository, cacheManager: MediaCacheManager, url: string,
  coverTimeSeconds: number, options: ImageRequestOptions = {}
): Promise<Uint8Array | null> {
  const parsed = new URL(url);
  const preview = parsed.hostname === "preview" ? getTimelinePreviewFromUrl(url) : null;
  const videoId = preview?.videoId ?? getVideoIdFromCoverUrl(url);
  const video = repo.getVideo(videoId);
  const cacheKey = buildCacheKey(video.path, video.sizeBytes, video.modifiedAt);
  const readOptions = { ...options, cachedOnly: options.cachedOnly || video.isMissing };
  try {
    if (preview) {
      const framePath = getTimelineFramePath(cacheManager.root, cacheKey, preview.timeMs);
      return await ensureTimelineFrame(cacheManager, repo, video.id, video.path, framePath, preview.timeMs, readOptions);
    }
    const time = getCoverTimeSeconds(coverTimeSeconds, video.durationMs);
    return await ensureCover(cacheManager, repo, video.id, video.path, getCoverPath(cacheManager.root, cacheKey, time), time, readOptions);
  } catch (error) {
    if (error instanceof ImageCacheMissError || error instanceof ImageRequestCancelledError || options.signal?.aborted) return null;
    throw error;
  }
}

const imageResponseHeaders = {
  "Cache-Control": "no-store"
};

export function registerMediaProtocol(
  repo: VideoRepository,
  cacheManager: MediaCacheManager,
  getCoverFrameTimeSeconds: () => number = () => 5
): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const parsed = new URL(request.url);

      if (parsed.hostname === "media") {
        const videoId = getVideoIdFromMediaUrl(request.url);
        const video = repo.getVideo(videoId);
        return createVideoResponse(video.path, getRequestHeader(request, "range"));
      }

      if (parsed.hostname === "preview" || parsed.hostname === "cover") {
        const body = await loadPreviewImage(repo, cacheManager, request.url, getCoverFrameTimeSeconds(), {
          signal: request.signal, priority: parsed.hostname === "preview" ? 2 : 1,
          cachedOnly: parsed.searchParams.get("cachedOnly") === "1"
        });
        return body ? createImageResponse(body) : new Response(null, { status: 404 });
      }

      throw new Error("Invalid media URL");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return new Response(message, { status: 404 });
    }
  });
}

async function ensureTimelineFrame(
  cacheManager: MediaCacheManager,
  repo: VideoRepository,
  videoId: string,
  inputPath: string,
  outputPath: string,
  timeMs: number,
  options: ImageRequestOptions = {}
): Promise<Buffer> {
  try {
    const body = await cacheManager.getOrCreateImage(
      outputPath,
      (temporaryPath, signal) => generateTimelineFrame(inputPath, temporaryPath, timeMs, { signal }), options
    );
    repo.markTimelinePreviewReady(videoId, timeMs, outputPath);
    return body;
  } catch (error) {
    if (!isIgnoredImageError(error, options)) repo.markTimelinePreviewFailed(videoId);
    throw error;
  }
}

async function ensureCover(
  cacheManager: MediaCacheManager,
  repo: VideoRepository,
  videoId: string,
  inputPath: string,
  outputPath: string,
  timeSeconds: number,
  options: ImageRequestOptions = {}
): Promise<Buffer> {
  try {
    const body = await cacheManager.getOrCreateImage(
      outputPath,
      (temporaryPath, signal) => generateCover(inputPath, temporaryPath, timeSeconds, { signal }), options
    );
    repo.markThumbnailReady(videoId, outputPath);
    return body;
  } catch (error) {
    if (!isIgnoredImageError(error, options)) repo.markThumbnailFailed(videoId);
    throw error;
  }
}

function isIgnoredImageError(error: unknown, options: ImageRequestOptions): boolean {
  return Boolean(options.signal?.aborted) || error instanceof CacheGenerationSupersededError || error instanceof ImageRequestCancelledError || error instanceof ImageCacheMissError;
}

function createImageResponse(body: Uint8Array): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      ...imageResponseHeaders,
      "Content-Type": "image/jpeg",
      "Content-Length": String(body.byteLength)
    }
  });
}

async function createVideoResponse(filePath: string, rangeHeader: string | null): Promise<Response> {
  const fileStat = await stat(filePath);
  const contentType = getMediaContentType(filePath);
  const byteRange = parseRangeHeader(rangeHeader, fileStat.size);

  if (byteRange === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${fileStat.size}`
      }
    });
  }

  if (!byteRange) {
    return new Response(Readable.toWeb(createReadStream(filePath)) as BodyInit, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(fileStat.size),
        "Content-Type": contentType
      }
    });
  }

  const { start, end } = byteRange;
  return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as BodyInit, {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      "Content-Type": contentType
    }
  });
}

function getRequestHeader(request: Request, name: string): string | null {
  return request.headers.get(name);
}

export function parseRangeHeader(
  rangeHeader: string | null,
  fileSize: number
): { start: number; end: number } | "invalid" | null {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return "invalid";
  }

  const [, startText, endText] = match;

  if (startText === "" && endText === "") {
    return "invalid";
  }

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }

    const start = Math.max(0, fileSize - suffixLength);
    const end = Math.max(0, fileSize - 1);
    return start <= end ? { start, end } : "invalid";
  }

  const start = Number(startText);
  const end = endText === "" ? fileSize - 1 : Number(endText);

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return "invalid";
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

export function getMediaContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".mp4" || extension === ".m4v") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".mkv") return "video/x-matroska";
  if (extension === ".avi") return "video/x-msvideo";
  if (extension === ".wmv") return "video/x-ms-wmv";
  if (extension === ".flv") return "video/x-flv";
  if (extension === ".ts") return "video/mp2t";

  return "application/octet-stream";
}

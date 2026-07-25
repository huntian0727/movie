import { protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { VideoRepository } from "../db/videoRepository.js";
import { buildCacheKey, generateCover, generateTimelineFrame, getCoverPath, getCoverTimeSeconds, getTimelineFramePath } from "./cacheService.js";
import { CacheGenerationSupersededError, type MediaCacheManager } from "./cacheManager.js";
import { getTimelinePreviewFromUrl, getVideoIdFromCoverUrl, getVideoIdFromMediaUrl, MEDIA_SCHEME } from "./mediaUrl.js";

export { MEDIA_SCHEME } from "./mediaUrl.js";

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

      if (parsed.hostname === "preview") {
        const { videoId, timeMs } = getTimelinePreviewFromUrl(request.url);
        const video = repo.getVideo(videoId);
        const cacheKey = buildCacheKey(video.path, video.sizeBytes, video.modifiedAt);
        const framePath = getTimelineFramePath(cacheManager.root, cacheKey, timeMs);
        const body = await ensureTimelineFrame(cacheManager, repo, video.id, video.path, framePath, timeMs);
        return createImageResponse(body);
      }

      if (parsed.hostname === "cover") {
        const videoId = getVideoIdFromCoverUrl(request.url);
        const video = repo.getVideo(videoId);
        const cacheKey = buildCacheKey(video.path, video.sizeBytes, video.modifiedAt);
        const timeSeconds = getCoverTimeSeconds(getCoverFrameTimeSeconds(), video.durationMs);
        const coverPath = getCoverPath(cacheManager.root, cacheKey, timeSeconds);
        const body = await ensureCover(cacheManager, repo, video.id, video.path, coverPath, timeSeconds);
        return createImageResponse(body);
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
  timeMs: number
): Promise<Buffer> {
  try {
    const body = await cacheManager.getOrCreateImage(
      outputPath,
      (temporaryPath) => generateTimelineFrame(inputPath, temporaryPath, timeMs)
    );
    repo.markTimelinePreviewReady(videoId, timeMs, outputPath);
    return body;
  } catch (error) {
    if (!(error instanceof CacheGenerationSupersededError)) repo.markTimelinePreviewFailed(videoId);
    throw error;
  }
}

async function ensureCover(
  cacheManager: MediaCacheManager,
  repo: VideoRepository,
  videoId: string,
  inputPath: string,
  outputPath: string,
  timeSeconds: number
): Promise<Buffer> {
  try {
    const body = await cacheManager.getOrCreateImage(
      outputPath,
      (temporaryPath) => generateCover(inputPath, temporaryPath, timeSeconds)
    );
    repo.markThumbnailReady(videoId, outputPath);
    return body;
  } catch (error) {
    if (error instanceof CacheGenerationSupersededError) repo.markThumbnailPending(videoId);
    else repo.markThumbnailFailed(videoId);
    throw error;
  }
}

function createImageResponse(body: Buffer): Response {
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

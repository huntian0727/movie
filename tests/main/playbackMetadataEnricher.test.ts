// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { PlaybackMetadataEnricher } from "../../src/main/media/playbackMetadataEnricher";

let database: DatabaseConnection | undefined;
let tempDirectory: string | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe("PlaybackMetadataEnricher", () => {
  it("probes a historical ready video once, persists codec fields, and skips the second open", async () => {
    const { repo, videoId } = fixture();
    const reader = vi.fn(async () => ({
      durationMs: 1000,
      width: 1920,
      height: 1080,
      format: "mp4",
      videoCodec: "h264",
      videoProfile: "high",
      pixelFormat: "yuv420p",
      audioCodec: "aac"
    }));
    const enricher = new PlaybackMetadataEnricher(repo, reader);

    await enricher.ensureCodecMetadata(videoId);
    await enricher.ensureCodecMetadata(videoId);

    expect(reader).toHaveBeenCalledTimes(1);
    expect(repo.getVideo(videoId)).toMatchObject({
      videoCodec: "h264",
      videoProfile: "high",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      metadataStatus: "ready"
    });
  });

  it("deduplicates concurrent first-open probes", async () => {
    const { repo, videoId } = fixture();
    const reader = vi.fn(async () => ({ durationMs: 1000, width: 1, height: 1, format: "mp4", videoCodec: "hevc" }));
    const enricher = new PlaybackMetadataEnricher(repo, reader);
    await Promise.all([enricher.ensureCodecMetadata(videoId), enricher.ensureCodecMetadata(videoId)]);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("does not block player preparation when probing fails", async () => {
    const { repo, videoId } = fixture();
    const warn = vi.fn();
    const enricher = new PlaybackMetadataEnricher(
      repo,
      async () => { throw new Error("offline"); },
      { warn } as never
    );

    await expect(enricher.ensureCodecMetadata(videoId)).resolves.toBeUndefined();
    expect(repo.getVideo(videoId).videoCodec).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "codec_metadata_enrichment_failed" }));
  });
});

function fixture(): { repo: VideoRepository; videoId: string } {
  tempDirectory = mkdtempSync(path.join(os.tmpdir(), "playback-codec-"));
  database = createDatabase(path.join(tempDirectory, "library.sqlite"));
  const repo = new VideoRepository(database);
  const folder = repo.addSourceFolder("D:\\Movies", true);
  const video = repo.upsertVideo({
    sourceFolderId: folder.id,
    path: "D:\\Movies\\legacy.mp4",
    directory: "D:\\Movies",
    filename: "legacy.mp4",
    basename: "legacy",
    extension: ".mp4",
    sizeBytes: 100,
    durationMs: 1000,
    width: 1920,
    height: 1080,
    format: "mp4",
    modifiedAt: "2026-08-01T00:00:00.000Z",
    metadataStatus: "ready"
  });
  return { repo, videoId: video.id };
}

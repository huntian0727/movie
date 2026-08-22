import type { VideoRepository } from "../db/videoRepository.js";
import type { StructuredLogger } from "../logging/logger.js";
import { readMetadata, type MediaMetadata, type ProbeProfile } from "./metadataService.js";

type MetadataReader = (filePath: string, profile: ProbeProfile) => Promise<MediaMetadata>;
type PathProbeProfileResolver = (filePath: string) => ProbeProfile;
type AfterProbeHook = (filePath: string) => void | Promise<void>;

export class PlaybackMetadataEnricher {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: VideoRepository,
    metadataReader: ((filePath: string) => Promise<MediaMetadata>) | MetadataReader = readMetadata,
    private readonly logger?: StructuredLogger,
    private readonly resolveProbeProfile?: PathProbeProfileResolver,
    private readonly afterProbe?: AfterProbeHook
  ) {
    this.metadataReader = adaptMetadataReader(metadataReader);
  }

  private readonly metadataReader: MetadataReader;

  async ensureCodecMetadata(videoId: string): Promise<void> {
    const current = this.inFlight.get(videoId);
    if (current) return current;
    const task = this.enrich(videoId).finally(() => this.inFlight.delete(videoId));
    this.inFlight.set(videoId, task);
    return task;
  }

  private async enrich(videoId: string): Promise<void> {
    const video = this.repo.getVideo(videoId);
    if (video.isMissing) return;
    // For cloud videos with deferred metadata, run a full probe (duration + codec info).
    // For local videos, only probe codec info if metadata is already ready but codec is unprobed.
    const needsFullProbe = video.metadataStatus === "deferred";
    if (!needsFullProbe && (video.metadataStatus !== "ready" || video.codecProbeStatus !== "unprobed")) return;
    const startedAt = Date.now();
    const profile = this.resolveProbeProfile?.(video.path) ?? "local";
    this.logger?.info({
      module: "media.playback",
      event: needsFullProbe ? "full_metadata_probe_started" : "codec_probe_started",
      message: needsFullProbe ? "Lazy full metadata probing started" : "Lazy codec probing started",
      context: { videoId: video.id, extension: video.extension, metadataStatus: video.metadataStatus, codecProbeStatus: video.codecProbeStatus, probeProfile: profile }
    });
    try {
      const metadata = await this.metadataReader(video.path, profile);
      let updated = false;
      if (needsFullProbe) {
        // Full probe: update duration, dimensions, format, AND codec info; mark both statuses ready.
        updated = this.repo.markMetadataReady(video.id, video.path, video.sizeBytes, video.modifiedAt, {
          durationMs: metadata.durationMs,
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
          videoCodec: metadata.videoCodec ?? null,
          videoProfile: metadata.videoProfile ?? null,
          pixelFormat: metadata.pixelFormat ?? null,
          audioCodec: metadata.audioCodec ?? null
        });
      } else {
        // Codec-only probe: update codec fields and mark codec ready.
        updated = this.repo.updateCodecMetadataIfVersion(video.id, video.path, video.sizeBytes, video.modifiedAt, {
          videoCodec: metadata.videoCodec ?? null,
          videoProfile: metadata.videoProfile ?? null,
          pixelFormat: metadata.pixelFormat ?? null,
          audioCodec: metadata.audioCodec ?? null
        });
      }
      if (updated) {
        this.logger?.info({
          module: "media.playback",
          event: needsFullProbe ? "full_metadata_probe_completed" : "codec_probe_completed",
          message: needsFullProbe ? "Lazy full metadata probing completed" : "Lazy codec probing completed",
          durationMs: Date.now() - startedAt,
          context: { videoId: video.id, extension: video.extension, codecProbeStatus: "ready" }
        });
      }
    } catch {
      if (needsFullProbe) {
        this.repo.markMetadataFailed(video.id, video.path, video.sizeBytes, video.modifiedAt);
      } else {
        this.repo.markCodecProbeFailedIfVersion(video.id, video.path, video.sizeBytes, video.modifiedAt);
      }
      this.logger?.warn({
        module: "media.playback",
        event: needsFullProbe ? "full_metadata_probe_failed" : "codec_probe_failed",
        message: needsFullProbe ? "Full metadata could not be enriched; playback will proceed without duration" : "Codec metadata could not be enriched; conservative playback routing will be used",
        durationMs: Date.now() - startedAt,
        context: { videoId: video.id, extension: video.extension, codecProbeStatus: "failed" }
      });
    } finally {
      if (this.afterProbe) {
        try {
          await this.afterProbe(video.path);
        } catch {
          // advisory hook; ignore errors
        }
      }
    }
  }
}

function adaptMetadataReader(
  reader: ((filePath: string) => Promise<MediaMetadata>) | MetadataReader
): MetadataReader {
  if (reader.length >= 2) return reader as MetadataReader;
  return async (filePath: string) => (reader as (path: string) => Promise<MediaMetadata>)(filePath);
}

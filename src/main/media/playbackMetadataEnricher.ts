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
    if (video.isMissing || video.metadataStatus !== "ready" || video.codecProbeStatus !== "unprobed") return;
    const startedAt = Date.now();
    const profile = this.resolveProbeProfile?.(video.path) ?? "local";
    this.logger?.info({
      module: "media.playback",
      event: "codec_probe_started",
      message: "Lazy codec probing started",
      context: { videoId: video.id, extension: video.extension, codecProbeStatus: video.codecProbeStatus, probeProfile: profile }
    });
    try {
      const metadata = await this.metadataReader(video.path, profile);
      const updated = this.repo.updateCodecMetadataIfVersion(video.id, video.path, video.sizeBytes, video.modifiedAt, {
        videoCodec: metadata.videoCodec ?? null,
        videoProfile: metadata.videoProfile ?? null,
        pixelFormat: metadata.pixelFormat ?? null,
        audioCodec: metadata.audioCodec ?? null
      });
      if (updated) {
        this.logger?.info({
          module: "media.playback",
          event: "codec_probe_completed",
          message: "Lazy codec probing completed",
          durationMs: Date.now() - startedAt,
          context: { videoId: video.id, extension: video.extension, codecProbeStatus: "ready" }
        });
      }
    } catch {
      this.repo.markCodecProbeFailedIfVersion(video.id, video.path, video.sizeBytes, video.modifiedAt);
      this.logger?.warn({
        module: "media.playback",
        event: "codec_probe_failed",
        message: "Codec metadata could not be enriched; conservative playback routing will be used",
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

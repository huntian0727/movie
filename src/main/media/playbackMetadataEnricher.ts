import type { VideoRepository } from "../db/videoRepository.js";
import type { StructuredLogger } from "../logging/logger.js";
import { readMetadata, type MediaMetadata } from "./metadataService.js";

type MetadataReader = (filePath: string) => Promise<MediaMetadata>;

export class PlaybackMetadataEnricher {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: VideoRepository,
    private readonly metadataReader: MetadataReader = readMetadata,
    private readonly logger?: StructuredLogger
  ) {}

  async ensureCodecMetadata(videoId: string): Promise<void> {
    const current = this.inFlight.get(videoId);
    if (current) return current;
    const task = this.enrich(videoId).finally(() => this.inFlight.delete(videoId));
    this.inFlight.set(videoId, task);
    return task;
  }

  private async enrich(videoId: string): Promise<void> {
    const video = this.repo.getVideo(videoId);
    if (video.isMissing || video.metadataStatus !== "ready" || video.videoCodec !== null) return;
    try {
      const metadata = await this.metadataReader(video.path);
      this.repo.updateCodecMetadataIfVersion(video.id, video.path, video.sizeBytes, video.modifiedAt, {
        videoCodec: metadata.videoCodec ?? null,
        videoProfile: metadata.videoProfile ?? null,
        pixelFormat: metadata.pixelFormat ?? null,
        audioCodec: metadata.audioCodec ?? null
      });
    } catch {
      this.logger?.warn({
        module: "media.playback",
        event: "codec_metadata_enrichment_failed",
        message: "Codec metadata could not be enriched; conservative playback routing will be used",
        context: { videoId: video.id, extension: video.extension }
      });
    }
  }
}

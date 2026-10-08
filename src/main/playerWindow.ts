import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { VideoRepository } from "./db/videoRepository.js";
import type { StructuredLogger } from "./logging/logger.js";
import { configureWindowSecurity } from "./security.js";
import { RENDERER_ENTRY_URL } from "./rendererProtocol.js";
import { PlayerTimelinePreview } from "./playerTimelinePreview.js";
import { playerTimelinePreviewSchema } from "../shared/playerTimelinePreview.js";
import {
  IPC_CHANNELS,
  MAX_PLAYER_QUEUE_ITEMS,
  type DomainEvent,
  type DomainEventInput,
  type PlayerSessionSnapshot,
  type WindowSyncSnapshot
} from "../shared/videoTypes.js";

interface PlayerWindowOptions {
  currentDir: string;
  devServerUrl: string;
  isPackaged: boolean;
  skipCodecProbe?: () => boolean;
  onPlaybackStartup?: (videoId: string) => void;
  onPlaybackClosed?: () => void;
}

type CodecMetadataEnsurer = (videoId: string) => Promise<void>;

export const PLAYBACK_CODEC_PROBE_WAIT_MS = 2_000;

export interface OpenPlayerWindowInput {
  videoId: string;
  queueIds: string[];
  startPositionMs?: number;
}

interface PlayerSessionState {
  selectedVideoId: string;
  queueIds: string[];
  startPositionMs?: number;
  startRequestId?: string;
}

export class DomainEventBus {
  private sequence = 0;

  getSequence(): number {
    return this.sequence;
  }

  publish(input: DomainEventInput): DomainEvent {
    const event = { ...input, videoIds: [...new Set(input.videoIds)], sequence: ++this.sequence } as DomainEvent;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.domainEvent, event);
    }
    return event;
  }
}

export class PlayerWindowCoordinator {
  private window: BrowserWindow | null = null;
  private session: PlayerSessionState | null = null;
  private opening: Promise<void> = Promise.resolve();
  private timelinePreview: PlayerTimelinePreview | null = null;

  constructor(
    private readonly repo: VideoRepository,
    private readonly options: PlayerWindowOptions,
    private readonly ensureCodecMetadata: CodecMetadataEnsurer = async () => undefined,
    private readonly logger?: StructuredLogger
  ) {}

  async open(input: OpenPlayerWindowInput, sequence: number): Promise<PlayerSessionSnapshot> {
    const startedAt = Date.now();
    const snapshot = await this.setSession(input, sequence);
    this.opening = this.opening.catch(() => undefined).then(async () => {
      try {
        if (!this.window || this.window.isDestroyed()) {
          this.window = createPlayerWindow(this.options);
          const createdWindow = this.window;
          createdWindow.once("closed", () => {
            if (this.window === createdWindow) {
              this.timelinePreview?.close(); this.timelinePreview = null;
              this.window = null;
              this.options.onPlaybackClosed?.();
            }
          });
          await loadPlayerEntry(createdWindow, this.options);
        }
        this.window.show();
        this.window.focus();
      } catch (error) {
        this.close();
        throw error;
      }
    });
    await this.opening;
    this.logger?.info({ module: "media.playback", event: "player_window_opened", durationMs: Date.now() - startedAt });
    return snapshot;
  }

  async setSession(input: OpenPlayerWindowInput, sequence: number): Promise<PlayerSessionSnapshot> {
    this.timelinePreview?.hide();
    const position = input.startPositionMs ?? this.resumePosition(input.videoId);
    this.session = normalizePlayerSession(this.repo, { ...input, startPositionMs: position });
    if (this.session.startPositionMs !== undefined) this.session.startRequestId = randomUUID();
    const skipCodecProbe = this.options.skipCodecProbe?.() ?? false;
    if (skipCodecProbe) this.options.onPlaybackStartup?.(this.session.selectedVideoId);
    // libmpv already inspects the media. Do not duplicate that read before playback.
    if (!skipCodecProbe && await waitForCodecMetadata(this.ensureCodecMetadata, this.session.selectedVideoId)) {
      this.logCodecProbeWaitTimeout(this.session.selectedVideoId);
    }
    return this.getSnapshot(sequence).playerSession!;
  }

  async select(videoId: string, sequence: number): Promise<PlayerSessionSnapshot> {
    this.timelinePreview?.hide();
    const snapshot = this.getSnapshot(sequence).playerSession;
    if (!snapshot || !snapshot.queueIds.includes(videoId)) {
      throw new Error("Selected video is not available in the current player queue");
    }
    this.session = { selectedVideoId: videoId, queueIds: snapshot.queueIds, startPositionMs: this.resumePosition(videoId), startRequestId: randomUUID() };
    const skipCodecProbe = this.options.skipCodecProbe?.() ?? false;
    if (skipCodecProbe) this.options.onPlaybackStartup?.(videoId);
    if (!skipCodecProbe && await waitForCodecMetadata(this.ensureCodecMetadata, videoId)) {
      this.logCodecProbeWaitTimeout(videoId);
    }
    return this.getSnapshot(sequence).playerSession!;
  }

  getSnapshot(sequence: number): WindowSyncSnapshot {
    if (!this.session) return { sequence, playerSession: null };
    const original = this.session;
    const videos = this.repo.listVideosByIds(original.queueIds).filter((video) => !video.isMissing);
    const availableIds = videos.map((video) => video.id);
    if (availableIds.length === 0) {
      this.session = null;
      return { sequence, playerSession: null };
    }

    let selectedVideoId = original.selectedVideoId;
    if (!availableIds.includes(selectedVideoId)) {
      const selectedIndex = original.queueIds.indexOf(original.selectedVideoId);
      selectedVideoId =
        original.queueIds.slice(selectedIndex + 1).find((id) => availableIds.includes(id)) ??
        original.queueIds.slice(0, Math.max(0, selectedIndex)).reverse().find((id) => availableIds.includes(id)) ??
        availableIds[0];
    }
    const start = selectedVideoId === original.selectedVideoId && original.startPositionMs !== undefined
      ? { startPositionMs: original.startPositionMs, startRequestId: original.startRequestId } : {};
    this.session = { selectedVideoId, queueIds: availableIds, ...start };
    return {
      sequence,
      playerSession: {
        sequence,
        selectedVideoId,
        queueIds: availableIds,
        videos,
        ...start
      }
    };
  }

  close(): void {
    this.options.onPlaybackClosed?.();
    this.timelinePreview?.close(); this.timelinePreview = null;
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
    this.session = null;
  }

  getPlayerWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  async showTimelinePreview(senderId: number, payload: unknown): Promise<void> {
    const request = playerTimelinePreviewSchema.parse(payload);
    const parent = this.getPlayerWindow();
    if (!parent || parent.webContents.id !== senderId) throw new Error("Timeline preview belongs to the active player window");
    if (!request) { this.timelinePreview?.hide(); return; }
    if (request.videoId !== this.session?.selectedVideoId) throw new Error("Timeline preview video is not the active video");
    const video = this.repo.getVideo(request.videoId);
    if (video.isMissing) { this.timelinePreview?.hide(); return; }
    this.timelinePreview ??= new PlayerTimelinePreview(parent, this.options);
    await this.timelinePreview.update(request, video);
  }

  private logCodecProbeWaitTimeout(videoId: string): void {
    this.logger?.warn({
      module: "media.playback",
      event: "codec_probe_wait_timeout",
      message: "Player preparation stopped waiting for codec probing",
      context: { videoId }
    });
  }

  private resumePosition(videoId: string): number {
    const position = this.repo.getPlaybackPosition(videoId);
    const duration = this.repo.getVideo(videoId).durationMs;
    // A completed file starts again, not at a permanently ended final frame.
    return duration && position >= duration - 1000 ? 0 : position;
  }
}

async function waitForCodecMetadata(ensureCodecMetadata: CodecMetadataEnsurer, videoId: string): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const enrichment = Promise.resolve()
    .then(() => ensureCodecMetadata(videoId))
    .catch(() => undefined);
  try {
    return await Promise.race([
      enrichment.then(() => false),
      new Promise<true>((resolve) => {
        timeout = setTimeout(() => resolve(true), PLAYBACK_CODEC_PROBE_WAIT_MS);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function normalizePlayerSession(repo: VideoRepository, input: OpenPlayerWindowInput): PlayerSessionState {
  if (input.startPositionMs !== undefined && (!Number.isSafeInteger(input.startPositionMs) || input.startPositionMs < 0)) {
    throw new Error("Player start position must be a nonnegative safe integer");
  }
  if (input.queueIds.length < 1 || input.queueIds.length > MAX_PLAYER_QUEUE_ITEMS) {
    throw new Error(`Player queue must contain between 1 and ${MAX_PLAYER_QUEUE_ITEMS} items`);
  }
  if (!input.queueIds.includes(input.videoId)) {
    throw new Error("Selected video must be included in the player queue");
  }
  const uniqueQueueIds = [...new Set(input.queueIds)];
  const videos = repo.listVideosByIds(uniqueQueueIds).filter((video) => !video.isMissing);
  const availableIds = new Set(videos.map((video) => video.id));
  if (!availableIds.has(input.videoId)) {
    throw new Error("Selected video does not exist or is currently missing");
  }
  return {
    selectedVideoId: input.videoId,
    queueIds: uniqueQueueIds.filter((videoId) => availableIds.has(videoId)),
    ...(input.startPositionMs === undefined ? {} : { startPositionMs: Math.min(input.startPositionMs, Math.max(0, (videos.find((video) => video.id === input.videoId)?.durationMs ?? Infinity) - 1)) })
  };
}

function createPlayerWindow(options: PlayerWindowOptions): BrowserWindow {
  const entryUrl = options.isPackaged ? RENDERER_ENTRY_URL : options.devServerUrl;
  const window = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 860,
    minHeight: 540,
    title: "视频播放",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(options.currentDir, "preload.cjs"),
      additionalArguments: [
        "--video-manager-window-role=player",
        `--video-manager-entry-url=${encodeURIComponent(entryUrl)}`
      ]
    }
  });
  configureWindowSecurity(window, {
    role: "player",
    entryUrl
  });
  return window;
}

async function loadPlayerEntry(window: BrowserWindow, options: PlayerWindowOptions): Promise<void> {
  if (options.isPackaged) {
    await window.loadURL(`${RENDERER_ENTRY_URL}?player=1`);
    return;
  }
  const url = new URL(options.devServerUrl);
  url.searchParams.set("player", "1");
  await window.loadURL(url.toString());
}

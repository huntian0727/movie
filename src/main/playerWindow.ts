import { BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VideoRepository } from "./db/videoRepository.js";
import type { StructuredLogger } from "./logging/logger.js";
import { configureWindowSecurity } from "./security.js";
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
}

type CodecMetadataEnsurer = (videoId: string) => Promise<void>;

export const PLAYBACK_CODEC_PROBE_WAIT_MS = 2_000;

export interface OpenPlayerWindowInput {
  videoId: string;
  queueIds: string[];
}

interface PlayerSessionState {
  selectedVideoId: string;
  queueIds: string[];
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

  constructor(
    private readonly repo: VideoRepository,
    private readonly options: PlayerWindowOptions,
    private readonly ensureCodecMetadata: CodecMetadataEnsurer = async () => undefined,
    private readonly logger?: StructuredLogger
  ) {}

  async open(input: OpenPlayerWindowInput, sequence: number): Promise<PlayerSessionSnapshot> {
    const snapshot = await this.setSession(input, sequence);
    this.opening = this.opening.catch(() => undefined).then(async () => {
      try {
        if (!this.window || this.window.isDestroyed()) {
          this.window = createPlayerWindow(this.options);
          const createdWindow = this.window;
          createdWindow.once("closed", () => {
            if (this.window === createdWindow) this.window = null;
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
    return snapshot;
  }

  async setSession(input: OpenPlayerWindowInput, sequence: number): Promise<PlayerSessionSnapshot> {
    this.session = normalizePlayerSession(this.repo, input);
    if (await waitForCodecMetadata(this.ensureCodecMetadata, this.session.selectedVideoId)) {
      this.logCodecProbeWaitTimeout(this.session.selectedVideoId);
    }
    return this.getSnapshot(sequence).playerSession!;
  }

  async select(videoId: string, sequence: number): Promise<PlayerSessionSnapshot> {
    const snapshot = this.getSnapshot(sequence).playerSession;
    if (!snapshot || !snapshot.queueIds.includes(videoId)) {
      throw new Error("Selected video is not available in the current player queue");
    }
    this.session = { selectedVideoId: videoId, queueIds: snapshot.queueIds };
    if (await waitForCodecMetadata(this.ensureCodecMetadata, videoId)) {
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
    this.session = { selectedVideoId, queueIds: availableIds };
    return {
      sequence,
      playerSession: {
        sequence,
        selectedVideoId,
        queueIds: availableIds,
        videos
      }
    };
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
    this.session = null;
  }

  private logCodecProbeWaitTimeout(videoId: string): void {
    this.logger?.warn({
      module: "media.playback",
      event: "codec_probe_wait_timeout",
      message: "Player preparation stopped waiting for codec probing",
      context: { videoId }
    });
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
    queueIds: uniqueQueueIds.filter((videoId) => availableIds.has(videoId))
  };
}

function createPlayerWindow(options: PlayerWindowOptions): BrowserWindow {
  const packagedEntryPath = path.join(options.currentDir, "../../dist-renderer/index.html");
  const entryUrl = options.isPackaged ? pathToFileURL(packagedEntryPath).href : options.devServerUrl;
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
    await window.loadFile(path.join(options.currentDir, "../../dist-renderer/index.html"));
    return;
  }
  const url = new URL(options.devServerUrl);
  url.searchParams.set("player", "1");
  await window.loadURL(url.toString());
}

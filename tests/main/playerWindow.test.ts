// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { PlaybackMetadataEnricher } from "../../src/main/media/playbackMetadataEnricher";
import type { VideoRecord } from "../../src/shared/videoTypes";

const electronState = vi.hoisted(() => {
  const state = {
    windows: [] as any[],
    nextId: 1
  };
  class FakeBrowserWindow {
    readonly webContents = {
      id: state.nextId++,
      mainFrame: { url: "http://127.0.0.1:5173/" },
      sent: [] as Array<{ channel: string; payload: unknown }>,
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      send: vi.fn((channel: string, payload: unknown) => {
        this.webContents.sent.push({ channel, payload });
      })
    };
    readonly loadFile = vi.fn(async (_filePath: string, options?: unknown) => {
      this.loaded = { kind: "file", options };
    });
    readonly loadURL = vi.fn(async (url: string) => {
      this.loaded = { kind: "url", url };
    });
    readonly show = vi.fn();
    readonly focus = vi.fn();
    private readonly listeners = new Map<string, () => void>();
    destroyed = false;
    loaded: unknown = null;

    constructor(_options: unknown) {
      state.windows.push(this);
    }

    static getAllWindows() {
      return state.windows.filter((window) => !window.destroyed);
    }

    once(event: string, listener: () => void): void {
      this.listeners.set(event, listener);
    }

    close(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      this.listeners.get("closed")?.();
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    listenerCount(event: string): number {
      return this.listeners.has(event) ? 1 : 0;
    }
  }
  return {
    windows: state.windows,
    FakeBrowserWindow,
    reset() {
      state.windows.length = 0;
      state.nextId = 1;
    }
  };
});

vi.mock("electron", () => ({ BrowserWindow: electronState.FakeBrowserWindow }));

import {
  DomainEventBus,
  PLAYBACK_CODEC_PROBE_WAIT_MS,
  PlayerWindowCoordinator,
  normalizePlayerSession
} from "../../src/main/playerWindow";

beforeEach(() => {
  electronState.reset();
});

let integrationDatabase: DatabaseConnection | undefined;
let integrationDirectory: string | undefined;

afterEach(() => {
  vi.useRealTimers();
  integrationDatabase?.close();
  integrationDatabase = undefined;
  if (integrationDirectory) rmSync(integrationDirectory, { recursive: true, force: true });
  integrationDirectory = undefined;
});

describe("player queue normalization", () => {
  it("accepts 1 and 300 items but rejects 0 and 301 before creating a window", () => {
    const one = createRepo(["v1"]);
    expect(normalizePlayerSession(one.repo, { videoId: "v1", queueIds: ["v1"] }).queueIds).toEqual(["v1"]);
    const ids = Array.from({ length: 300 }, (_, index) => `v${index}`);
    const many = createRepo(ids);
    expect(normalizePlayerSession(many.repo, { videoId: ids[0], queueIds: ids })).toHaveProperty("queueIds", ids);
    expect(() => normalizePlayerSession(one.repo, { videoId: "v1", queueIds: [] })).toThrow(/between 1 and 300/);
    expect(() => normalizePlayerSession(many.repo, { videoId: ids[0], queueIds: [...ids, "overflow"] })).toThrow(/between 1 and 300/);
    expect(electronState.windows).toHaveLength(0);
  });

  it("deduplicates IDs, filters unknown or missing entries, and requires the selected ID", () => {
    const fixture = createRepo(["v1", "v2", "missing"], new Set(["missing"]));
    expect(normalizePlayerSession(fixture.repo, {
      videoId: "v1",
      queueIds: ["v1", "v1", "unknown", "v2", "missing", "v2"]
    }).queueIds).toEqual(["v1", "v2"]);
    expect(() => normalizePlayerSession(fixture.repo, { videoId: "v2", queueIds: ["v1"] })).toThrow(/included/);
    expect(() => normalizePlayerSession(fixture.repo, { videoId: "missing", queueIds: ["missing"] })).toThrow(/missing/);
    expect(() => normalizePlayerSession(fixture.repo, { videoId: "unknown", queueIds: ["unknown"] })).toThrow(/missing/);
  });
});

describe("PlayerWindowCoordinator", () => {
  it("loads a fixed player URL without serializing video or queue IDs", async () => {
    const fixture = createRepo(["secret-video", "second-video"]);
    const coordinator = new PlayerWindowCoordinator(fixture.repo, {
      currentDir: "C:\\app\\dist-main",
      devServerUrl: "http://127.0.0.1:5173/",
      isPackaged: false
    });

    await coordinator.open({ videoId: "secret-video", queueIds: ["secret-video", "second-video"] }, 0);

    const loadedUrl = electronState.windows[0].loadURL.mock.calls[0][0] as string;
    expect(loadedUrl).toBe("http://127.0.0.1:5173/?player=1");
    expect(loadedUrl).not.toContain("secret-video");
    expect(loadedUrl).not.toContain("queue");
  });

  it("reuses one window, releases its close listener, and creates one listener after reopening", async () => {
    const fixture = createRepo(["v1", "v2"]);
    const coordinator = new PlayerWindowCoordinator(fixture.repo, {
      currentDir: "C:\\app\\dist-main",
      devServerUrl: "http://127.0.0.1:5173/",
      isPackaged: false
    });
    await coordinator.open({ videoId: "v1", queueIds: ["v1", "v2"] }, 0);
    await coordinator.open({ videoId: "v2", queueIds: ["v1", "v2"] }, 0);

    expect(electronState.windows).toHaveLength(1);
    expect(electronState.windows[0].listenerCount("closed")).toBe(1);
    electronState.windows[0].close();
    await coordinator.open({ videoId: "v1", queueIds: ["v1"] }, 0);

    expect(electronState.windows).toHaveLength(2);
    expect(electronState.windows[1].listenerCount("closed")).toBe(1);
  });

  it("moves to the next available queue item when the current video is deleted", async () => {
    const fixture = createRepo(["v1", "v2", "v3"]);
    const coordinator = new PlayerWindowCoordinator(fixture.repo, {
      currentDir: "C:\\app\\dist-main",
      devServerUrl: "http://127.0.0.1:5173/",
      isPackaged: false
    });
    await coordinator.setSession({ videoId: "v2", queueIds: ["v1", "v2", "v3"] }, 4);
    fixture.videos.delete("v2");

    expect(coordinator.getSnapshot(5).playerSession).toMatchObject({
      sequence: 5,
      selectedVideoId: "v3",
      queueIds: ["v1", "v3"]
    });
  });

  it("returns freshly persisted codec metadata when lazy probing finishes inside the wait window", async () => {
    integrationDirectory = mkdtempSync(path.join(os.tmpdir(), "player-codec-integration-"));
    integrationDatabase = createDatabase(path.join(integrationDirectory, "library.sqlite"));
    const repo = new VideoRepository(integrationDatabase);
    const folder = repo.addSourceFolder("D:\\Movies", true);
    const video = repo.upsertVideo({
      sourceFolderId: folder.id,
      path: "D:\\Movies\\legacy.mp4",
      directory: "D:\\Movies",
      filename: "legacy.mp4",
      basename: "legacy",
      extension: ".mp4",
      sizeBytes: 10,
      durationMs: 1_000,
      width: 1920,
      height: 1080,
      format: "mp4",
      modifiedAt: "2026-08-01T00:00:00.000Z",
      metadataStatus: "ready"
    });
    const enricher = new PlaybackMetadataEnricher(repo, async () => ({
      durationMs: 1_000,
      width: 1920,
      height: 1080,
      format: "mp4",
      videoCodec: "h264",
      videoProfile: "high",
      pixelFormat: "yuv420p",
      audioCodec: "aac"
    }));
    const coordinator = new PlayerWindowCoordinator(repo, {
      currentDir: "C:\\app\\dist-main",
      devServerUrl: "http://127.0.0.1:5173/",
      isPackaged: false
    }, (videoId) => enricher.ensureCodecMetadata(videoId));

    const snapshot = await coordinator.setSession({ videoId: video.id, queueIds: [video.id] }, 7);

    expect(repo.getVideo(video.id)).toMatchObject({ videoCodec: "h264", codecProbeStatus: "ready" });
    expect(snapshot.videos[0]).toMatchObject({
      videoCodec: "h264",
      videoProfile: "high",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      codecProbeStatus: "ready"
    });
  });

  it("returns the player session after the bounded wait while the probe continues in the background", async () => {
    vi.useFakeTimers();
    const fixture = createRepo(["slow"]);
    let finishProbe: (() => void) | undefined;
    const probe = new Promise<void>((resolve) => { finishProbe = resolve; });
    const coordinator = new PlayerWindowCoordinator(fixture.repo, {
      currentDir: "C:\\app\\dist-main",
      devServerUrl: "http://127.0.0.1:5173/",
      isPackaged: false
    }, () => probe);

    const sessionPromise = coordinator.open({ videoId: "slow", queueIds: ["slow"] }, 9);
    await vi.advanceTimersByTimeAsync(PLAYBACK_CODEC_PROBE_WAIT_MS);

    await expect(sessionPromise).resolves.toMatchObject({ selectedVideoId: "slow", sequence: 9 });
    expect(electronState.windows).toHaveLength(1);
    finishProbe?.();
    await Promise.resolve();
  });
});

describe("DomainEventBus", () => {
  it("assigns increasing sequences and broadcasts normalized events to live windows", () => {
    const window = new electronState.FakeBrowserWindow({});
    const bus = new DomainEventBus();

    expect(bus.publish({ type: "video:updated", videoIds: ["v1", "v1"] })).toEqual({
      sequence: 1,
      type: "video:updated",
      videoIds: ["v1"]
    });
    expect(bus.publish({ type: "video:removed", videoIds: ["v2"] }).sequence).toBe(2);
    expect(window.webContents.sent).toHaveLength(2);
  });
});

function createRepo(ids: string[], missing = new Set<string>()) {
  const videos = new Map(ids.map((id) => [id, createVideo(id, missing.has(id))]));
  const repo = {
    listVideosByIds: (videoIds: string[]) =>
      videoIds.map((videoId) => videos.get(videoId)).filter((video): video is VideoRecord => Boolean(video))
  } as unknown as VideoRepository;
  return { repo, videos };
}

function createVideo(id: string, isMissing: boolean): VideoRecord {
  return {
    id,
    sourceFolderId: "folder",
    path: `D:\\Movies\\${id}.mp4`,
    directory: "D:\\Movies",
    filename: `${id}.mp4`,
    basename: id,
    extension: ".mp4",
    sizeBytes: 1,
    durationMs: 1000,
    width: 1280,
    height: 720,
    format: "mp4",
    videoCodec: null,
    videoProfile: null,
    pixelFormat: null,
    audioCodec: null,
    modifiedAt: "2026-07-24T00:00:00.000Z",
    importedAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    isFavorite: false,
    isPendingDelete: false,
    isMissing,
    metadataStatus: "ready",
    codecProbeStatus: "unprobed",
    thumbnailStatus: "pending",
    timelinePreviewStatus: "pending",
    coverCachePath: null,
    contentFingerprint: null,
    fingerprintStatus: "pending",
    fingerprintUpdatedAt: null,
    fingerprintError: null
  };
}

// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";
import { escapePlaybackDiagnosticLikePattern, searchPlaybackDiagnosticVideos } from "../../src/main/playbackDiagnostic/playbackDiagnosticQueries.js";

let tempDirectory: string;
let database: DatabaseConnection | undefined;

beforeEach(() => {
  tempDirectory = mkdtempSync(path.join(tmpdir(), "video-manager-playback-diagnostic-query-"));
  database = createDatabase(path.join(tempDirectory, "library.sqlite"));
});

afterEach(() => {
  database?.close();
  database = undefined;
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe("searchPlaybackDiagnosticVideos", () => {
  it("matches a token found only in the full path", () => {
    const repo = new VideoRepository(database!);
    const folder = repo.addSourceFolder("D:\\Movies", true);
    addVideo(repo, folder.id, "D:\\Movies\\HiddenToken\\ordinary.mp4", "ordinary.mp4");
    addVideo(repo, folder.id, "D:\\Movies\\Other\\plain.mp4", "plain.mp4");

    const result = searchPlaybackDiagnosticVideos(database!, { search: "HiddenToken", page: 1, pageSize: 30 });

    expect(result.totalCount).toBe(1);
    expect(result.videos.map((video) => video.filename)).toEqual(["ordinary.mp4"]);
  });

  it.each([
    ["percent", "%", "literal%name.mp4"],
    ["underscore", "_", "literal_name.mp4"],
    ["escape marker", "!", "literal!name.mp4"]
  ])("treats the LIKE %s token literally", (_label, token, matchingFilename) => {
    const repo = new VideoRepository(database!);
    const folder = repo.addSourceFolder("D:\\Movies", true);
    addVideo(repo, folder.id, `D:\\Movies\\${matchingFilename}`, matchingFilename);
    addVideo(repo, folder.id, "D:\\Movies\\literalXname.mp4", "literalXname.mp4");

    const result = searchPlaybackDiagnosticVideos(database!, { search: token, page: 1, pageSize: 30 });

    expect(result.videos.map((video) => video.filename)).toEqual([matchingFilename]);
  });

  it("clamps an out-of-range page and returns the shared VideoRecord mapping", () => {
    const repo = new VideoRepository(database!);
    const folder = repo.addSourceFolder("D:\\Movies", true);
    const inserted = addVideo(repo, folder.id, "D:\\Movies\\clip.mp4", "clip.mp4");

    const result = searchPlaybackDiagnosticVideos(database!, { search: "clip", page: 99, pageSize: 30 });

    expect(result).toMatchObject({ page: 1, pageSize: 30, totalPages: 1, totalCount: 1 });
    expect(result.videos[0]).toEqual(repo.getVideo(inserted.id));
  });

  it("escapes every SQLite LIKE wildcard", () => {
    expect(escapePlaybackDiagnosticLikePattern("a!b%c_d")).toBe("a!!b!%c!_d");
  });
});

function addVideo(repo: VideoRepository, sourceFolderId: string, videoPath: string, filename: string) {
  return repo.upsertVideo({
    sourceFolderId,
    path: videoPath,
    directory: path.win32.dirname(videoPath),
    filename,
    basename: path.win32.parse(filename).name,
    extension: path.win32.extname(filename),
    sizeBytes: 1024,
    durationMs: 90_000,
    width: 1920,
    height: 1080,
    format: "mp4",
    modifiedAt: "2026-09-04T00:00:00.000Z"
  });
}

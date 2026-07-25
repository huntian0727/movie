import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverVideoFiles } from "../../src/main/media/fileDiscovery";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-discovery-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("discoverVideoFiles", () => {
  it("discovers videos recursively when enabled", async () => {
    mkdirSync(path.join(tempDir, "nested"));
    writeFileSync(path.join(tempDir, "root.mp4"), "");
    writeFileSync(path.join(tempDir, "nested", "child.mkv"), "");
    writeFileSync(path.join(tempDir, "notes.txt"), "");

    const files = await discoverVideoFiles(tempDir, true);

    expect(files.map((file) => path.basename(file)).sort()).toEqual(["child.mkv", "root.mp4"]);
  });

  it("does not enter child directories when recursive is disabled", async () => {
    mkdirSync(path.join(tempDir, "nested"));
    writeFileSync(path.join(tempDir, "root.mp4"), "");
    writeFileSync(path.join(tempDir, "nested", "child.mkv"), "");

    const files = await discoverVideoFiles(tempDir, false);

    expect(files.map((file) => path.basename(file))).toEqual(["root.mp4"]);
  });

  it("skips temporary download suffixes case-insensitively", async () => {
    writeFileSync(path.join(tempDir, "keep.mp4"), "");
    writeFileSync(path.join(tempDir, "skip-one.mp4.part"), "");
    writeFileSync(path.join(tempDir, "skip-two.mkv.TMP"), "");
    writeFileSync(path.join(tempDir, "skip-three.mov.CrDownload"), "");

    const files = await discoverVideoFiles(tempDir, true);

    expect(files.map((file) => path.basename(file))).toEqual(["keep.mp4"]);
  });

  it("discovers mixed-case video extensions", async () => {
    writeFileSync(path.join(tempDir, "Movie.MP4"), "");

    const files = await discoverVideoFiles(tempDir, true);

    expect(files.map((file) => path.basename(file))).toEqual(["Movie.MP4"]);
  });

  it("skips an unreadable child branch and continues scanning siblings", async () => {
    mkdirSync(path.join(tempDir, "blocked"));
    mkdirSync(path.join(tempDir, "nested"));
    writeFileSync(path.join(tempDir, "blocked", "hidden.mp4"), "");
    writeFileSync(path.join(tempDir, "root.mp4"), "");
    writeFileSync(path.join(tempDir, "nested", "child.mkv"), "");

    const files = await discoverVideoFiles(tempDir, true, {
      readdirImpl: async (directory) => {
        if (directory.endsWith(`${path.sep}blocked`)) {
          const error = new Error("simulated branch failure") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }

        return readdir(directory, { withFileTypes: true });
      }
    });

    expect(files.map((file) => path.basename(file)).sort()).toEqual(["child.mkv", "root.mp4"]);
  });

  it("keeps scanning while directory entries continue arriving before the idle timeout", async () => {
    writeFileSync(path.join(tempDir, "one.mp4"), "");
    writeFileSync(path.join(tempDir, "two.mp4"), "");
    writeFileSync(path.join(tempDir, "three.mp4"), "");
    const entries = await readdir(tempDir, { withFileTypes: true });

    const files = await discoverVideoFiles(tempDir, false, {
      directoryEntryTimeoutMs: 30,
      directoryEntriesImpl: async () => ({
        async *[Symbol.asyncIterator]() {
          for (const entry of entries) {
            await new Promise((resolve) => setTimeout(resolve, 15));
            yield entry;
          }
        }
      })
    });

    expect(files.map((file) => path.basename(file)).sort()).toEqual(["one.mp4", "three.mp4", "two.mp4"]);
  });

  it("reports an idle child directory, skips it, and continues scanning", async () => {
    mkdirSync(path.join(tempDir, "blocked"));
    mkdirSync(path.join(tempDir, "nested"));
    writeFileSync(path.join(tempDir, "root.mp4"), "");
    writeFileSync(path.join(tempDir, "nested", "child.mkv"), "");
    const failedDirectories: string[] = [];

    const files = await discoverVideoFiles(tempDir, true, {
      directoryEntryTimeoutMs: 10,
      directoryEntriesImpl: async (directory) => {
        if (directory.endsWith(`${path.sep}blocked`)) {
          return new Promise(() => undefined);
        }
        return readdir(directory, { withFileTypes: true });
      },
      onDirectoryError: (directory) => failedDirectories.push(directory)
    });

    expect(files.map((file) => path.basename(file)).sort()).toEqual(["child.mkv", "root.mp4"]);
    expect(failedDirectories).toEqual([path.join(tempDir, "blocked")]);
  });
});

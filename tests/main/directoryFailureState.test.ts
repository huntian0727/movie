// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseConnection } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";

let directory: string;
let database: DatabaseConnection;
let repo: VideoRepository;
let sourceId: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "directory-failure-state-"));
  database = createDatabase(path.join(directory, "test.sqlite"));
  repo = new VideoRepository(database);
  sourceId = repo.addSourceFolder("F:\\Library", true).id;
});
afterEach(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });

function snapshot(directoryPath: string) {
  repo.upsertDirectorySnapshot({ sourceFolderId: sourceId, directoryPath, parentDirectoryPath: null,
    directoryMtime: "2026-10-05T00:00:00Z", directVideoCount: 1, directChildCount: 1,
    directEntryDigest: "test", isComplete: true, hasUnresolvedFailure: false, successful: true });
}
function record(objectPath: string, objectType: "file" | "directory" = "file", failureStage = "metadata", sourceFolderId = sourceId) {
  return repo.recordScanFailure({ sourceFolderId, scanTaskId: "test", objectPath, objectType,
    failureStage, errorCode: "EIO", errorSummary: "test failure" });
}

describe("targeted directory failure state", () => {
  it.each(["F:\\", "F:\\Library", "F:\\资料 %_!\\目录", "\\\\server\\share", "\\\\server\\share\\资料 %_!"])(
    "preserves direct-file, directory and multi-stage failure state for %s", (target) => {
      snapshot(target);
      const file = path.win32.join(target, "VIDEO.mp4");
      const first = record(file);
      const second = record(file.replaceAll("\\", "/").toLowerCase(), "file", "thumbnail");
      const dirFailure = record(target, "directory", "enumeration");
      const listAll = vi.spyOn(repo, "listScanFailures");

      expect(repo.getDirectorySnapshot(sourceId, target)?.hasUnresolvedFailure).toBe(true);
      repo.markScanFailureRetrying(second.id);
      expect(repo.resolveScanFailuresForObjectStage(sourceId, file, "file", "metadata")).toBe(1);
      expect(repo.getScanFailure(first.id)?.status).toBe("resolved");
      expect(repo.getDirectorySnapshot(sourceId, target)?.hasUnresolvedFailure).toBe(true);
      expect(repo.resolveScanFailuresForObject(sourceId, file.toLowerCase(), "file")).toBe(1);
      expect(repo.getDirectorySnapshot(sourceId, target)?.hasUnresolvedFailure).toBe(true);
      repo.resolveScanFailure(dirFailure.id);
      expect(repo.getDirectorySnapshot(sourceId, target)?.hasUnresolvedFailure).toBe(false);
      expect(listAll).not.toHaveBeenCalled();
    }
  );

  it("ignores descendants, path-prefix siblings, wildcard lookalikes and other sources", () => {
    const target = "F:\\Library\\A%_!";
    snapshot(target);
    record(`${target}\\nested\\broken.mp4`);
    record(`${target}\\nested`, "directory");
    record("F:\\Library\\Axq!\\broken.mp4");
    record(`${target}-sibling\\broken.mp4`);
    const otherSource = repo.addSourceFolder("G:\\Other", true).id;
    record(`${target}\\other-source.mp4`, "file", "metadata", otherSource);
    const own = record(`${target}\\own.mp4`);
    repo.resolveScanFailure(own.id);
    expect(repo.getDirectorySnapshot(sourceId, target)?.hasUnresolvedFailure).toBe(false);
  });

  it("matches the previous direct-directory semantics without loading the whole source", () => {
    const target = "F:\\Library\\Target";
    snapshot(target);
    for (let index = 0; index < 40; index++) record(`F:\\Library\\Unrelated-${index}\\file.mp4`);
    const listAll = vi.spyOn(repo, "listScanFailures");
    const failure = record(`${target}\\own.mp4`);
    repo.resolveScanFailuresForObject(sourceId, failure.objectPath);
    expect(listAll).not.toHaveBeenCalled();
    expect(repo.getDirectorySnapshot(sourceId, target)?.hasUnresolvedFailure).toBe(false);
  });

  it("uses the existing normalized-path index for the direct-file prefix range", () => {
    const target = "F:\\Library\\Target";
    snapshot(target);
    const prepare = vi.spyOn(database, "prepare");
    record(`${target}\\own.mp4`);
    const sql = prepare.mock.calls.map(([query]) => query).find((query) => query.includes("SELECT 1 WHERE EXISTS"));
    prepare.mockRestore();
    expect(sql).toBeDefined();
    const plan = database.prepare(`EXPLAIN QUERY PLAN ${sql!}`).all({ sourceFolderId: sourceId,
      directory: "f:\\library\\target", prefix: "f:\\library\\target\\", prefixEnd: "f:\\library\\target]" }) as Array<{ detail: string }>;
    expect(plan.some(({ detail }) => /SEARCH scan_failures.*normalized_path>\? AND normalized_path<\?/.test(detail))).toBe(true);
  });
});

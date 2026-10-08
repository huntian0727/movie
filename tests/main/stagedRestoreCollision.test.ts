// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DuplicateCleanupService } from "../../src/main/media/duplicateCleanupService";

const race = vi.hoisted(() => ({ original: "", inserted: false, linkError: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const insertNewcomer = async (destination: unknown) => {
    if (destination !== race.original || race.inserted) return;
    await actual.writeFile(race.original, "new-user-video", { flag: "wx" });
    race.inserted = true;
  };
  return {
    ...actual,
    stat: vi.fn(async (...args: Parameters<typeof actual.stat>) => {
      try { return await actual.stat(...args); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") await insertNewcomer(args[0]);
        throw error;
      }
    }),
    rename: vi.fn(actual.rename),
    link: vi.fn(async (...args: Parameters<typeof actual.link>) => {
      if (race.linkError) throw Object.assign(new Error("Synthetic unsupported hard link"), { code: race.linkError });
      await insertNewcomer(args[1]);
      return actual.link(...args);
    })
  };
});

type InternalService = {
  restoreStagedFile(itemId: string, staged: string, original: string): Promise<boolean>;
  recoveryPromise: Promise<void>;
  processAuthorizedDelete(jobId: string, item: unknown): Promise<void>;
};

describe("verified duplicate restoration never overwrites concurrent user media", () => {
  let temporaryRoot = "";
  afterEach(async () => {
    race.original = "";
    race.inserted = false;
    race.linkError = "";
    vi.clearAllMocks();
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = "";
  });

  async function fixture(startup: boolean) {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "movie-staged-collision-qa-"));
    const managed = path.join(temporaryRoot, "managed");
    await mkdir(managed);
    const staged = path.join(managed, ".duplicate.mp4.movie-delete-qa");
    const original = path.join(managed, "duplicate.mp4");
    await writeFile(staged, "original-isolated-video");
    const stats = await stat(staged, { bigint: true });
    const ordinaryStats = await stat(staged);
    const stable = [stats.dev, stats.ino, stats.birthtimeNs].map(String).join(":");
    const identity = JSON.stringify({ stable, version: [stable, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":") });
    const item = { id: "synthetic-item", delete_path: original, staged_delete_path: staged,
      delete_file_identity: identity, expected_delete_size_bytes: Number(stats.size),
      expected_delete_modified_at: ordinaryStats.mtime.toISOString() };
    const clearIsolation = vi.fn();
    const recordIsolationRecoveryFailure = vi.fn();
    let exposeStagedItem = startup;
    const jobs = { interruptActiveJobs: vi.fn(), recoverFastJobs: () => [],
      listStagedItems: () => exposeStagedItem ? [item] : [], getWorkItem: () => item,
      clearIsolation, recordIsolationRecoveryFailure };
    const videos = { listSourceFolders: () => [{ id: "synthetic-source", path: managed, enabled: true }] };
    race.original = original;
    const service = new DuplicateCleanupService(
      jobs as unknown as ConstructorParameters<typeof DuplicateCleanupService>[0],
      videos as unknown as ConstructorParameters<typeof DuplicateCleanupService>[1],
      {} as ConstructorParameters<typeof DuplicateCleanupService>[2],
      {} as ConstructorParameters<typeof DuplicateCleanupService>[3],
      { publish: vi.fn() } as unknown as ConstructorParameters<typeof DuplicateCleanupService>[4]
    );
    exposeStagedItem = true;
    return { internal: service as unknown as InternalService, original, staged, managed, item, clearIsolation, recordIsolationRecoveryFailure };
  }

  it("preserves the replacement and isolated media during live rollback", async () => {
    const { internal, original, staged, clearIsolation } = await fixture(false);
    await internal.recoveryPromise;
    expect(await internal.restoreStagedFile("synthetic-item", staged, original)).toBe(false);
    expect(await readFile(original, "utf8")).toBe("new-user-video");
    expect(await readFile(staged, "utf8")).toBe("original-isolated-video");
    expect(clearIsolation).not.toHaveBeenCalled();
  });

  it("preserves the replacement and recovery record during application restart", async () => {
    const { internal, original, staged, clearIsolation, recordIsolationRecoveryFailure } = await fixture(true);
    await internal.recoveryPromise;
    expect(await readFile(original, "utf8")).toBe("new-user-video");
    expect(await readFile(staged, "utf8")).toBe("original-isolated-video");
    expect(clearIsolation).not.toHaveBeenCalled();
    expect(recordIsolationRecoveryFailure).toHaveBeenCalled();
  });

  it("retains both a substituted staging object and the displaced original", async () => {
    const { internal, original, staged, clearIsolation } = await fixture(false);
    await internal.recoveryPromise;
    race.original = "";
    const retained = path.join(temporaryRoot, "retained-original.mp4");
    await rename(staged, retained);
    await writeFile(staged, "replacement-stage-video");
    expect(await internal.restoreStagedFile("synthetic-item", staged, original)).toBe(false);
    expect(await readFile(staged, "utf8")).toBe("replacement-stage-video");
    expect(await readFile(retained, "utf8")).toBe("original-isolated-video");
    await expect(stat(original)).rejects.toMatchObject({ code: "ENOENT" });
    expect(clearIsolation).not.toHaveBeenCalled();
  });

  it("retains staged media if its ancestor becomes a Windows junction", async () => {
    const { internal, original, staged, managed, clearIsolation } = await fixture(false);
    await internal.recoveryPromise;
    race.original = "";
    const retainedRoot = path.join(temporaryRoot, "retained-managed");
    await rename(managed, retainedRoot);
    await symlink(retainedRoot, managed, "junction");
    expect(await internal.restoreStagedFile("synthetic-item", staged, original)).toBe(false);
    expect(await readFile(staged, "utf8")).toBe("original-isolated-video");
    await expect(stat(original)).rejects.toMatchObject({ code: "ENOENT" });
    expect(clearIsolation).not.toHaveBeenCalled();
  });

  it("retains staged media when persisted object identity is missing", async () => {
    const { internal, original, staged, item, clearIsolation } = await fixture(false);
    await internal.recoveryPromise;
    race.original = "";
    item.delete_file_identity = "";
    expect(await internal.restoreStagedFile("synthetic-item", staged, original)).toBe(false);
    expect(await readFile(staged, "utf8")).toBe("original-isolated-video");
    await expect(stat(original)).rejects.toMatchObject({ code: "ENOENT" });
    expect(clearIsolation).not.toHaveBeenCalled();
  });

  it("retains staged media on unsupported hard links instead of falling back to overwrite-capable rename", async () => {
    const { internal, original, staged, clearIsolation } = await fixture(false);
    await internal.recoveryPromise;
    race.original = "";
    race.linkError = "ENOTSUP";
    vi.mocked(rename).mockClear();
    expect(await internal.restoreStagedFile("synthetic-item", staged, original)).toBe(false);
    expect(await readFile(staged, "utf8")).toBe("original-isolated-video");
    await expect(stat(original)).rejects.toMatchObject({ code: "ENOENT" });
    expect(clearIsolation).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("rechecks the isolated object after the final kept-file hash before unlink", async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "movie-staged-final-qa-"));
    const managed = path.join(temporaryRoot, "managed");
    await mkdir(managed);
    const keep = path.join(managed, "keep.mp4");
    const original = path.join(managed, "duplicate.mp4");
    const retained = path.join(managed, "retained-isolated-original.mp4");
    await writeFile(keep, "original-duplicate-video");
    await writeFile(original, "original-duplicate-video");
    const keepStats = await stat(keep, { bigint: true });
    const deleteStats = await stat(original, { bigint: true });
    const keepOrdinary = await stat(keep);
    const deleteOrdinary = await stat(original);
    const identity = (stats: typeof keepStats) => {
      const stable = [stats.dev, stats.ino, stats.birthtimeNs].map(String).join(":");
      return JSON.stringify({ stable, version: [stable, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":") });
    };
    const hash = crypto.createHash("sha256").update("original-duplicate-video").digest("hex");
    const item = { id: "final-isolated-item", delete_video_id: "synthetic-video", keep_path: keep, delete_path: original,
      staged_delete_path: null as string | null, expected_keep_size_bytes: Number(keepStats.size),
      expected_keep_modified_at: keepOrdinary.mtime.toISOString(), expected_delete_size_bytes: Number(deleteStats.size),
      expected_delete_modified_at: deleteOrdinary.mtime.toISOString(), keep_file_identity: identity(keepStats),
      delete_file_identity: identity(deleteStats), keep_sha256: hash, delete_sha256: hash };
    const jobs = { interruptActiveJobs: vi.fn(), recoverFastJobs: () => [],
      listStagedItems: () => item.staged_delete_path ? [item] : [], isCancelling: () => false,
      prepareIsolation: (_job: string, _item: string, staged: string) => { item.staged_delete_path = staged; return true; },
      claimDeletionItem: () => true, clearIsolation: vi.fn(), updateItem: vi.fn() };
    const videos = { listSourceFolders: () => [{ id: "synthetic-source", path: managed, enabled: true }], removeVideo: vi.fn() };
    let keepHashCalls = 0;
    const deleteFile = vi.fn(async (file: string) => rm(file));
    const service = new DuplicateCleanupService(
      jobs as unknown as ConstructorParameters<typeof DuplicateCleanupService>[0],
      videos as unknown as ConstructorParameters<typeof DuplicateCleanupService>[1],
      {} as ConstructorParameters<typeof DuplicateCleanupService>[2],
      {} as ConstructorParameters<typeof DuplicateCleanupService>[3],
      { publish: vi.fn() } as unknown as ConstructorParameters<typeof DuplicateCleanupService>[4],
      { deleteFile, hashFile: async (file) => {
        if (file === keep && ++keepHashCalls === 2) {
          const stagedName = (await readdir(managed)).find(name => name.includes(".movie-delete-"));
          if (!stagedName) throw new Error("Isolation did not occur before final keep hash");
          const staged = path.join(managed, stagedName);
          await rename(staged, retained);
          await writeFile(staged, "newcomer-isolated-video!");
        }
        return crypto.createHash("sha256").update(await readFile(file)).digest("hex");
      } }
    );
    const internal = service as unknown as InternalService;
    await internal.recoveryPromise;
    await internal.processAuthorizedDelete("synthetic-job", item);
    expect(keepHashCalls, JSON.stringify(jobs.updateItem.mock.calls)).toBe(2);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(videos.removeVideo).not.toHaveBeenCalled();
    expect(await readFile(item.staged_delete_path!, "utf8")).toBe("newcomer-isolated-video!");
    expect(await readFile(retained, "utf8")).toBe("original-duplicate-video");
    expect(jobs.clearIsolation).not.toHaveBeenCalled();
    expect(jobs.updateItem.mock.calls.some(([, status]) => status === "deleted")).toBe(false);
    expect(jobs.updateItem.mock.calls.some(([, status]) => status === "failed")).toBe(true);
  });
});

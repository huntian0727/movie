import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { link, rename as renameFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitMoveWithRollback, commitRenameWithRollback, inspectMoveTarget, moveFileWithConflictResolution, permanentlyDeleteFile, renamePreservingExtension } from "../../src/main/files/fileOperations.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-files-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("fileOperations", () => {
  it("renames only the base name and preserves extension", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    const renamed = await renamePreservingExtension(original, "new-name");

    expect(path.basename(renamed)).toBe("new-name.mp4");
    expect(readFileSync(renamed, "utf8")).toBe("video");
    expect(existsSync(original)).toBe(false);
  });

  it("returns the original path when the base name is unchanged", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    const renamed = await renamePreservingExtension(original, "clip");

    expect(renamed).toBe(original);
    expect(readFileSync(original, "utf8")).toBe("video");
  });

  it.runIf(process.platform === "win32")("allows case-only renames on Windows", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    const renamed = await renamePreservingExtension(original, "CLIP");

    expect(path.basename(renamed)).toBe("CLIP.mp4");
    expect(readFileSync(renamed, "utf8")).toBe("video");
  });

  it("rejects an empty replacement filename", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    await expect(renamePreservingExtension(original, "")).rejects.toThrow("Filename cannot be empty");
    expect(existsSync(original)).toBe(true);
  });

  it("rejects leading or trailing whitespace in the requested base name", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    await expect(renamePreservingExtension(original, " new-name")).rejects.toThrow(
      "Filename cannot contain leading or trailing whitespace"
    );
    await expect(renamePreservingExtension(original, "new-name ")).rejects.toThrow(
      "Filename cannot contain leading or trailing whitespace"
    );
    expect(existsSync(original)).toBe(true);
  });

  it("rejects invalid filename characters including path separators", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    await expect(renamePreservingExtension(original, "../escape")).rejects.toThrow("Filename contains invalid characters");
    await expect(renamePreservingExtension(original, "bad/name")).rejects.toThrow("Filename contains invalid characters");
    expect(existsSync(original)).toBe(true);
  });

  it("rejects control characters in the requested base name", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    await expect(renamePreservingExtension(original, "bad\nname")).rejects.toThrow("Filename contains invalid characters");
    expect(existsSync(original)).toBe(true);
  });

  it("rejects reserved Windows device base names case-insensitively", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    await expect(renamePreservingExtension(original, "con")).rejects.toThrow("Filename uses a reserved Windows device name");
    await expect(renamePreservingExtension(original, "Lpt1")).rejects.toThrow("Filename uses a reserved Windows device name");
    expect(existsSync(original)).toBe(true);
  });

  it("rejects base names that end with a dot after trimming", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    await expect(renamePreservingExtension(original, "name.")).rejects.toThrow("Filename cannot end with a dot");
    expect(existsSync(original)).toBe(true);
  });

  it("rejects renames when the destination path already exists", async () => {
    const original = path.join(tempDir, "clip.mp4");
    const destination = path.join(tempDir, "new-name.mp4");
    writeFileSync(original, "source");
    writeFileSync(destination, "destination");

    await expect(renamePreservingExtension(original, "new-name")).rejects.toMatchObject({ code: "TARGET_EXISTS" });
    expect(readFileSync(original, "utf8")).toBe("source");
    expect(readFileSync(destination, "utf8")).toBe("destination");
  });

  it("does not leave a destination placeholder when rename fails", async () => {
    const original = path.join(tempDir, "clip.mp4");
    const destination = path.join(tempDir, "new-name.mp4");
    const renameError = Object.assign(new Error("simulated rename failure"), { code: "EACCES" });
    writeFileSync(original, "source");

    const failure = await renamePreservingExtension(original, "new-name", {
      linkImpl: async () => {
        throw renameError;
      }
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ code: "PERMISSION_DENIED" });
    expect((failure as Error).cause).toBe(renameError);
    expect(readFileSync(original, "utf8")).toBe("source");
    expect(existsSync(destination)).toBe(false);
  });

  it("removes the newly linked destination when deleting the old name fails", async () => {
    const original = path.join(tempDir, "clip.mp4");
    const destination = path.join(tempDir, "new-name.mp4");
    writeFileSync(original, "source");

    await expect(renamePreservingExtension(original, "new-name", {
      unlinkImpl: async (filePath) => {
        if (filePath === original) throw Object.assign(new Error("locked"), { code: "EBUSY" });
        await unlink(filePath);
      }
    })).rejects.toMatchObject({ code: "FILE_LOCKED" });

    expect(readFileSync(original, "utf8")).toBe("source");
    expect(existsSync(destination)).toBe(false);
  });

  it.runIf(process.platform === "win32")("restores the original name when the second case-only rename phase fails", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "source");
    let callCount = 0;

    await expect(renamePreservingExtension(original, "CLIP", {
      renameImpl: async (oldPath, newPath) => {
        callCount += 1;
        if (callCount === 2) throw Object.assign(new Error("locked target"), { code: "EBUSY" });
        await renameFile(oldPath, newPath);
      }
    })).rejects.toMatchObject({ code: "FILE_LOCKED" });

    expect(readFileSync(original, "utf8")).toBe("source");
    expect(readdirSync(tempDir)).toEqual(["clip.mp4"]);
  });

  it("rolls a rename back when the database update fails", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "source");
    const renamed = await renamePreservingExtension(original, "new-name");

    await expect(commitRenameWithRollback(original, renamed, () => {
      throw new Error("simulated database update failure");
    })).rejects.toMatchObject({ code: "DB_UPDATE_ROLLED_BACK" });

    expect(readFileSync(original, "utf8")).toBe("source");
    expect(existsSync(renamed)).toBe(false);
  });

  it("does not reserve a destination for unchanged base names", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    await expect(
      renamePreservingExtension(original, "clip", {
        renameImpl: async () => {
          throw new Error("rename should not be called");
        }
      })
    ).resolves.toBe(original);
    expect(readFileSync(original, "utf8")).toBe("video");
  });

  it("permanently deletes the target file", async () => {
    const file = path.join(tempDir, "clip.mkv");
    writeFileSync(file, "video");

    await permanentlyDeleteFile(file);

    expect(existsSync(file)).toBe(false);
  });

  it("does not recursively delete directories", async () => {
    const directory = path.join(tempDir, "folder");
    const nestedFile = path.join(directory, "clip.mkv");
    mkdirSync(directory);
    writeFileSync(nestedFile, "video");

    await expect(permanentlyDeleteFile(directory)).rejects.toMatchObject({ code: "ERR_FS_EISDIR" });
    expect(existsSync(directory)).toBe(true);
    expect(existsSync(nestedFile)).toBe(true);
  });

  it("never overwrites a same-name same-size file with different content", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    const existing = path.join(targetDirectory, "clip.mp4");
    writeFileSync(source, "AAAA");
    writeFileSync(existing, "BBBB");

    expect(await inspectMoveTarget(source, targetDirectory)).toMatchObject({ plan: "rename", targetPath: path.join(targetDirectory, "clip1.mp4") });
    const moved = await moveFileWithConflictResolution(source, targetDirectory);

    expect(moved).toMatchObject({ plan: "rename", targetPath: path.join(targetDirectory, "clip1.mp4") });
    expect(readFileSync(existing, "utf8")).toBe("BBBB");
    expect(readFileSync(moved.targetPath, "utf8")).toBe("AAAA");
    expect(existsSync(source)).toBe(false);
  });

  it("uses the next available numeric suffix for repeated conflicts", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    writeFileSync(source, "source");
    writeFileSync(path.join(targetDirectory, "clip.mp4"), "existing");
    writeFileSync(path.join(targetDirectory, "clip1.mp4"), "existing-1");

    const moved = await moveFileWithConflictResolution(source, targetDirectory);
    expect(moved.targetPath).toBe(path.join(targetDirectory, "clip2.mp4"));
    expect(readFileSync(moved.targetPath, "utf8")).toBe("source");
  });

  it("cleans a private temporary file and preserves the source when cross-volume copy fails", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    writeFileSync(source, "source");
    const exdev = Object.assign(new Error("cross volume"), { code: "EXDEV" });

    await expect(moveFileWithConflictResolution(source, targetDirectory, {
      linkImpl: async () => { throw exdev; },
      copyFileImpl: async () => { throw new Error("simulated copy failure"); }
    })).rejects.toThrow("simulated copy failure");

    expect(readFileSync(source, "utf8")).toBe("source");
    expect(readdirSync(targetDirectory)).toEqual([]);
  });

  it("preserves the source and removes partial data when a cross-volume copy reports disk full", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    writeFileSync(source, "source");
    const exdev = Object.assign(new Error("cross volume"), { code: "EXDEV" });
    const diskFull = Object.assign(new Error("disk full"), { code: "ENOSPC" });

    await expect(moveFileWithConflictResolution(source, targetDirectory, {
      linkImpl: async () => { throw exdev; },
      copyFileImpl: async (_sourcePath, temporaryPath) => {
        writeFileSync(temporaryPath, "partial");
        throw diskFull;
      }
    })).rejects.toMatchObject({ code: "ENOSPC" });

    expect(readFileSync(source, "utf8")).toBe("source");
    expect(readdirSync(targetDirectory)).toEqual([]);
  });

  it("publishes a verified temporary copy before deleting a cross-volume source", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    writeFileSync(source, "cross-volume-source");
    const exdev = Object.assign(new Error("cross volume"), { code: "EXDEV" });

    const moved = await moveFileWithConflictResolution(source, targetDirectory, {
      linkImpl: async (oldPath, newPath) => {
        if (oldPath === source) throw exdev;
        await link(oldPath, newPath);
      }
    });

    expect(readFileSync(moved.targetPath, "utf8")).toBe("cross-volume-source");
    expect(existsSync(source)).toBe(false);
    expect(readdirSync(targetDirectory)).toEqual(["clip.mp4"]);
  });

  it("preserves the source and cleans temp data when final cross-volume publication fails", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    writeFileSync(source, "source");
    const exdev = Object.assign(new Error("cross volume"), { code: "EXDEV" });
    const publishFailure = Object.assign(new Error("simulated final publish failure"), { code: "EACCES" });

    await expect(moveFileWithConflictResolution(source, targetDirectory, {
      linkImpl: async (oldPath) => { if (oldPath === source) throw exdev; throw publishFailure; }
    })).rejects.toThrow("simulated final publish failure");

    expect(readFileSync(source, "utf8")).toBe("source");
    expect(readdirSync(targetDirectory)).toEqual([]);
  });

  it("replans to a unique name when a target appears after preview", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    const racedTarget = path.join(targetDirectory, "clip.mp4");
    writeFileSync(source, "source");
    expect(await inspectMoveTarget(source, targetDirectory)).toMatchObject({ plan: "direct", targetPath: racedTarget });
    writeFileSync(racedTarget, "created-after-preview");

    const moved = await moveFileWithConflictResolution(source, targetDirectory);
    expect(moved).toMatchObject({ plan: "rename", targetPath: path.join(targetDirectory, "clip1.mp4") });
    expect(readFileSync(racedTarget, "utf8")).toBe("created-after-preview");
    expect(readFileSync(moved.targetPath, "utf8")).toBe("source");
  });

  it("rolls back the new target when deleting the source fails", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    writeFileSync(source, "source");

    await expect(moveFileWithConflictResolution(source, targetDirectory, {
      linkImpl: link,
      unlinkImpl: async (filePath) => {
        if (filePath === source) throw new Error("simulated source delete failure");
        await unlink(filePath);
      }
    })).rejects.toThrow("simulated source delete failure");

    expect(readFileSync(source, "utf8")).toBe("source");
    expect(existsSync(path.join(targetDirectory, "clip.mp4"))).toBe(false);
  });

  it("provides a compensating rollback when the database update fails after a move", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    writeFileSync(source, "source");

    const moved = await moveFileWithConflictResolution(source, targetDirectory);
    await expect(commitMoveWithRollback(moved, () => { throw new Error("simulated database update failure"); })).rejects.toMatchObject({ code: "DB_UPDATE_ROLLED_BACK" });

    expect(readFileSync(source, "utf8")).toBe("source");
    expect(existsSync(moved.targetPath)).toBe(false);
  });

  it("does not overwrite a file that appears at the original path before rollback", async () => {
    const sourceDirectory = path.join(tempDir, "source");
    const targetDirectory = path.join(tempDir, "target");
    mkdirSync(sourceDirectory);
    mkdirSync(targetDirectory);
    const source = path.join(sourceDirectory, "clip.mp4");
    writeFileSync(source, "source");
    const moved = await moveFileWithConflictResolution(source, targetDirectory);
    writeFileSync(source, "new-file-at-original-path");

    await expect(moved.rollback()).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(source, "utf8")).toBe("new-file-at-original-path");
    expect(readFileSync(moved.targetPath, "utf8")).toBe("source");
  });
});

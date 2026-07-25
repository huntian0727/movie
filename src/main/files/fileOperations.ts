import crypto from "node:crypto";
import { copyFile, link, open, rm, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

type RenameImpl = (oldPath: string, newPath: string) => Promise<void>;
type OpenImpl = (targetPath: string, flags: string) => Promise<{ close: () => Promise<void> }>;
type StatImpl = typeof stat;
type LinkImpl = typeof link;
type UnlinkImpl = typeof unlink;
type CopyFileImpl = typeof copyFile;

type FileOperationDependencies = {
  renameImpl?: RenameImpl;
  statImpl?: StatImpl;
  linkImpl?: LinkImpl;
  unlinkImpl?: UnlinkImpl;
  copyFileImpl?: CopyFileImpl;
};

export type MoveOperationDependencies = {
  statImpl?: StatImpl;
  linkImpl?: LinkImpl;
  unlinkImpl?: UnlinkImpl;
  copyFileImpl?: CopyFileImpl;
  openImpl?: OpenImpl;
};

export async function renamePreservingExtension(
  filePath: string,
  nextBaseName: string,
  dependencies: FileOperationDependencies = {}
): Promise<string> {
  const renameFile = dependencies.renameImpl ?? rename;
  const parsed = path.parse(filePath);
  const sanitized = sanitizeBaseName(nextBaseName);
  const nextPath = path.join(parsed.dir, `${sanitized}${parsed.ext}`);

  if (isSameResolvedPath(filePath, nextPath)) {
    return filePath;
  }

  if (isSameWindowsPathIgnoringCase(filePath, nextPath)) {
    await renameCaseOnlySafely(filePath, nextPath, renameFile);
    return nextPath;
  }

  try {
    await moveToExactAvailablePath(filePath, nextPath, dependencies);
  } catch (error) {
    throw mapRenameError(error);
  }

  return nextPath;
}

export async function commitRenameWithRollback<T>(
  originalPath: string,
  renamedPath: string,
  commit: () => T | Promise<T>
): Promise<T> {
  try {
    return await commit();
  } catch (commitError) {
    try {
      await renameExactWithoutOverwrite(renamedPath, originalPath);
    } catch (rollbackError) {
      const failure = new Error(`Database update failed and rename rollback failed: ${toErrorMessage(commitError)}; rollback: ${toErrorMessage(rollbackError)}`, { cause: commitError }) as Error & { code: string };
      failure.code = "DB_UPDATE_ROLLBACK_FAILED";
      throw failure;
    }
    const failure = new Error(`Database update failed; filename was restored: ${toErrorMessage(commitError)}`, { cause: commitError }) as Error & { code: string };
    failure.code = "DB_UPDATE_ROLLED_BACK";
    throw failure;
  }
}

export async function permanentlyDeleteFile(filePath: string): Promise<void> {
  await rm(filePath, { force: false });
}

export type MovePlan = "direct" | "rename" | "skip";

export interface MoveOperationResult {
  sourcePath: string;
  targetPath: string;
  plan: MovePlan;
  rollback(): Promise<void>;
}

export async function commitMoveWithRollback<T>(move: MoveOperationResult, commit: () => T | Promise<T>): Promise<T> {
  try {
    return await commit();
  } catch (commitError) {
    try {
      await move.rollback();
    } catch (rollbackError) {
      const failure = new Error(`Database update failed and file rollback failed: ${toErrorMessage(commitError)}; rollback: ${toErrorMessage(rollbackError)}`, { cause: commitError }) as Error & { code: string };
      failure.code = "DB_UPDATE_ROLLBACK_FAILED";
      throw failure;
    }
    const failure = new Error(`Database update failed; file was restored to its original path: ${toErrorMessage(commitError)}`, { cause: commitError }) as Error & { code: string };
    failure.code = "DB_UPDATE_ROLLED_BACK";
    throw failure;
  }
}

export async function inspectMoveTarget(
  filePath: string,
  targetDirectory: string,
  dependencies: Pick<MoveOperationDependencies, "statImpl"> = {}
): Promise<{ targetPath: string; plan: MovePlan }> {
  const statFile = dependencies.statImpl ?? stat;
  const source = await statFile(filePath);
  if (!source.isFile()) throw new Error("Move source is not a regular file");
  const targetFolder = await statFile(targetDirectory);
  if (!targetFolder.isDirectory()) throw new Error("Move target is not a directory");
  const parsed = path.parse(filePath);
  for (let index = 0; ; index += 1) {
    const targetPath = path.join(targetDirectory, `${parsed.name}${index === 0 ? "" : index}${parsed.ext}`);
    if (isSameMovePath(filePath, targetPath)) return { targetPath, plan: "skip" };
    try {
      await statFile(targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { targetPath, plan: index === 0 ? "direct" : "rename" };
      throw error;
    }
  }
}

export async function moveFileWithConflictResolution(
  filePath: string,
  targetDirectory: string,
  dependencies: MoveOperationDependencies = {}
): Promise<MoveOperationResult> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const move = await inspectMoveTarget(filePath, targetDirectory, dependencies);
    if (move.plan === "skip") {
      return { sourcePath: filePath, ...move, rollback: async () => undefined };
    }
    try {
      await moveToExactAvailablePath(filePath, move.targetPath, dependencies);
      return {
        sourcePath: filePath,
        ...move,
        rollback: async () => moveToExactAvailablePath(move.targetPath, filePath, dependencies)
      };
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) continue;
      throw error;
    }
  }
  throw new Error("Unable to find a safe destination name after 10000 attempts");
}

async function moveToExactAvailablePath(sourcePath: string, targetPath: string, dependencies: MoveOperationDependencies): Promise<void> {
  const statFile = dependencies.statImpl ?? stat;
  const linkFile = dependencies.linkImpl ?? link;
  const unlinkFile = dependencies.unlinkImpl ?? unlink;
  const sourceBefore = await statFile(sourcePath);
  if (!sourceBefore.isFile()) throw new Error("Move source is not a regular file");

  try {
    await linkFile(sourcePath, targetPath);
  } catch (error) {
    if (!isCrossVolumeOrUnsupportedLink(error)) throw error;
    await copyAcrossVolumesSafely(sourcePath, targetPath, sourceBefore.size, sourceBefore.mtime.toISOString(), dependencies);
    return;
  }

  try {
    await unlinkFile(sourcePath);
  } catch (error) {
    try {
      await unlinkFile(targetPath);
    } catch (rollbackError) {
      throw new Error(`Failed to remove move source and failed to roll back target: ${toErrorMessage(error)}; rollback: ${toErrorMessage(rollbackError)}`, { cause: error });
    }
    throw error;
  }
}

async function copyAcrossVolumesSafely(
  sourcePath: string,
  targetPath: string,
  expectedSize: number,
  expectedModifiedAt: string,
  dependencies: MoveOperationDependencies
): Promise<void> {
  const statFile = dependencies.statImpl ?? stat;
  const linkFile = dependencies.linkImpl ?? link;
  const unlinkFile = dependencies.unlinkImpl ?? unlink;
  const copy = dependencies.copyFileImpl ?? copyFile;
  const openFile = dependencies.openImpl ?? open;
  const tempPath = path.join(path.dirname(targetPath), `.video-manager-move-${crypto.randomUUID()}.tmp`);
  let targetCreated = false;
  let sourceRemoved = false;
  let tempCreated = false;

  try {
    const handle = await openFile(tempPath, "wx");
    tempCreated = true;
    await handle.close();
    await copy(sourcePath, tempPath);
    const [sourceAfter, copied] = await Promise.all([statFile(sourcePath), statFile(tempPath)]);
    if (!sourceAfter.isFile() || sourceAfter.size !== expectedSize || sourceAfter.mtime.toISOString() !== expectedModifiedAt) {
      throw new Error("Move source changed during copy");
    }
    if (!copied.isFile() || copied.size !== expectedSize) {
      throw new Error("Copied move file failed size verification");
    }

    await linkFile(tempPath, targetPath);
    targetCreated = true;
    await unlinkFile(tempPath);
    await unlinkFile(sourcePath);
    sourceRemoved = true;
  } catch (error) {
    if (targetCreated && !sourceRemoved) {
      try {
        await unlinkFile(targetPath);
      } catch (rollbackError) {
        throw new Error(`Failed to remove move source and failed to roll back copied target: ${toErrorMessage(error)}; rollback: ${toErrorMessage(rollbackError)}`, { cause: error });
      }
    }
    throw error;
  } finally {
    if (tempCreated) await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function isCrossVolumeOrUnsupportedLink(error: unknown): boolean {
  return ["EXDEV", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "");
}

function isErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSameMovePath(sourcePath: string, targetPath: string): boolean {
  return path.resolve(sourcePath).toLowerCase() === path.resolve(targetPath).toLowerCase();
}

async function renameExactWithoutOverwrite(sourcePath: string, targetPath: string, dependencies: FileOperationDependencies = {}): Promise<void> {
  if (isSameWindowsPathIgnoringCase(sourcePath, targetPath)) {
    await renameCaseOnlySafely(sourcePath, targetPath, dependencies.renameImpl ?? rename);
    return;
  }
  try {
    await moveToExactAvailablePath(sourcePath, targetPath, dependencies);
  } catch (error) {
    throw mapRenameError(error);
  }
}

async function renameCaseOnlySafely(sourcePath: string, targetPath: string, renameFile: RenameImpl): Promise<void> {
  const tempPath = path.join(path.dirname(sourcePath), `.video-manager-rename-${crypto.randomUUID()}.tmp`);
  try {
    await renameFile(sourcePath, tempPath);
  } catch (error) {
    throw mapRenameError(error);
  }

  try {
    await renameFile(tempPath, targetPath);
  } catch (error) {
    try {
      await renameFile(tempPath, sourcePath);
    } catch (rollbackError) {
      const failure = new Error(`Case-only rename failed and rollback failed: ${toErrorMessage(error)}; rollback: ${toErrorMessage(rollbackError)}`, { cause: error }) as Error & { code: string };
      failure.code = "RENAME_ROLLBACK_FAILED";
      throw failure;
    }
    throw mapRenameError(error);
  }
}

function mapRenameError(error: unknown): Error & { code: string } {
  const nodeCode = (error as NodeJS.ErrnoException).code;
  const code = nodeCode === "EEXIST"
    ? "TARGET_EXISTS"
    : nodeCode === "EACCES"
      ? "PERMISSION_DENIED"
      : nodeCode === "EPERM" || nodeCode === "EBUSY"
        ? "FILE_LOCKED"
        : nodeCode === "ENOENT"
          ? "SOURCE_NOT_FOUND"
          : "RENAME_FAILED";
  const failure = new Error(toErrorMessage(error), { cause: error }) as Error & { code: string };
  failure.code = code;
  return failure;
}

function sanitizeBaseName(input: string): string {
  const trimmed = input.trim();

  if (!input) {
    throw new Error("Filename cannot be empty");
  }

  if (trimmed !== input) {
    throw new Error("Filename cannot contain leading or trailing whitespace");
  }

  if (trimmed.endsWith(".")) {
    throw new Error("Filename cannot end with a dot");
  }

  if (/[\u0000-\u001F<>:"/\\|?*]/.test(trimmed)) {
    throw new Error("Filename contains invalid characters");
  }

  if (isReservedWindowsBaseName(trimmed)) {
    throw new Error("Filename uses a reserved Windows device name");
  }

  return trimmed;
}

function isReservedWindowsBaseName(input: string): boolean {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(input);
}

function isSameResolvedPath(sourcePath: string, destinationPath: string): boolean {
  return path.resolve(sourcePath) === path.resolve(destinationPath);
}

function isSameWindowsPathIgnoringCase(sourcePath: string, destinationPath: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  return path.resolve(sourcePath).toLowerCase() === path.resolve(destinationPath).toLowerCase();
}

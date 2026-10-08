import crypto from "node:crypto";
import path from "node:path";
import { link, lstat, realpath, rename, unlink } from "node:fs/promises";

interface ExpectedFile { sourceRoot: string; sizeBytes: number; modifiedAt: string }

/** Reject link/junction traversal even when a stored path is lexically in the library.
 * This intentionally fails closed for a reparse-based source directory. Ordinary
 * Windows mapped drives and UNC shares still resolve through their directory root. */
export async function assertManagedOrdinaryFile(filePath: string, sourceRoot: string) {
  const root = path.resolve(sourceRoot);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Refusing permanent deletion outside the enabled source folder.");
  }
  const ancestors: string[] = [];
  let current = path.dirname(target);
  while (true) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const directory of ancestors.reverse()) {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("Permanent deletion through a symbolic link or junction is blocked.");
    }
  }
  const [resolvedRoot, resolvedTarget, info] = await Promise.all([realpath(root), realpath(target), lstat(target)]);
  const resolvedRelative = path.relative(resolvedRoot, resolvedTarget);
  if (!resolvedRelative || resolvedRelative === ".." || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)
      || info.isSymbolicLink() || !info.isFile()) {
    throw new Error("Permanent deletion target is not an ordinary managed file.");
  }
  return info;
}

/** Isolate and recheck the same object; failures preserve it without overwriting a replacement. */
export async function permanentlyDeleteManagedFile(filePath: string, expected: ExpectedFile): Promise<void> {
  const before = await assertManagedOrdinaryFile(filePath, expected.sourceRoot);
  if (before.size !== expected.sizeBytes || before.mtime.toISOString() !== expected.modifiedAt) {
    throw new Error("File version changed after indexing; rescan before permanent deletion.");
  }
  const stable = `${before.dev}:${before.ino}:${before.birthtimeMs}`;
  const extension = path.extname(filePath);
  // Keep the video extension so an interruption retains a discoverable media file.
  const isolated = path.join(path.dirname(filePath), `.${path.basename(filePath, extension)}.movie-delete-${crypto.randomUUID()}${extension}`);
  await rename(filePath, isolated);
  try {
    const after = await assertManagedOrdinaryFile(isolated, expected.sourceRoot);
    if (`${after.dev}:${after.ino}:${after.birthtimeMs}` !== stable || after.size !== expected.sizeBytes
        || after.mtime.toISOString() !== expected.modifiedAt) {
      throw new Error("Isolated file identity or version changed; permanent deletion was stopped.");
    }
    await unlink(isolated);
  } catch (error) {
    try {
      await assertManagedOrdinaryFile(isolated, expected.sourceRoot);
      // Atomic no-overwrite restore: if another file appeared, retain isolated media.
      await link(isolated, filePath);
      await unlink(isolated);
    } catch {
      throw new Error(`Permanent deletion was stopped. Recoverable media may remain at ${isolated}.`, { cause: error });
    }
    throw error;
  }
}

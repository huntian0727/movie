import { opendir, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { isVideoExtension } from "../../shared/videoTypes.js";

const SKIPPED_SUFFIXES = [".crdownload", ".part", ".tmp"];
const DEFAULT_DIRECTORY_ENTRY_TIMEOUT_MS = 30_000;

type ReaddirImpl = (directory: string) => Promise<Dirent[]>;
export type DirectoryEntries = Iterable<Dirent> | AsyncIterable<Dirent>;

export interface FileDiscoveryDependencies {
  readdirImpl?: ReaddirImpl;
  directoryEntriesImpl?(directory: string): Promise<DirectoryEntries>;
  directoryEntryTimeoutMs?: number;
  beforeDirectory?(directory: string): void | Promise<void>;
  onDirectoryError?(directory: string, error: unknown): void;
}

export async function discoverVideoFiles(
  rootPath: string,
  recursive: boolean,
  dependencies: FileDiscoveryDependencies = {}
): Promise<string[]> {
  const results: string[] = [];
  for await (const filePath of streamVideoFiles(rootPath, recursive, dependencies)) {
    results.push(filePath);
  }
  return results.sort((left, right) => left.localeCompare(right));
}

export async function* streamVideoFiles(
  rootPath: string,
  recursive: boolean,
  dependencies: FileDiscoveryDependencies = {}
): AsyncGenerator<string> {
  yield* walk(rootPath, recursive, dependencies, true);
}

async function* walk(
  directory: string,
  recursive: boolean,
  dependencies: FileDiscoveryDependencies,
  isRoot: boolean
): AsyncGenerator<string> {
  await dependencies.beforeDirectory?.(directory);
  const timeoutMs = dependencies.directoryEntryTimeoutMs ?? DEFAULT_DIRECTORY_ENTRY_TIMEOUT_MS;
  let entries: DirectoryEntries;

  try {
    entries = await withTimeout(
      openDirectoryEntries(directory, dependencies),
      timeoutMs,
      directoryTimeoutMessage(directory, timeoutMs)
    );
  } catch (error) {
    if (isRoot) throw error;
    dependencies.onDirectoryError?.(directory, error);
    return;
  }

  const iterator = getIterator(entries);
  let finished = false;
  try {
    while (true) {
      let result: IteratorResult<Dirent>;
      try {
        result = await withTimeout(
          Promise.resolve(iterator.next()),
          timeoutMs,
          directoryTimeoutMessage(directory, timeoutMs)
        );
      } catch (error) {
        if (isRoot) throw error;
        dependencies.onDirectoryError?.(directory, error);
        return;
      }

      if (result.done) {
        finished = true;
        break;
      }

      const entry = result.value;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (recursive) yield* walk(fullPath, recursive, dependencies, false);
        continue;
      }
      if (!entry.isFile()) continue;

      const lowerName = entry.name.toLowerCase();
      if (SKIPPED_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) continue;
      if (isVideoExtension(entry.name)) yield fullPath;
    }
  } finally {
    if (!finished && iterator.return) {
      void Promise.resolve(iterator.return()).catch(() => undefined);
    }
  }
}

async function openDirectoryEntries(directory: string, dependencies: FileDiscoveryDependencies): Promise<DirectoryEntries> {
  if (dependencies.directoryEntriesImpl) return dependencies.directoryEntriesImpl(directory);
  if (dependencies.readdirImpl) return dependencies.readdirImpl(directory);
  return opendir(directory, { bufferSize: 128 });
}

function getIterator(entries: DirectoryEntries): AsyncIterator<Dirent> | Iterator<Dirent> {
  if (Symbol.asyncIterator in entries) return entries[Symbol.asyncIterator]();
  return entries[Symbol.iterator]();
}

function directoryTimeoutMessage(directory: string, timeoutMs: number): string {
  return `Directory stopped responding for ${timeoutMs / 1000}s: ${directory}`;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// Kept for tests and callers that need an eager directory listing implementation.
export async function readDirectoryEntries(directory: string): Promise<Dirent[]> {
  return readdir(directory, { withFileTypes: true });
}

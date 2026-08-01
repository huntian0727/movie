import { opendir, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { execFile } from "node:child_process";
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
  emptyDirectoryProbeImpl?(directory: string): Promise<boolean>;
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

export async function openDirectoryEntries(directory: string, dependencies: FileDiscoveryDependencies = {}): Promise<DirectoryEntries> {
  try {
    const entries = dependencies.directoryEntriesImpl
      ? await dependencies.directoryEntriesImpl(directory)
      : dependencies.readdirImpl
        ? await dependencies.readdirImpl(directory)
        : await opendir(directory, { bufferSize: 128 });
    return recoverMappedDriveEmptyDirectory(directory, entries, dependencies);
  } catch (error) {
    if (await canTreatProviderErrorAsEmpty(directory, error, dependencies)) return [];
    throw error;
  }
}

async function* recoverMappedDriveEmptyDirectory(
  directory: string,
  entries: DirectoryEntries,
  dependencies: FileDiscoveryDependencies
): AsyncGenerator<Dirent> {
  const iterator = getIterator(entries);
  let yielded = false;
  let finished = false;
  try {
    while (true) {
      let next: IteratorResult<Dirent>;
      try {
        next = await iterator.next();
      } catch (error) {
        if (!yielded && await canTreatProviderErrorAsEmpty(directory, error, dependencies)) {
          finished = true;
          return;
        }
        throw error;
      }
      if (next.done) {
        finished = true;
        return;
      }
      yielded = true;
      yield next.value;
    }
  } finally {
    if (!finished && iterator.return) {
      void Promise.resolve(iterator.return()).catch(() => undefined);
    }
  }
}

async function canTreatProviderErrorAsEmpty(
  directory: string,
  error: unknown,
  dependencies: FileDiscoveryDependencies
): Promise<boolean> {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code !== "ENOENT" && code !== "EINVAL") return false;
  if (dependencies.emptyDirectoryProbeImpl) return dependencies.emptyDirectoryProbeImpl(directory);
  if (process.platform !== "win32") return false;
  return probeEmptyDirectoryWithPowerShell(directory);
}

function probeEmptyDirectoryWithPowerShell(directory: string): Promise<boolean> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
    "$entry = Get-ChildItem -LiteralPath $env:VIDEO_MANAGER_DIRECTORY_PROBE_PATH -Force | Select-Object -First 1",
    "if ($null -eq $entry) { [Console]::Out.Write('EMPTY') } else { [Console]::Out.Write('NOT_EMPTY') }"
  ].join("; ");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, VIDEO_MANAGER_DIRECTORY_PROBE_PATH: directory },
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 16 * 1024
    }, (error, stdout) => resolve(!error && stdout.trim() === "EMPTY"));
  });
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

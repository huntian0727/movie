import path from "node:path";
import type { SourceFolder } from "../../shared/videoTypes.js";
import {
  CloudDriveGrpcClient,
  HINT_PRIORITY,
  type ByteRange,
  type CloudDriveMountPoint,
  type HintPriority
} from "./grpcClient.js";
import { CloudDriveRateLimiter } from "./rateLimiter.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:19798";
const DEFAULT_TIMEOUT_MS = 20_000;
const EPOCH = new Date(0).toISOString();

/**
 * Default QPS cap for CloudDrive gRPC calls. 115 reports ~5 QPS;
 * we conservatively use 4 to leave headroom for WinFSP reads.
 * Override via LOCAL_VIDEO_MANAGER_CLOUDDRIVE_QPS.
 */
const DEFAULT_QPS_LIMIT = 4;

export interface CloudDriveScanFileInfo {
  sizeBytes: number;
  modifiedAt: string;
}

export interface CloudDriveDirectoryEntry {
  name: string;
  kind: "file" | "directory" | "other";
  scanIdentity: string;
  fileInfo?: CloudDriveScanFileInfo;
}

export interface CloudDriveDirectoryListing {
  entries: CloudDriveDirectoryEntry[];
  directoryMtime: string;
}

export interface MountedCloudDriveDirectorySource {
  readDirectory(localDirectory: string, isCancelled?: () => boolean): Promise<CloudDriveDirectoryListing>;
}

interface CloudDriveEnvironmentConfig {
  endpoint: string;
  apiToken: string;
  timeoutMs: number;
  qpsLimit: number;
  manualMounts: CloudDriveMountPoint[] | null;
}

export interface MountMapping {
  mountPoint: CloudDriveMountPoint;
  localRoot: string;
  remoteRoot: string;
  pathApi: typeof path.win32 | typeof path.posix;
}

let sharedClientKey = "";
let sharedClient: CloudDriveGrpcClient | null = null;
let sharedRateLimiter: CloudDriveRateLimiter | null = null;
let cachedMountPointsKey = "";
let cachedMountPoints: CloudDriveMountPoint[] = [];

export async function tryCreateMountedCloudDriveDirectorySource(
  sourceFolder: SourceFolder,
  env: NodeJS.ProcessEnv = process.env,
  isCancelled?: () => boolean
): Promise<MountedCloudDriveDirectorySource | null> {
  const config = readEnvironmentConfig(env);
  if (!config) return null;
  const client = getSharedClient(config);
  let mountPoints: CloudDriveMountPoint[];
  try {
    mountPoints = config.manualMounts ?? await client.getMountPoints(isCancelled);
    if (!config.manualMounts) {
      cachedMountPointsKey = sharedClientKey;
      cachedMountPoints = mountPoints;
    }
  } catch (error) {
    if (isCancelled?.()) throw error;
    if (cachedMountPointsKey !== sharedClientKey || cachedMountPoints.length === 0) return null;
    mountPoints = cachedMountPoints;
  }
  const mapping = findMountMapping(sourceFolder.path, mountPoints);
  if (!mapping) return null;
  return createDirectorySource(client, mapping);
}

export function findMountMapping(localPath: string, mountPoints: CloudDriveMountPoint[]): MountMapping | null {
  let best: MountMapping | null = null;
  for (const mountPoint of mountPoints) {
    if (!mountPoint.isMounted || !mountPoint.mountPoint || !mountPoint.sourceDir) continue;
    const pathApi = choosePathApi(localPath, mountPoint.mountPoint);
    const localRoot = normalizeLocalRoot(mountPoint.mountPoint, pathApi);
    const normalizedTarget = pathApi.resolve(localPath);
    const relative = pathApi.relative(localRoot, normalizedTarget);
    if (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) continue;
    const remoteRoot = joinRemotePath(mountPoint.sourceDir, relative);
    const candidate = { mountPoint, localRoot, remoteRoot, pathApi };
    if (!best || candidate.localRoot.length > best.localRoot.length) best = candidate;
  }
  return best;
}

function createDirectorySource(
  client: CloudDriveGrpcClient,
  mapping: MountMapping
): MountedCloudDriveDirectorySource {
  const sourceLocalRoot = mapping.pathApi.resolve(mapping.localRoot, ...remoteRelativeParts(
    mapping.mountPoint.sourceDir,
    mapping.remoteRoot
  ));
  return {
    async readDirectory(localDirectory, isCancelled) {
      const normalizedDirectory = mapping.pathApi.resolve(localDirectory);
      const relative = mapping.pathApi.relative(sourceLocalRoot, normalizedDirectory);
      if (relative === ".." || relative.startsWith(`..${mapping.pathApi.sep}`) || mapping.pathApi.isAbsolute(relative)) {
        throw new Error("CloudDrive scanner refused a directory outside its source folder");
      }
      const remoteDirectory = joinRemotePath(mapping.remoteRoot, relative);
      const entries: CloudDriveDirectoryEntry[] = [];
      const entryNames = new Set<string>();
      let directoryMtime = EPOCH;
      for await (const entry of client.getSubFiles(remoteDirectory, false, isCancelled)) {
        const entryName = entry.name || posixBasename(entry.fullPathName);
        if (!isSafeEntryName(entryName, mapping.pathApi)) {
          throw new Error(`CloudDrive returned an unsafe directory entry name for ${remoteDirectory}`);
        }
        const normalizedName = mapping.pathApi.normalize(entryName).toLocaleLowerCase();
        if (entryNames.has(normalizedName)) {
          throw new Error(`CloudDrive returned duplicate directory entries for ${remoteDirectory}`);
        }
        entryNames.add(normalizedName);
        const modifiedAt = entry.writeTime ?? entry.createTime ?? EPOCH;
        if (modifiedAt > directoryMtime) directoryMtime = modifiedAt;
        const kind = entry.isDirectory ? "directory" : entry.fileType === 1 ? "file" : "other";
        entries.push({
          name: entryName,
          kind,
          scanIdentity: `${kind}:${entry.sizeBytes}:${modifiedAt}`,
          fileInfo: kind === "file" ? { sizeBytes: entry.sizeBytes, modifiedAt } : undefined
        });
      }
      return { entries, directoryMtime };
    }
  };
}

function readEnvironmentConfig(env: NodeJS.ProcessEnv): CloudDriveEnvironmentConfig | null {
  const apiToken = (env.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TOKEN ?? "").trim();
  if (!apiToken) return null;
  const endpoint = (env.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_ENDPOINT ?? DEFAULT_ENDPOINT).trim();
  const parsedTimeout = Number(env.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? Math.trunc(parsedTimeout) : DEFAULT_TIMEOUT_MS;
  const parsedQps = Number(env.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_QPS ?? DEFAULT_QPS_LIMIT);
  const qpsLimit = Number.isFinite(parsedQps) && parsedQps > 0 ? parsedQps : DEFAULT_QPS_LIMIT;
  return { endpoint, apiToken, timeoutMs, qpsLimit, manualMounts: parseManualMounts(env.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_MOUNT_MAP) };
}

function parseManualMounts(raw: string | undefined): CloudDriveMountPoint[] | null {
  if (!raw?.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid LOCAL_VIDEO_MANAGER_CLOUDDRIVE_MOUNT_MAP JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(value)) throw new Error("LOCAL_VIDEO_MANAGER_CLOUDDRIVE_MOUNT_MAP must be a JSON array");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`CloudDrive mount map entry ${index} must be an object`);
    const mountPoint = "mountPoint" in entry ? String(entry.mountPoint) : "";
    const sourceDir = "sourceDir" in entry ? String(entry.sourceDir) : "";
    if (!mountPoint || !sourceDir) throw new Error(`CloudDrive mount map entry ${index} requires mountPoint and sourceDir`);
    return {
      mountPoint,
      sourceDir,
      readOnly: "readOnly" in entry ? Boolean(entry.readOnly) : false,
      isMounted: "isMounted" in entry ? Boolean(entry.isMounted) : true,
      failReason: "",
      name: ""
    };
  });
}

function getSharedClient(config: CloudDriveEnvironmentConfig): CloudDriveGrpcClient {
  const key = `${config.endpoint}\n${config.apiToken}\n${config.timeoutMs}\n${config.qpsLimit}`;
  if (sharedClient && sharedClientKey === key) return sharedClient;
  sharedClient?.close();
  sharedRateLimiter?.close();
  sharedClientKey = key;
  sharedRateLimiter = new CloudDriveRateLimiter(config.qpsLimit);
  sharedClient = new CloudDriveGrpcClient({
    endpoint: config.endpoint,
    apiToken: config.apiToken,
    timeoutMs: config.timeoutMs,
    rateLimiter: sharedRateLimiter
  });
  return sharedClient;
}

/**
 * Best-effort: tell CloudDrive2 the client will not read this local path again
 * soon, so it can release the server-side EntryReader (download buffer and
 * threads) immediately instead of waiting out the default 2-second window.
 *
 * Resolves to `true` when the path was resolved to a mounted cloud drive and
 * the CloseFileReader RPC was attempted (success or failure). Resolves to
 * `false` when the path is not under a known mount or no cloud token is
 * configured. Never throws: CloseFileReader is an advisory hint.
 */
export async function tryReleaseCloudDriveReader(localPath: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const config = readEnvironmentConfig(env);
  if (!config) return false;
  try {
    const client = getSharedClient(config);
    let mountPoints = cachedMountPointsKey === sharedClientKey ? cachedMountPoints : [];
    if (mountPoints.length === 0) {
      try {
        mountPoints = config.manualMounts ?? await client.getMountPoints();
        cachedMountPointsKey = sharedClientKey;
        cachedMountPoints = mountPoints;
      } catch {
        return false;
      }
    }
    const mapping = findMountMapping(localPath, mountPoints);
    if (!mapping) return false;
    const sourceLocalRoot = mapping.pathApi.resolve(mapping.localRoot, ...remoteRelativeParts(
      mapping.mountPoint.sourceDir,
      mapping.remoteRoot
    ));
    const relative = mapping.pathApi.relative(sourceLocalRoot, mapping.pathApi.resolve(localPath));
    if (relative === ".." || relative.startsWith(`..${mapping.pathApi.sep}`) || mapping.pathApi.isAbsolute(relative)) {
      return false;
    }
    const remotePath = joinRemotePath(mapping.remoteRoot, relative);
    await client.closeFileReader(remotePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true when the local path resolves to a currently-mounted CloudDrive2
 * source. Used to switch metadata probing to the tighter cloud profile.
 */
export function isCloudDrivePath(localPath: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const config = readEnvironmentConfig(env);
  if (!config) return false;
  // If we have cached mount points from a prior scan, use them; otherwise the
  // path cannot be cheaply classified without a network call. The scanner
  // populates the cache when it creates the directory source.
  if (cachedMountPointsKey !== sharedClientKey || cachedMountPoints.length === 0) return false;
  return findMountMapping(localPath, cachedMountPoints) !== null;
}

/**
 * Best-effort prefetch hint for a local file on a mounted CloudDrive2 source.
 * Resolves local path → remote path via mount mapping, then sends PrefetchFileRanges.
 * Never throws — prefetch is purely advisory.
 *
 * @returns hint ID on success (for later cancellation), or 0 when the path is
 *          not on a cloud drive / the RPC failed / no token is configured.
 */
export async function tryPrefetchFileRanges(
  localPath: string,
  ranges: ByteRange[],
  priority: HintPriority = HINT_PRIORITY.NORMAL,
  options?: { ttlSeconds?: number; replaceExisting?: boolean },
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  if (ranges.length === 0) return 0;
  const config = readEnvironmentConfig(env);
  if (!config) return 0;
  try {
    const client = getSharedClient(config);
    const mountPoints = await getMountPointsForHint(client, config);
    if (mountPoints.length === 0) return 0;
    const remotePath = resolveRemotePath(localPath, mountPoints);
    if (!remotePath) return 0;
    const result = await client.prefetchFileRanges(remotePath, ranges, priority, options);
    return result.hintId;
  } catch {
    return 0;
  }
}

/**
 * Best-effort cancel of prefetch hints on a local file path.
 * If hintIds is empty/omitted, cancels ALL hints on that path.
 */
export async function tryCancelFilePrefetch(
  localPath: string,
  hintIds?: number[],
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const config = readEnvironmentConfig(env);
  if (!config) return false;
  try {
    const client = getSharedClient(config);
    const mountPoints = await getMountPointsForHint(client, config);
    if (mountPoints.length === 0) return false;
    const remotePath = resolveRemotePath(localPath, mountPoints);
    if (!remotePath) return false;
    await client.cancelFilePrefetch(remotePath, hintIds);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a local file path to its remote path via mount mapping.
 * Returns null if the path is not under a known mounted source.
 */
function resolveRemotePath(localPath: string, mountPoints: CloudDriveMountPoint[]): string | null {
  const mapping = findMountMapping(localPath, mountPoints);
  if (!mapping) return null;
  const sourceLocalRoot = mapping.pathApi.resolve(mapping.localRoot, ...remoteRelativeParts(
    mapping.mountPoint.sourceDir,
    mapping.remoteRoot
  ));
  const relative = mapping.pathApi.relative(sourceLocalRoot, mapping.pathApi.resolve(localPath));
  if (relative === ".." || relative.startsWith(`..${mapping.pathApi.sep}`) || mapping.pathApi.isAbsolute(relative)) {
    return null;
  }
  return joinRemotePath(mapping.remoteRoot, relative);
}

async function getMountPointsForHint(
  client: CloudDriveGrpcClient,
  config: CloudDriveEnvironmentConfig
): Promise<CloudDriveMountPoint[]> {
  if (cachedMountPointsKey === sharedClientKey && cachedMountPoints.length > 0) return cachedMountPoints;
  if (config.manualMounts) return config.manualMounts;
  try {
    const mountPoints = await client.getMountPoints();
    cachedMountPointsKey = sharedClientKey;
    cachedMountPoints = mountPoints;
    return mountPoints;
  } catch {
    return [];
  }
}

function choosePathApi(localPath: string, mountPoint: string): typeof path.win32 | typeof path.posix {
  return looksLikeWindowsPath(localPath) || looksLikeWindowsPath(mountPoint) ? path.win32 : path.posix;
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:([\\/]|$)/.test(value) || value.startsWith("\\\\");
}

function normalizeLocalRoot(value: string, pathApi: typeof path.win32 | typeof path.posix): string {
  if (pathApi === path.win32 && /^[a-zA-Z]:$/.test(value)) return `${value}\\`;
  return pathApi.resolve(value);
}

function joinRemotePath(root: string, relative: string): string {
  const rootValue = root.replace(/\\/g, "/") || "/";
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  const joined = path.posix.join(rootValue, ...parts);
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function remoteRelativeParts(sourceDir: string, remoteRoot: string): string[] {
  return path.posix.relative(normalizeRemotePath(sourceDir), normalizeRemotePath(remoteRoot)).split("/").filter(Boolean);
}

function normalizeRemotePath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/") || "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function posixBasename(value: string): string {
  return path.posix.basename(value.replace(/\\/g, "/"));
}

function isSafeEntryName(value: string, pathApi: typeof path.win32 | typeof path.posix): boolean {
  return Boolean(value && value !== "." && value !== ".." && pathApi.basename(value) === value && !/[\\/]/.test(value));
}

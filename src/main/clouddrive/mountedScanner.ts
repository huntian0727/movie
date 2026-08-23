import path from "node:path";
import type { SourceFolder } from "../../shared/videoTypes.js";
import { CloudDriveGrpcClient, type CloudDriveMountPoint } from "./grpcClient.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:19798";
const DEFAULT_TIMEOUT_MS = 20_000;
const EPOCH = new Date(0).toISOString();

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

export type CloudDriveMissingConfirmation = "missing" | "present" | "not-cloud-drive";

interface CloudDriveEnvironmentConfig {
  endpoint: string;
  apiToken: string;
  timeoutMs: number;
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
    cachedMountPointsKey = sharedClientKey;
    cachedMountPoints = mountPoints;
  } catch (error) {
    if (isCancelled?.()) throw error;
    if (cachedMountPointsKey !== sharedClientKey || cachedMountPoints.length === 0) return null;
    mountPoints = cachedMountPoints;
  }
  const mapping = findMountMapping(sourceFolder.path, mountPoints);
  if (!mapping) return null;
  return createDirectorySource(client, mapping);
}

/**
 * Confirms absence by force-refreshing and fully listing the remote parent.
 * Errors and cancellation reject and must never be treated as proof of absence.
 */
export async function confirmMountedCloudDriveFileMissing(
  localFilePath: string,
  env: NodeJS.ProcessEnv = process.env,
  isCancelled?: () => boolean
): Promise<CloudDriveMissingConfirmation> {
  const config = readEnvironmentConfig(env);
  if (!config) return "not-cloud-drive";
  const client = getSharedClient(config);
  const mountPoints = config.manualMounts ?? await client.getMountPoints(isCancelled);
  const mapping = findMountMapping(localFilePath, mountPoints);
  if (!mapping) return "not-cloud-drive";

  const normalizedFilePath = mapping.pathApi.resolve(localFilePath);
  const localParent = mapping.pathApi.dirname(normalizedFilePath);
  const relativeParent = mapping.pathApi.relative(mapping.localRoot, localParent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${mapping.pathApi.sep}`) || mapping.pathApi.isAbsolute(relativeParent)) {
    return "not-cloud-drive";
  }
  const remoteParent = joinRemotePath(mapping.mountPoint.sourceDir, relativeParent);
  const expectedName = mapping.pathApi.basename(normalizedFilePath).normalize("NFC").toLocaleLowerCase();
  for await (const entry of client.getSubFiles(remoteParent, true, isCancelled)) {
    const entryName = entry.name || posixBasename(entry.fullPathName);
    if (!isSafeEntryName(entryName, mapping.pathApi)) {
      throw new Error(`CloudDrive returned an unsafe directory entry name for ${remoteParent}`);
    }
    if (entryName.normalize("NFC").toLocaleLowerCase() === expectedName) return "present";
  }
  return "missing";
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
  return { endpoint, apiToken, timeoutMs, manualMounts: parseManualMounts(env.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_MOUNT_MAP) };
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
  const key = `${config.endpoint}\n${config.apiToken}\n${config.timeoutMs}\n${JSON.stringify(config.manualMounts)}`;
  if (sharedClient && sharedClientKey === key) return sharedClient;
  sharedClient?.close();
  sharedClientKey = key;
  sharedClient = new CloudDriveGrpcClient({ endpoint: config.endpoint, apiToken: config.apiToken, timeoutMs: config.timeoutMs });
  return sharedClient;
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

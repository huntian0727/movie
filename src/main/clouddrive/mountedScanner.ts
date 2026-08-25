import path from "node:path";
import type {
  CloudDriveBrowseDirectory,
  CloudDriveBrowseRoot,
  CloudDriveConnectionSettings,
  CloudDriveConnectionTestResult,
  CloudDriveSourceSelection,
  SourceFolder
} from "../../shared/videoTypes.js";
import { isVideoExtension } from "../../shared/videoTypes.js";
import { CloudDriveGrpcClient, type CloudDriveMountPoint } from "./grpcClient.js";
import type { CloudDriveFileOperationResult } from "./grpcClient.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:19798";
const DEFAULT_TIMEOUT_MS = 20_000;
const DIRECTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VALIDATION_DIRECTORY_CONCURRENCY = 4;
const EPOCH = new Date(0).toISOString();

export interface CloudDriveScanFileInfo {
  sizeBytes: number;
  modifiedAt: string;
  providerFileId?: string;
  providerPath?: string;
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
  provider?: {
    type: "clouddrive";
    rootPath: string;
    name: string;
    readOnly: boolean;
  };
  readDirectory(localDirectory: string, isCancelled?: () => boolean): Promise<CloudDriveDirectoryListing>;
}

export type CloudDriveMissingConfirmation = "missing" | "present" | "not-cloud-drive";

export async function deleteCloudDriveFiles(
  remotePaths: readonly string[],
  permanently = true,
  env: NodeJS.ProcessEnv = process.env,
  isCancelled?: () => boolean
): Promise<CloudDriveFileOperationResult> {
  const config = readEnvironmentConfig(env);
  if (!config) throw new Error("CloudDrive API token is not configured");
  const client = getSharedClient(config);
  try {
    return await client.deleteFiles(remotePaths, permanently, isCancelled);
  } catch (error) {
    if (!permanently || !isPermanentDeleteUnsupported(error)) throw error;
    return client.deleteFiles(remotePaths, false, isCancelled);
  }
}

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
const directoryListingCache = new Map<string, { expiresAt: number; listing: CloudDriveDirectoryListing }>();
let runtimeEnvironment: NodeJS.ProcessEnv | null = null;

export function configureCloudDriveRuntime(
  settings: CloudDriveConnectionSettings,
  fallbackEnvironment: NodeJS.ProcessEnv = process.env
): void {
  const savedToken = settings.apiToken.trim();
  runtimeEnvironment = { ...fallbackEnvironment };
  if (savedToken) {
    runtimeEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TOKEN = savedToken;
    runtimeEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_ENDPOINT = settings.endpoint.trim();
    runtimeEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TIMEOUT_MS = String(settings.timeoutMs);
    if (settings.mountMapJson.trim()) {
      runtimeEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_MOUNT_MAP = settings.mountMapJson.trim();
    } else {
      delete runtimeEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_MOUNT_MAP;
    }
  }
  resetCloudDriveCaches();
}

export async function testConfiguredCloudDriveConnection(): Promise<CloudDriveConnectionTestResult> {
  const config = readEnvironmentConfig(process.env);
  if (!config) throw new Error("尚未配置 CloudDrive API Token，请先在设置中填写并保存");
  const client = getSharedClient(config);
  const apiMountPoints = await client.getMountPoints();
  const effectiveMountPoints = config.manualMounts ?? apiMountPoints;
  return {
    endpoint: config.endpoint,
    apiMountPointCount: apiMountPoints.length,
    effectiveMountPointCount: effectiveMountPoints.length,
    mountedMountPointCount: effectiveMountPoints.filter((mountPoint) => mountPoint.isMounted).length,
    mountPoints: effectiveMountPoints.map((mountPoint) => ({
      mountPoint: mountPoint.mountPoint,
      sourceDir: mountPoint.sourceDir,
      name: mountPoint.name,
      readOnly: mountPoint.readOnly,
      isMounted: mountPoint.isMounted
    }))
  };
}

export async function listConfiguredCloudDriveFolderRoots(
  env: NodeJS.ProcessEnv = process.env,
  isCancelled?: () => boolean
): Promise<CloudDriveBrowseRoot[]> {
  const config = readEnvironmentConfig(env);
  if (!config) throw new Error("尚未配置 CloudDrive API Token，请先在设置中填写并保存");
  const client = getSharedClient(config);
  const mountPoints = await loadMountPoints(config, client, isCancelled);
  return mountPoints
    .filter((mountPoint) => mountPoint.isMounted && mountPoint.mountPoint && mountPoint.sourceDir)
    .map((mountPoint) => ({
      mountPoint: mountPoint.mountPoint,
      remotePath: normalizeRemotePath(mountPoint.sourceDir),
      name: mountPoint.name || "CloudDrive",
      readOnly: mountPoint.readOnly
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN") || left.remotePath.localeCompare(right.remotePath));
}

export async function browseConfiguredCloudDriveFolder(
  selection: CloudDriveSourceSelection,
  env: NodeJS.ProcessEnv = process.env,
  isCancelled?: () => boolean
): Promise<CloudDriveBrowseDirectory> {
  const config = readEnvironmentConfig(env);
  if (!config) throw new Error("尚未配置 CloudDrive API Token，请先在设置中填写并保存");
  const client = getSharedClient(config);
  const mountPoints = await loadMountPoints(config, client, isCancelled);
  const resolved = resolveCloudDriveSourceSelection(selection, mountPoints);
  const directories: CloudDriveBrowseDirectory["directories"] = [];
  let directFileCount = 0;
  let directVideoCount = 0;
  for await (const entry of client.getSubFiles(resolved.remotePath, false, isCancelled)) {
    throwIfCancelled(isCancelled);
    const entryName = entry.name || posixBasename(entry.fullPathName);
    if (!isSafeEntryName(entryName, resolved.pathApi)) {
      throw new Error(`CloudDrive returned an unsafe directory entry name for ${resolved.remotePath}`);
    }
    if (entry.isDirectory) {
      directories.push({ name: entryName, remotePath: joinRemotePath(resolved.remotePath, entryName) });
    } else if (entry.fileType === 1) {
      directFileCount += 1;
      if (isVideoExtension(entryName)) directVideoCount += 1;
    }
  }
  directories.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
  const parentRemotePath = resolved.remotePath === resolved.rootRemotePath
    ? null
    : path.posix.dirname(resolved.remotePath);
  return {
    mountPoint: resolved.mountPoint.mountPoint,
    localPath: resolved.localPath,
    remotePath: resolved.remotePath,
    rootRemotePath: resolved.rootRemotePath,
    parentRemotePath,
    name: resolved.mountPoint.name || "CloudDrive",
    readOnly: resolved.mountPoint.readOnly,
    directories,
    directFileCount,
    directVideoCount
  };
}

export async function resolveConfiguredCloudDriveFolder(
  selection: CloudDriveSourceSelection,
  env: NodeJS.ProcessEnv = process.env,
  isCancelled?: () => boolean
): Promise<{ localPath: string; remotePath: string; name: string; readOnly: boolean }> {
  const config = readEnvironmentConfig(env);
  if (!config) throw new Error("尚未配置 CloudDrive API Token，请先在设置中填写并保存");
  const client = getSharedClient(config);
  const mountPoints = await loadMountPoints(config, client, isCancelled);
  const resolved = resolveCloudDriveSourceSelection(selection, mountPoints);
  return {
    localPath: resolved.localPath,
    remotePath: resolved.remotePath,
    name: resolved.mountPoint.name || "CloudDrive",
    readOnly: resolved.mountPoint.readOnly
  };
}

export function resolveCloudDriveSourceSelection(
  selection: CloudDriveSourceSelection,
  mountPoints: readonly CloudDriveMountPoint[]
): {
  mountPoint: CloudDriveMountPoint;
  localPath: string;
  remotePath: string;
  rootRemotePath: string;
  pathApi: typeof path.win32 | typeof path.posix;
} {
  const requestedMount = selection.mountPoint.trim();
  const remotePath = normalizeRemotePath(selection.remotePath);
  const matchingMounts = mountPoints
    .filter((candidate) =>
      candidate.isMounted && candidate.mountPoint && candidate.sourceDir &&
      normalizeMountPointIdentity(candidate.mountPoint) === normalizeMountPointIdentity(requestedMount)
    )
    .map((mountPoint) => ({ mountPoint, rootRemotePath: normalizeRemotePath(mountPoint.sourceDir) }))
    .filter(({ rootRemotePath }) => isRemotePathWithin(remotePath, rootRemotePath))
    .sort((left, right) => right.rootRemotePath.length - left.rootRemotePath.length);
  const selectedMount = matchingMounts[0];
  if (!selectedMount) {
    const mountExists = mountPoints.some((candidate) =>
      candidate.isMounted && candidate.mountPoint &&
      normalizeMountPointIdentity(candidate.mountPoint) === normalizeMountPointIdentity(requestedMount)
    );
    if (mountExists) throw new Error("所选远端目录不属于该 CloudDrive 挂载点");
    throw new Error("所选 CloudDrive 挂载点已离线或不存在，请刷新后重试");
  }
  const { mountPoint, rootRemotePath } = selectedMount;
  const relative = path.posix.relative(rootRemotePath, remotePath);
  const pathApi = choosePathApi(mountPoint.mountPoint, mountPoint.mountPoint);
  const localRoot = normalizeLocalRoot(mountPoint.mountPoint, pathApi);
  const localPath = pathApi.resolve(localRoot, ...relative.split("/").filter(Boolean));
  return { mountPoint, localPath, remotePath, rootRemotePath, pathApi };
}

export async function tryCreateMountedCloudDriveDirectorySource(
  sourceFolder: SourceFolder,
  env: NodeJS.ProcessEnv = process.env,
  isCancelled?: () => boolean,
  forceRefresh = false
): Promise<MountedCloudDriveDirectorySource | null> {
  const sources = await createMountedCloudDriveDirectorySources([sourceFolder], env, isCancelled, forceRefresh);
  return sources.get(sourceFolder.id) ?? null;
}

export async function createMountedCloudDriveDirectorySources(
  sourceFolders: readonly SourceFolder[],
  env: NodeJS.ProcessEnv = process.env,
  isCancelled?: () => boolean,
  forceRefresh = false,
  throwOnUnavailable = false
): Promise<Map<string, MountedCloudDriveDirectorySource>> {
  const config = readEnvironmentConfig(env);
  if (!config) {
    if (throwOnUnavailable) throw new Error("尚未配置 CloudDrive API Token，请先到设置页完成配置和连接测试");
    return new Map();
  }
  const client = getSharedClient(config);
  let mountPoints: CloudDriveMountPoint[];
  try {
    mountPoints = await loadMountPoints(config, client, isCancelled);
  } catch (error) {
    if (isCancelled?.() || throwOnUnavailable) throw error;
    return new Map();
  }
  const sources = new Map<string, MountedCloudDriveDirectorySource>();
  for (const sourceFolder of sourceFolders) {
    const mapping = findMountMapping(sourceFolder.path, mountPoints);
    if (mapping) sources.set(sourceFolder.id, createDirectorySource(client, mapping, forceRefresh));
  }
  return sources;
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
  return confirmCloudDriveFileMissingFromListing(localFilePath, mountPoints, (remoteParent, cancelled) =>
    client.getSubFiles(remoteParent, true, cancelled), isCancelled);
}

/**
 * Confirms many mounted CloudDrive paths while listing each remote parent only
 * once. The complete validation finishes before callers are allowed to mutate
 * library records, so a failed or cancelled stream cannot become proof that a
 * file is absent.
 */
export async function confirmMountedCloudDriveFilesMissing(
  localFilePaths: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  isCancelled?: () => boolean
): Promise<Map<string, CloudDriveMissingConfirmation>> {
  const config = readEnvironmentConfig(env);
  if (!config) return new Map(localFilePaths.map((filePath) => [filePath, "not-cloud-drive"]));
  const client = getSharedClient(config);
  const mountPoints = config.manualMounts ?? await client.getMountPoints(isCancelled);
  return confirmCloudDriveFilesMissingFromListing(
    localFilePaths,
    mountPoints,
    (remoteParent, cancelled) => client.getSubFiles(remoteParent, true, cancelled),
    isCancelled
  );
}

export async function confirmCloudDriveFilesMissingFromListing(
  localFilePaths: readonly string[],
  mountPoints: CloudDriveMountPoint[],
  listParent: (remoteParent: string, isCancelled?: () => boolean) => AsyncIterable<{ name: string; fullPathName: string }>,
  isCancelled?: () => boolean
): Promise<Map<string, CloudDriveMissingConfirmation>> {
  interface ParentGroup {
    remoteParent: string;
    pathApi: typeof path.win32 | typeof path.posix;
    files: Array<{ localFilePath: string; expectedName: string }>;
  }

  const results = new Map<string, CloudDriveMissingConfirmation>();
  const groups = new Map<string, ParentGroup>();
  for (const localFilePath of [...new Set(localFilePaths)]) {
    throwIfCancelled(isCancelled);
    const mapping = findMountMapping(localFilePath, mountPoints);
    if (!mapping) {
      results.set(localFilePath, "not-cloud-drive");
      continue;
    }
    const normalizedFilePath = mapping.pathApi.resolve(localFilePath);
    const localParent = mapping.pathApi.dirname(normalizedFilePath);
    const relativeParent = mapping.pathApi.relative(mapping.localRoot, localParent);
    if (relativeParent === ".." || relativeParent.startsWith(`..${mapping.pathApi.sep}`) || mapping.pathApi.isAbsolute(relativeParent)) {
      results.set(localFilePath, "not-cloud-drive");
      continue;
    }
    const remoteParent = joinRemotePath(mapping.mountPoint.sourceDir, relativeParent);
    const groupKey = `${mapping.pathApi === path.win32 ? "win32" : "posix"}\n${normalizeRemotePath(remoteParent)}`;
    const group = groups.get(groupKey) ?? { remoteParent, pathApi: mapping.pathApi, files: [] };
    group.files.push({
      localFilePath,
      expectedName: mapping.pathApi.basename(normalizedFilePath).normalize("NFC").toLocaleLowerCase()
    });
    groups.set(groupKey, group);
  }

  await forEachWithConcurrency([...groups.values()], MAX_VALIDATION_DIRECTORY_CONCURRENCY, async (group) => {
    throwIfCancelled(isCancelled);
    const remoteNames = new Set<string>();
    for await (const entry of listParent(group.remoteParent, isCancelled)) {
      throwIfCancelled(isCancelled);
      const entryName = entry.name || posixBasename(entry.fullPathName);
      if (!isSafeEntryName(entryName, group.pathApi)) {
        throw new Error(`CloudDrive returned an unsafe directory entry name for ${group.remoteParent}`);
      }
      remoteNames.add(entryName.normalize("NFC").toLocaleLowerCase());
    }
    for (const file of group.files) {
      results.set(file.localFilePath, remoteNames.has(file.expectedName) ? "present" : "missing");
    }
  });
  return results;
}

export async function confirmCloudDriveFileMissingFromListing(
  localFilePath: string,
  mountPoints: CloudDriveMountPoint[],
  listParent: (remoteParent: string, isCancelled?: () => boolean) => AsyncIterable<{ name: string; fullPathName: string }>,
  isCancelled?: () => boolean
): Promise<CloudDriveMissingConfirmation> {
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
  for await (const entry of listParent(remoteParent, isCancelled)) {
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
  mapping: MountMapping,
  forceRefresh: boolean
): MountedCloudDriveDirectorySource {
  const sourceLocalRoot = mapping.pathApi.resolve(mapping.localRoot, ...remoteRelativeParts(
    mapping.mountPoint.sourceDir,
    mapping.remoteRoot
  ));
  return {
    provider: {
      type: "clouddrive",
      rootPath: mapping.remoteRoot,
      name: mapping.mountPoint.name || "CloudDrive",
      readOnly: mapping.mountPoint.readOnly
    },
    async readDirectory(localDirectory, isCancelled) {
      const normalizedDirectory = mapping.pathApi.resolve(localDirectory);
      const relative = mapping.pathApi.relative(sourceLocalRoot, normalizedDirectory);
      if (relative === ".." || relative.startsWith(`..${mapping.pathApi.sep}`) || mapping.pathApi.isAbsolute(relative)) {
        throw new Error("CloudDrive scanner refused a directory outside its source folder");
      }
      const remoteDirectory = joinRemotePath(mapping.remoteRoot, relative);
      const cacheKey = `${sharedClientKey}\n${normalizeRemotePath(remoteDirectory)}`;
      const cached = directoryListingCache.get(cacheKey);
      if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.listing;
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
          scanIdentity: `${kind}:${entry.id}:${entry.sizeBytes}:${modifiedAt}`,
          fileInfo: kind === "file" ? {
            sizeBytes: entry.sizeBytes,
            modifiedAt,
            providerFileId: entry.id,
            providerPath: entry.fullPathName || joinRemotePath(remoteDirectory, entryName)
          } : undefined
        });
      }
      const listing = { entries, directoryMtime };
      directoryListingCache.set(cacheKey, { expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS, listing });
      return listing;
    }
  };
}

function readEnvironmentConfig(env: NodeJS.ProcessEnv): CloudDriveEnvironmentConfig | null {
  const effectiveEnvironment = env === process.env && runtimeEnvironment ? runtimeEnvironment : env;
  const apiToken = (effectiveEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TOKEN ?? "").trim();
  if (!apiToken) return null;
  const endpoint = (effectiveEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_ENDPOINT ?? DEFAULT_ENDPOINT).trim();
  const parsedTimeout = Number(effectiveEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? Math.trunc(parsedTimeout) : DEFAULT_TIMEOUT_MS;
  return { endpoint, apiToken, timeoutMs, manualMounts: parseManualMounts(effectiveEnvironment.LOCAL_VIDEO_MANAGER_CLOUDDRIVE_MOUNT_MAP) };
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
  directoryListingCache.clear();
  sharedClientKey = key;
  sharedClient = new CloudDriveGrpcClient({ endpoint: config.endpoint, apiToken: config.apiToken, timeoutMs: config.timeoutMs });
  return sharedClient;
}

function resetCloudDriveCaches(): void {
  sharedClient?.close();
  sharedClient = null;
  sharedClientKey = "";
  cachedMountPointsKey = "";
  cachedMountPoints = [];
  directoryListingCache.clear();
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

function normalizeMountPointIdentity(value: string): string {
  const pathApi = choosePathApi(value, value);
  return normalizeLocalRoot(value, pathApi).replace(/[\\/]+$/, "").toLocaleLowerCase();
}

function isRemotePathWithin(targetPath: string, rootPath: string): boolean {
  const relative = path.posix.relative(rootPath, targetPath);
  return relative !== ".." && !relative.startsWith("../") && !path.posix.isAbsolute(relative);
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

async function loadMountPoints(
  config: CloudDriveEnvironmentConfig,
  client: CloudDriveGrpcClient,
  isCancelled?: () => boolean
): Promise<CloudDriveMountPoint[]> {
  if (config.manualMounts) return config.manualMounts;
  try {
    const mountPoints = await client.getMountPoints(isCancelled);
    cachedMountPointsKey = sharedClientKey;
    cachedMountPoints = mountPoints;
    return mountPoints;
  } catch (error) {
    if (isCancelled?.()) throw error;
    if (cachedMountPointsKey !== sharedClientKey || cachedMountPoints.length === 0) throw error;
    return cachedMountPoints;
  }
}

function isPermanentDeleteUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /gRPC\s+12\b|UNIMPLEMENTED|not implemented|method not found/i.test(message);
}

function throwIfCancelled(isCancelled?: () => boolean): void {
  if (!isCancelled?.()) return;
  const error = new Error("CloudDrive validation cancelled") as Error & { code: string };
  error.code = "ABORT_ERR";
  throw error;
}

async function forEachWithConcurrency<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]!);
    }
  }));
}

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const FORMAT_VERSION = 1;
const DATABASE_FILE = "library.sqlite";
const SETTINGS_FILE = "settings.json";

export async function createSnapshot(options) {
  const createdAt = options.now?.toISOString() ?? new Date().toISOString();
  const backupRoot = path.resolve(options.backupRoot);
  const userDataPath = path.resolve(options.userDataPath);
  const sourceDatabasePath = path.join(userDataPath, DATABASE_FILE);
  await access(sourceDatabasePath);
  await mkdir(backupRoot, { recursive: true });

  const id = await createUniqueSnapshotId(backupRoot, createdAt, options.label ?? "manual");
  const temporaryDirectory = path.join(backupRoot, `.${id}.partial-${process.pid}`);
  const snapshotDirectory = path.join(backupRoot, id);
  await mkdir(temporaryDirectory, { recursive: false });

  let sourceDatabase;
  try {
    sourceDatabase = new DatabaseSync(sourceDatabasePath, { readOnly: true });
    assertDatabaseIntegrity(sourceDatabase, "source database");
    const databasePath = path.join(temporaryDirectory, DATABASE_FILE);
    await backup(sourceDatabase, databasePath, { rate: 1_000 });
    sourceDatabase.close();
    sourceDatabase = undefined;

    const databaseInfo = await inspectDatabaseFile(databasePath);
    const files = {
      database: await describeFile(databasePath, DATABASE_FILE),
      settings: null,
      sourceBundle: null,
      installer: null
    };

    const settingsSource = path.join(userDataPath, SETTINGS_FILE);
    if (await pathExists(settingsSource)) {
      const settingsDestination = path.join(temporaryDirectory, SETTINGS_FILE);
      await copyFile(settingsSource, settingsDestination);
      files.settings = await describeFile(settingsDestination, SETTINGS_FILE);
    }
    if (options.sourceBundlePath) {
      const sourceBundleDestination = path.join(temporaryDirectory, "source.bundle");
      await copyFile(path.resolve(options.sourceBundlePath), sourceBundleDestination);
      files.sourceBundle = await describeFile(sourceBundleDestination, "source.bundle");
    }
    if (options.installerPath) {
      const installerName = path.basename(options.installerPath);
      const installerDestination = path.join(temporaryDirectory, installerName);
      await copyFile(path.resolve(options.installerPath), installerDestination);
      files.installer = await describeFile(installerDestination, installerName);
    }

    const manifest = {
      formatVersion: FORMAT_VERSION,
      id,
      createdAt,
      kind: options.kind ?? "development",
      label: options.label ?? "manual",
      application: {
        version: options.appVersion ?? null
      },
      git: {
        branch: options.gitBranch ?? null,
        commit: options.gitCommit ?? null,
        tag: options.gitTag ?? null,
        tagPush: options.gitTagPush ?? null,
        repository: options.gitRepository ?? null,
        dirty: Boolean(options.gitDirty)
      },
      database: databaseInfo,
      files,
      settingsContainsSecrets: Boolean(files.settings),
      excluded: ["video files", "media-cache", "logs", "Electron caches", "node_modules", "build output"]
    };
    await writeJsonAtomic(path.join(temporaryDirectory, "manifest.json"), manifest);
    await rename(temporaryDirectory, snapshotDirectory);
    await refreshIndex(backupRoot);
    return { snapshotDirectory, manifest };
  } catch (error) {
    sourceDatabase?.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function listSnapshots(backupRoot) {
  const resolvedRoot = path.resolve(backupRoot);
  if (!(await pathExists(resolvedRoot))) return [];
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const snapshots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifestPath = path.join(resolvedRoot, entry.name, "manifest.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (manifest.formatVersion !== FORMAT_VERSION || manifest.id !== entry.name) continue;
      snapshots.push({ directory: path.join(resolvedRoot, entry.name), manifest });
    } catch {
      // Ignore incomplete or unrelated directories; verification reports exact failures.
    }
  }
  return snapshots.sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
}

export async function verifySnapshot(backupRoot, snapshotId) {
  const snapshotDirectory = resolveSnapshotDirectory(backupRoot, snapshotId);
  const manifest = JSON.parse(await readFile(path.join(snapshotDirectory, "manifest.json"), "utf8"));
  if (manifest.formatVersion !== FORMAT_VERSION) throw new Error(`Unsupported backup format: ${manifest.formatVersion}`);
  if (manifest.id !== path.basename(snapshotDirectory)) throw new Error("Backup manifest id does not match its directory");

  for (const file of Object.values(manifest.files ?? {})) {
    if (!file) continue;
    const filePath = path.join(snapshotDirectory, file.name);
    const actual = await describeFile(filePath, file.name);
    if (actual.sizeBytes !== file.sizeBytes) throw new Error(`Backup file size mismatch: ${file.name}`);
    if (actual.sha256 !== file.sha256) throw new Error(`Backup file checksum mismatch: ${file.name}`);
  }
  const databasePath = path.join(snapshotDirectory, manifest.files.database.name);
  const databaseInfo = await inspectDatabaseFile(databasePath);
  if (databaseInfo.schemaVersion !== manifest.database.schemaVersion) throw new Error("Backup database schema version mismatch");
  return { snapshotDirectory, manifest, databaseInfo };
}

export async function restoreSnapshot(options) {
  if (!options.confirmApplicationClosed) {
    throw new Error("Restore refused: use the PowerShell wrapper after closing every Local Video Manager process");
  }
  const verified = await verifySnapshot(options.backupRoot, options.snapshotId);
  const preRestore = await createSnapshot({
    ...options,
    kind: "pre-restore",
    label: `before-restore-${verified.manifest.id}`,
    installerPath: undefined,
    sourceBundlePath: undefined
  });

  const userDataPath = path.resolve(options.userDataPath);
  await mkdir(userDataPath, { recursive: true });
  const transactionDirectory = path.join(userDataPath, `.restore-${Date.now()}-${process.pid}`);
  const originalDirectory = path.join(transactionDirectory, "original");
  const replacementDirectory = path.join(transactionDirectory, "replacement");
  await mkdir(originalDirectory, { recursive: true });
  await mkdir(replacementDirectory, { recursive: true });

  const databaseTarget = path.join(userDataPath, DATABASE_FILE);
  const settingsTarget = path.join(userDataPath, SETTINGS_FILE);
  const databaseReplacement = path.join(replacementDirectory, DATABASE_FILE);
  await copyFile(path.join(verified.snapshotDirectory, verified.manifest.files.database.name), databaseReplacement);
  await inspectDatabaseFile(databaseReplacement);

  const hasSettings = Boolean(verified.manifest.files.settings);
  const settingsReplacement = path.join(replacementDirectory, SETTINGS_FILE);
  if (hasSettings) {
    await copyFile(path.join(verified.snapshotDirectory, verified.manifest.files.settings.name), settingsReplacement);
    JSON.parse(await readFile(settingsReplacement, "utf8"));
  }

  const originalFiles = [DATABASE_FILE, `${DATABASE_FILE}-wal`, `${DATABASE_FILE}-shm`];
  if (hasSettings) originalFiles.push(SETTINGS_FILE);
  try {
    await writeJsonAtomic(path.join(transactionDirectory, "restore-journal.json"), {
      snapshotId: verified.manifest.id,
      preRestoreSnapshotId: preRestore.manifest.id,
      createdAt: new Date().toISOString(),
      state: "prepared"
    });
    for (const fileName of originalFiles) {
      const target = path.join(userDataPath, fileName);
      if (await pathExists(target)) await rename(target, path.join(originalDirectory, fileName));
    }
    await rename(databaseReplacement, databaseTarget);
    if (hasSettings) await rename(settingsReplacement, settingsTarget);
    await inspectDatabaseFile(databaseTarget);
    await rm(transactionDirectory, { recursive: true, force: true });
    return {
      restoredSnapshotId: verified.manifest.id,
      preRestoreSnapshotId: preRestore.manifest.id,
      databasePath: databaseTarget,
      settingsRestored: hasSettings
    };
  } catch (error) {
    await rm(databaseTarget, { force: true });
    if (hasSettings) await rm(settingsTarget, { force: true });
    for (const fileName of originalFiles) {
      const originalPath = path.join(originalDirectory, fileName);
      if (await pathExists(originalPath)) await rename(originalPath, path.join(userDataPath, fileName));
    }
    throw new Error(`Restore failed and the original files were put back: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function inspectDatabaseFile(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assertDatabaseIntegrity(database, databasePath);
    return {
      schemaVersion: Number(firstValue(database.prepare("PRAGMA user_version").get()) ?? 0),
      videoCount: tableExists(database, "videos") ? Number(firstValue(database.prepare("SELECT COUNT(*) FROM videos").get()) ?? 0) : 0,
      sourceCount: tableExists(database, "source_folders") ? Number(firstValue(database.prepare("SELECT COUNT(*) FROM source_folders").get()) ?? 0) : 0,
      scanFailureCount: tableExists(database, "scan_failures") ? Number(firstValue(database.prepare("SELECT COUNT(*) FROM scan_failures WHERE status = 'unresolved'").get()) ?? 0) : 0,
      quickCheck: "ok"
    };
  } finally {
    database.close();
  }
}

function assertDatabaseIntegrity(database, label) {
  const result = String(firstValue(database.prepare("PRAGMA quick_check").get()) ?? "");
  if (result.toLowerCase() !== "ok") throw new Error(`SQLite quick_check failed for ${label}: ${result}`);
}

function tableExists(database, tableName) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function firstValue(row) {
  return row && typeof row === "object" ? Object.values(row)[0] : undefined;
}

async function describeFile(filePath, name) {
  const fileStat = await stat(filePath);
  return { name, sizeBytes: fileStat.size, sha256: await sha256File(filePath) };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function createUniqueSnapshotId(backupRoot, createdAt, label) {
  const timestamp = createdAt.replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  const safeLabel = String(label).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-").slice(0, 80) || "manual";
  const base = `${timestamp}_${safeLabel}`;
  let candidate = base;
  let suffix = 1;
  while (await pathExists(path.join(backupRoot, candidate))) candidate = `${base}-${suffix++}`;
  return candidate;
}

function resolveSnapshotDirectory(backupRoot, snapshotId) {
  const root = path.resolve(backupRoot);
  const resolved = path.resolve(root, snapshotId);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Snapshot must be a direct child of the configured backup root");
  return resolved;
}

async function refreshIndex(backupRoot) {
  const snapshots = await listSnapshots(backupRoot);
  const index = {
    formatVersion: FORMAT_VERSION,
    updatedAt: new Date().toISOString(),
    snapshots: snapshots.map(({ manifest }) => ({
      id: manifest.id,
      createdAt: manifest.createdAt,
      kind: manifest.kind,
      label: manifest.label,
      gitCommit: manifest.git?.commit ?? null,
      gitTag: manifest.git?.tag ?? null,
      schemaVersion: manifest.database?.schemaVersion ?? null,
      databaseSizeBytes: manifest.files?.database?.sizeBytes ?? null,
      hasInstaller: Boolean(manifest.files?.installer)
    }))
  };
  await writeJsonAtomic(path.join(backupRoot, "backup-index.json"), index);
}

async function writeJsonAtomic(targetPath, value) {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(targetPath, { force: true });
  await rename(temporaryPath, targetPath);
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function defaultUserDataPath() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "local-video-manager")
    : path.join(os.homedir(), ".local-video-manager");
}

function defaultBackupRoot() {
  return path.join(os.homedir(), "Documents", "映匣备份");
}

async function main() {
  const { values } = parseArgs({
    options: {
      action: { type: "string", default: "list" },
      "backup-root": { type: "string", default: defaultBackupRoot() },
      "user-data": { type: "string", default: defaultUserDataPath() },
      snapshot: { type: "string" },
      label: { type: "string", default: "manual" },
      kind: { type: "string", default: "development" },
      "git-branch": { type: "string" },
      "git-commit": { type: "string" },
      "git-tag": { type: "string" },
      "git-tag-push": { type: "string" },
      "git-repository": { type: "string" },
      "git-dirty": { type: "boolean", default: false },
      "app-version": { type: "string" },
      "source-bundle": { type: "string" },
      installer: { type: "string" },
      "result-file": { type: "string" },
      "confirm-application-closed": { type: "boolean", default: false }
    },
    strict: true
  });
  const common = {
    backupRoot: values["backup-root"],
    userDataPath: values["user-data"],
    label: values.label,
    kind: values.kind,
    gitBranch: values["git-branch"],
    gitCommit: values["git-commit"],
    gitTag: values["git-tag"],
    gitTagPush: values["git-tag-push"],
    gitRepository: values["git-repository"],
    gitDirty: values["git-dirty"],
    appVersion: values["app-version"],
    sourceBundlePath: values["source-bundle"],
    installerPath: values.installer
  };
  let result;
  if (values.action === "create") result = await createSnapshot(common);
  else if (values.action === "list") result = await listSnapshots(common.backupRoot);
  else if (values.action === "verify") {
    if (!values.snapshot) throw new Error("--snapshot is required for verify");
    result = await verifySnapshot(common.backupRoot, values.snapshot);
  } else if (values.action === "restore") {
    if (!values.snapshot) throw new Error("--snapshot is required for restore");
    result = await restoreSnapshot({ ...common, snapshotId: values.snapshot, confirmApplicationClosed: values["confirm-application-closed"] });
  } else {
    throw new Error(`Unsupported action: ${values.action}`);
  }
  const serializedResult = `${JSON.stringify(result, null, 2)}\n`;
  if (values["result-file"]) {
    await mkdir(path.dirname(values["result-file"]), { recursive: true });
    await writeFile(values["result-file"], serializedResult, "utf8");
  } else {
    process.stdout.write(serializedResult);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

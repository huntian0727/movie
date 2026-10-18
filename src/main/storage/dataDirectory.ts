import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import type { DataStoragePreview, DataStorageStatus } from "../../shared/dataStorage.js";

const absolutePath = z.string().min(1).max(32767).refine(value => path.isAbsolute(value));
const pendingSchema = z.object({ id: z.string().uuid(), source: absolutePath, target: absolutePath }).strict();
const stateSchema = z.object({
  version: z.literal(1), current: absolutePath,
  pending: pendingSchema.optional(), cleanup: pendingSchema.optional(), message: z.string().max(2000).optional()
}).strict();
type State = z.infer<typeof stateSchema>;
type Migration = z.infer<typeof pendingSchema>;
interface Entry { relative: string; bytes: number; sha256: string }
const receiptName = ".data-migration-receipt.json";
const receiptSchema = z.object({
  version: z.literal(1), migration: pendingSchema,
  original: z.array(z.object({ relative: z.string(), bytes: z.number(), sha256: z.string() }).strict()),
  copied: z.array(z.object({ relative: z.string(), bytes: z.number(), sha256: z.string() }).strict())
}).strict();
// Only these application-owned entries move. Chromium session caches, arbitrary
// user files, source videos, exported files and the fixed locator stay put.
const managedNames = new Set([
  "library.sqlite", "library.sqlite-wal", "library.sqlite-shm", "library.sqlite.backups",
  "settings.json", "clouddrive-credentials.bin", "subtitle-credentials.bin",
  "subtitles", "media-cache", "logs", ".data-directory-owner.json"
]);
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
export function containsDirectory(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if (isMissing(error)) return false; throw error; }
}
async function hash(file: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
async function flushFile(file: string): Promise<void> {
  const handle = await open(file, "r+");
  try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value), "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => undefined); }
}
async function requireRealDirectory(directory: string): Promise<string> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("请选择实际文件夹，不能使用链接或联接目录。");
  const canonical = await realpath(directory);
  // Reject junctions in ancestors, too. This keeps path boundaries and cleanup stable.
  if (path.resolve(canonical).toLowerCase() !== path.resolve(directory).toLowerCase()) {
    throw new Error("目录路径经过链接或联接，请选择实际路径。");
  }
  return canonical;
}
async function inventory(root: string, digest: boolean): Promise<Entry[]> {
  const entries: Entry[] = [];
  async function visit(relative: string): Promise<void> {
    const file = path.join(root, relative);
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error("应用数据中存在链接或联接，已停止迁移并保留原数据。");
    if (info.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await visit(path.join(relative, name));
    } else if (info.isFile()) {
      entries.push({ relative, bytes: info.size, sha256: digest ? await hash(file) : "" });
    } else throw new Error("应用数据包含不支持的文件类型，已停止迁移。");
  }
  for (const name of (await readdir(root)).sort()) {
    if (managedNames.has(name.toLowerCase())) await visit(name);
  }
  // Legacy app media previews share a case-insensitive directory with Chromium.
  for (const category of ["covers", "timeline"]) {
    const relative = path.join("cache", category);
    if (await exists(path.join(root, relative))) await visit(relative);
  }
  return entries;
}
function safeEntry(root: string, relative: string): string {
  const file = path.resolve(root, relative);
  const parts = relative.split(/[\\/]/);
  const first = parts[0].toLowerCase();
  if (path.isAbsolute(relative) || parts.includes("..") || !containsDirectory(root, file) || file === root ||
      !(managedNames.has(first) || (first === "cache" && ["covers", "timeline"].includes(parts[1]?.toLowerCase())))) {
    throw new Error("迁移清单无效，原数据已保留。");
  }
  return file;
}
async function validateEntries(root: string, entries: Entry[]): Promise<void> {
  await requireRealDirectory(root);
  for (const entry of entries) {
    const file = safeEntry(root, entry.relative);
    const actual = await realpath(file);
    if (!containsDirectory(root, actual)) throw new Error("迁移文件越出数据目录，已停止。");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.bytes || await hash(file) !== entry.sha256) {
      throw new Error("迁移文件校验失败，原数据已保留。");
    }
  }
}
async function checkDatabase(file: string, source?: string, target?: string): Promise<void> {
  if (!(await exists(file))) throw new Error("资料库文件缺失，已停止迁移。");
  const db = new Database(file, { fileMustExist: true });
  try {
    if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("资料库完整性检查失败。");
    if (source && target) {
      // Update only app asset references, never source media paths or folder paths.
      const relocate = (value: string): string => {
        for (const prefix of [path.join(source, "media-cache"), path.join(source, "cache", "covers"), path.join(source, "cache", "timeline")]) {
          if (containsDirectory(prefix, value)) {
            const relative = path.relative(source, value);
            return path.join(target, relative.toLowerCase().startsWith(`cache${path.sep}`) ? path.join("media-cache", relative.slice(6)) : relative);
          }
        }
        return value;
      };
      db.function("relocate_app_asset", { deterministic: true }, relocate);
      db.transaction(() => {
        db.exec("UPDATE videos SET cover_cache_path = relocate_app_asset(cover_cache_path) WHERE cover_cache_path IS NOT NULL AND cover_cache_path IS NOT relocate_app_asset(cover_cache_path)");
        db.exec("UPDATE timeline_previews SET cache_path = relocate_app_asset(cache_path) WHERE cache_path IS NOT relocate_app_asset(cache_path)");
      })();
      db.pragma("wal_checkpoint(TRUNCATE)");
      if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("迁移后资料库检查失败。");
    }
  } finally { db.close(); }
}

export class DataDirectoryUnavailableError extends Error {}

export class DataDirectoryManager {
  private state!: State;
  private preview: DataStoragePreview | undefined;
  private releaseLock: (() => Promise<void>) | undefined;
  private scheduling = false;
  readonly locatorFile: string;
  constructor(readonly defaultDirectory: string, private readonly programDirectory?: string) {
    this.locatorFile = path.join(defaultDirectory, "data-location.json");
  }
  private async save(next: State): Promise<void> {
    await atomicJson(this.locatorFile, next);
    this.state = next;
  }
  async initialize(): Promise<void> {
    await mkdir(this.defaultDirectory, { recursive: true });
    await requireRealDirectory(this.defaultDirectory);
    try { this.state = stateSchema.parse(JSON.parse(await readFile(this.locatorFile, "utf8"))); }
    catch (error) {
      if (!isMissing(error)) throw new Error("数据目录定位记录无法读取。请保留 data-location.json 并修复记录，不会创建空资料库。");
      this.state = { version: 1, current: this.defaultDirectory };
    }
    if (this.state.current !== this.defaultDirectory) {
      await requireRealDirectory(this.state.current).catch(() => { throw new DataDirectoryUnavailableError(`数据目录不可用：${this.state.current}\n请连接磁盘或重新定位已有资料库；不会创建空资料库。`); });
      if (!(await exists(path.join(this.state.current, "library.sqlite")))) throw new DataDirectoryUnavailableError("所选数据目录中的资料库缺失，不会创建空资料库。");
    }
    await this.lockCurrentDirectory();
    await this.verifyOwner(this.state.current, true);
  }
  private async verifyOwner(root: string, allowCreate: boolean): Promise<void> {
    const ownerFile = path.join(root, ".data-directory-owner.json");
    const expected = path.basename(this.defaultDirectory);
    if (!(await exists(ownerFile)) && allowCreate) {
      await atomicJson(ownerFile, { version: 1, profile: expected }); return;
    }
    const owner = JSON.parse(await readFile(ownerFile, "utf8"));
    if (owner.version !== 1 || owner.profile !== expected) throw new Error("该资料库属于其他发行身份，不能合并或接管。");
  }
  async recoverExistingDirectory(directory: string): Promise<void> {
    const current = await requireRealDirectory(directory);
    const release = await this.lockDirectory(current);
    try {
      await this.verifyOwner(current, false);
      await checkDatabase(path.join(current, "library.sqlite"), this.state.current, current);
      await this.save({ version: 1, current, message: "已重新定位已有资料库。旧位置保留的文件未自动清理。" });
      this.releaseLock = release;
    } catch (error) { await release(); throw error; }
  }
  private async lockDirectory(root: string): Promise<() => Promise<void>> {
    const lock = path.join(root, ".data-directory.lock");
    const token = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(lock, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync(); }
        finally { await handle.close(); }
        return async () => {
          try { if (JSON.parse(await readFile(lock, "utf8")).token === token) await unlink(lock); }
          catch { /* Keep an unrecognized lock rather than remove another instance's lock. */ }
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let owner: { pid: number };
        try { owner = JSON.parse(await readFile(lock, "utf8")); }
        catch { throw new Error("数据目录锁无法确认，请关闭其他程序并保留现场检查。"); }
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error("数据目录锁无效，请保留现场检查。");
        try { process.kill(owner.pid, 0); throw new Error("资料库正在由另一个程序使用，请先关闭其他实例。"); }
        catch (probeError) {
          if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") throw probeError;
        }
        await unlink(lock);
      }
    }
    throw new Error("无法取得数据目录独占锁。");
  }
  private async lockCurrentDirectory(): Promise<void> {
    this.releaseLock = await this.lockDirectory(this.state.current);
  }
  async dispose(): Promise<void> { await this.releaseLock?.(); this.releaseLock = undefined; }
  getStatus(): DataStorageStatus {
    return { currentDirectory: this.state.current, defaultDirectory: this.defaultDirectory, message: this.state.message ?? null };
  }
  private stage(migration: Migration): string { return path.join(path.dirname(migration.target), `.movie-migration-${migration.id}`); }
  private async validateTarget(source: string, target: string): Promise<void> {
    await requireRealDirectory(source);
    await requireRealDirectory(path.dirname(target));
    if (containsDirectory(source, target) || containsDirectory(target, source) ||
        containsDirectory(target, this.defaultDirectory) || containsDirectory(this.defaultDirectory, target) ||
        (this.programDirectory && (containsDirectory(this.programDirectory, target) || containsDirectory(target, this.programDirectory)))) {
      throw new Error("新目录不能与当前目录、默认目录或程序目录重叠或相互嵌套。");
    }
    if (await exists(target)) throw new Error("目标数据文件夹已经存在，请选择其他位置；不会覆盖或合并资料库。");
  }
  async choose(parentDirectory: string): Promise<DataStoragePreview> {
    if (this.scheduling) throw new Error("迁移已安排，请等待程序重启。");
    const parent = await requireRealDirectory(parentDirectory);
    const target = path.join(parent, `映匣数据-${path.basename(this.defaultDirectory)}`);
    await this.validateTarget(this.state.current, target);
    const entries = await inventory(this.state.current, false);
    const totalBytes = entries.reduce((sum, item) => sum + item.bytes, 0);
    const space = await statfs(parent);
    const availableBytes = space.bavail * space.bsize;
    const databaseBytes = entries.find(entry => entry.relative.toLowerCase() === "library.sqlite")?.bytes ?? 0;
    if (availableBytes < totalBytes + databaseBytes * 2 + 64 * 1024 * 1024) throw new Error("目标磁盘空间不足，请预留数据大小及资料库校验处理空间。");
    const probe = path.join(parent, `.movie-write-test-${randomUUID()}`);
    const handle = await open(probe, "wx"); await handle.close(); await unlink(probe);
    this.preview = { token: randomUUID(), sourceDirectory: this.state.current, targetDirectory: target, fileCount: entries.length, totalBytes, availableBytes };
    return { ...this.preview };
  }
  async schedule(token: string): Promise<void> {
    if (this.scheduling || !this.preview || token !== this.preview.token) throw new Error("迁移预览已失效，请重新选择目录。");
    if (this.state.cleanup) throw new Error("上次迁移的原数据尚未完成清理，请重新启动后再迁移。");
    this.scheduling = true;
    try {
      await this.validateTarget(this.state.current, this.preview.targetDirectory);
      await this.save({ version: 1, current: this.state.current, pending: { id: randomUUID(), source: this.state.current, target: this.preview.targetDirectory } });
      this.preview = undefined;
    } catch (error) { this.scheduling = false; throw error; }
  }
  async prepareStartup(onProgress: (message: string) => void = () => undefined): Promise<void> {
    const migration = this.state.pending;
    if (!migration) return;
    if (migration.source !== this.state.current || containsDirectory(migration.source, migration.target) || containsDirectory(migration.target, migration.source)) {
      throw new Error("迁移记录不一致，请保留现场检查；不会创建空资料库。");
    }
    onProgress("正在迁移应用数据，请勿关闭程序或断开磁盘…");
    const stage = this.stage(migration);
    let targetRelease: (() => Promise<void>) | undefined;
    try {
      // A fully verified directory may have been published just before interruption.
      if (await exists(migration.target)) {
        const receipt = await this.readReceipt(migration.target, migration);
        targetRelease = await this.lockDirectory(migration.target);
        await validateEntries(migration.target, receipt.copied);
        await checkDatabase(path.join(migration.target, "library.sqlite"));
      } else {
        await this.validateTarget(migration.source, migration.target);
        // An interrupted partial stage is retained. Each retry gets a new stage,
        // so user files or corrupt partial files are never recursively removed.
        if (await exists(stage)) {
          const retry = { ...migration, id: randomUUID() };
          await this.save({ ...this.state, pending: retry });
          return this.prepareStartup(onProgress);
        }
        await mkdir(stage);
        const original = await inventory(migration.source, true);
        const required = original.reduce((sum, item) => sum + item.bytes, 0) +
          (original.find(entry => entry.relative.toLowerCase() === "library.sqlite")?.bytes ?? 0) * 2 + 64 * 1024 * 1024;
        const space = await statfs(path.dirname(stage));
        if (space.bavail * space.bsize < required) throw new Error("目标磁盘空间不足。");
        for (let index = 0; index < original.length; index++) {
          const entry = original[index];
          const destination = safeEntry(stage, entry.relative);
          await mkdir(path.dirname(destination), { recursive: true });
          await copyFile(safeEntry(migration.source, entry.relative), destination, 1);
          await flushFile(destination);
          if (index % 100 === 0) onProgress(`正在复制 ${index + 1} / ${original.length} 个文件…`);
        }
        onProgress("正在校验文件和资料库…");
        await validateEntries(stage, original);
        await checkDatabase(path.join(stage, "library.sqlite"), migration.source, migration.target);
        await flushFile(path.join(stage, "library.sqlite"));
        const copied = await inventory(stage, true);
        await atomicJson(path.join(stage, receiptName), { version: 1, migration, original, copied });
        // No replacement: rename fails if somebody creates a non-empty target.
        if (await exists(migration.target)) throw new Error("目标目录在迁移中已被占用。");
        await rename(stage, migration.target);
        targetRelease = await this.lockDirectory(migration.target);
      }
      await this.save({ version: 1, current: migration.target, cleanup: migration, message: "迁移已完成，正在验证启动并清理原应用数据。" });
      await this.dispose();
      this.releaseLock = targetRelease;
      targetRelease = undefined;
    } catch {
      await targetRelease?.();
      // Fixed public message; raw native errors may contain private filenames.
      await this.save({ version: 1, current: migration.source, message: `迁移未完成，继续使用原数据。原数据已保留；新位置可能留有迁移副本，请检查权限、可用空间和磁盘连接后重新选择。目标：${migration.target}` });
    }
  }
  private async readReceipt(root: string, migration: Migration) {
    await requireRealDirectory(root);
    const receipt = receiptSchema.parse(JSON.parse(await readFile(path.join(root, receiptName), "utf8")));
    if (JSON.stringify(receipt.migration) !== JSON.stringify(migration)) throw new Error("迁移凭据不匹配。");
    return receipt;
  }
  async finishStartup(): Promise<void> {
    const migration = this.state.cleanup;
    if (!migration) return;
    let releaseSource: (() => Promise<void>) | undefined;
    try {
      if (this.state.current !== migration.target) throw new Error("迁移清理记录不一致。");
      const receipt = await this.readReceipt(this.state.current, migration);
      await requireRealDirectory(migration.source);
      releaseSource = await this.lockDirectory(migration.source);
      const knownFiles = new Set(receipt.original.map(entry => entry.relative));
      if ((await inventory(migration.source, false)).some(entry => !knownFiles.has(entry.relative))) {
        throw new Error("原应用数据目录出现新文件，保留原数据。");
      }
      // Check *all* remaining originals before deleting any. Changed originals
      // can be a library used by an old version; preserve them instead.
      const remaining: Entry[] = [];
      for (const entry of receipt.original) {
        if (await exists(safeEntry(migration.source, entry.relative))) remaining.push(entry);
      }
      await validateEntries(migration.source, remaining);
      const directories = new Set<string>();
      for (const entry of remaining) {
        const file = safeEntry(migration.source, entry.relative);
        await unlink(file);
        let directory = path.dirname(file);
        while (directory !== migration.source) { directories.add(directory); directory = path.dirname(directory); }
      }
      for (const directory of [...directories].sort((a, b) => b.length - a.length)) await rmdir(directory).catch(() => undefined);
      await this.save({ version: 1, current: this.state.current, message: "迁移完成。原应用数据已清理，默认位置仅保留目录定位记录及运行环境文件。" });
    } catch {
      await this.save({ ...this.state, message: "新目录已启用；原目录有变化或暂时无法清理，已保留原数据。下次启动将重试，请勿同时运行旧版。" });
    } finally { await releaseSource?.(); }
  }
}

import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { subtitleConfigSchema, type SubtitleCredentials, type SubtitleConfigStatus } from "../../shared/subtitles.js";

export interface SubtitleCredentialStore {
  get(): Promise<SubtitleCredentials>;
  save(input: SubtitleCredentials): Promise<SubtitleConfigStatus>;
  status(): Promise<SubtitleConfigStatus>;
}
export async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, data, { mode: 0o600, flag: "wx" }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }).catch(() => undefined); }
}
export function createSubtitleCredentialStore(root: string): SubtitleCredentialStore {
  const file = path.join(root, "subtitle-credentials.bin");
  let writing: Promise<unknown> = Promise.resolve();
  const available = () => safeStorage.isEncryptionAvailable();
  const get = async () => {
    if (!available()) return {};
    try { return subtitleConfigSchema.parse(JSON.parse(safeStorage.decryptString(await readFile(file)))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("字幕账号配置无法解密，请在设置中重新保存");
    }
  };
  const status = async (): Promise<SubtitleConfigStatus> => {
    const c = await get();
    return { assrtConfigured: Boolean(c.assrtToken), openSubtitlesConfigured: Boolean(c.openSubtitlesApiKey),
      openSubtitlesAccountConfigured: Boolean(c.openSubtitlesUsername && c.openSubtitlesPassword), storageAvailable: available() };
  };
  return { get, status, save(input) {
    const parsed = subtitleConfigSchema.parse(input);
    const work = writing.catch(() => undefined).then(async () => {
      if (!available()) throw new Error("系统安全存储不可用，无法保存字幕账号");
      let old: SubtitleCredentials = {};
      try { old = await get(); } catch { /* An explicit save can replace an unreadable configuration. */ }
      const next = { ...old, ...parsed };
      if (Boolean(next.openSubtitlesUsername) !== Boolean(next.openSubtitlesPassword)) throw new Error("OpenSubtitles 用户名和密码需要同时填写或同时清除");
      await atomicWrite(file, safeStorage.encryptString(JSON.stringify(next)));
      return status();
    });
    writing = work; return work;
  } };
}

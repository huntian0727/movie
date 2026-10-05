import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { VideoRecord } from "../../shared/videoTypes.js";
import { subtitleActionSchema, subtitleSearchSchema, subtitleProviderSchema, type SubtitleAction, type SubtitleSearchRequest, type SubtitleState, type SavedSubtitle, type SubtitleCredentials } from "../../shared/subtitles.js";
import { atomicWrite, type SubtitleCredentialStore } from "./secureStore.js";
import { SubtitleProviders, scoreCandidate, suggestSubtitleQuery, type ProviderCandidate } from "./providers.js";
import { decodeSubtitle, parseSubtitle, toVtt } from "./subtitleText.js";

const savedSchema = z.object({ id: z.string().uuid(), provider: subtitleProviderSchema, title: z.string().max(2000),
  language: z.string().max(2000), release: z.string().max(2000), filename: z.string().max(2000),
  format: z.enum(["srt", "ass", "vtt"]), downloadedAt: z.string().datetime() }).strict();
const manifestSchema = z.object({ version: z.string(), items: z.array(savedSchema).max(50), selectedId: z.string().uuid().nullable(),
  offsetSeconds: z.number().finite().min(-600).max(600) }).strict();
type Manifest = z.infer<typeof manifestSchema>;
const versionOf = (v: VideoRecord) => `${v.sizeBytes}:${v.modifiedAt}`;

export class SubtitleService {
  private candidates = new Map<string, { videoId: string; version: string; until: number; candidate: ProviderCandidate }>();
  private searches = new Set<string>();
  private queues = new Map<string, Promise<unknown>>();
  constructor(private repo: Pick<{ getVideo(id: string): VideoRecord }, "getVideo">, private root: string,
    readonly credentials: SubtitleCredentialStore, private providers = new SubtitleProviders(), private now = () => Date.now()) {}

  private directory(videoId: string): string { return path.join(this.root, createHash("sha256").update(videoId).digest("hex")); }
  private async manifest(video: VideoRecord): Promise<Manifest> {
    const empty: Manifest = { version: versionOf(video), items: [], selectedId: null, offsetSeconds: 0 };
    try {
      const file = path.join(this.directory(video.id), "selection.json");
      if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error("invalid manifest");
      const value = manifestSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
      return value.version === empty.version ? value : empty;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
      throw new Error("保存的字幕记录无法读取，请检查磁盘和文件权限");
    }
  }
  private async asset(videoId: string, item: SavedSubtitle): Promise<{ path: string; text: string }> {
    const directory = this.directory(videoId), file = path.join(directory, `${item.id}.${item.format}`);
    try {
      const actual = await fs.realpath(file), root = await fs.realpath(directory);
      if (path.dirname(actual).toLowerCase() !== root.toLowerCase() || (await fs.stat(actual)).size > 4 * 1024 * 1024) throw new Error("invalid asset");
      return { path: actual, text: decodeSubtitle(await fs.readFile(actual)) };
    } catch { throw new Error("保存的字幕文件缺失或无法读取，请重新搜索下载"); }
  }
  private async state(video: VideoRecord, value: Manifest): Promise<SubtitleState> {
    const result: SubtitleState = { videoId: video.id, items: value.items, selectedId: value.selectedId, offsetSeconds: value.offsetSeconds, nativeVtt: null };
    const selected = value.items.find(i => i.id === value.selectedId);
    if (selected) {
      try { const data = await this.asset(video.id, selected); result.nativeVtt = toVtt(parseSubtitle(data.text).cues, value.offsetSeconds); }
      catch { result.selectedId = null; result.message = "保存的字幕文件缺失或损坏，请重新下载"; }
    }
    return result;
  }
  async getState(videoId: string): Promise<SubtitleState> {
    z.string().min(1).max(128).parse(videoId);
    const video = this.repo.getVideo(videoId); return this.state(video, await this.manifest(video));
  }
  async getPlaybackSubtitle(videoId: string): Promise<{ path: string | null; offsetSeconds: number; configured: boolean }> {
    const video = this.repo.getVideo(videoId), value = await this.manifest(video);
    const item = value.items.find(i => i.id === value.selectedId);
    return { path: item ? (await this.asset(videoId, item)).path : null, offsetSeconds: value.offsetSeconds, configured: value.items.length > 0 };
  }
  async search(input: SubtitleSearchRequest) {
    const request = subtitleSearchSchema.parse(input), video = this.repo.getVideo(request.videoId);
    const query = request.query?.trim() || suggestSubtitleQuery(video.filename);
    if (!query) throw new Error("请输入影片名称或发行版本");
    if (this.searches.has(video.id) || this.searches.size >= 2) throw new Error("字幕搜索正在进行，请稍后再试");
    this.searches.add(video.id);
    try {
      const names = request.provider === "all" ? ["thunder", "assrt", "opensubtitles"] as const : [request.provider];
      // An unreadable credential file must not block the sources that need no account.
      let configError = false;
      const c: SubtitleCredentials = names.some(p => p === "assrt" || p === "opensubtitles") ? await this.credentials.get().catch(() => { configError = true; return {}; }) : {};
      const results = await Promise.all(names.map(async provider => {
        if (provider === "assrt" || provider === "opensubtitles") {
          if (configError) return { provider, status: "failed" as const, message: "字幕账号配置无法读取，请在设置中重新保存", candidates: [] as ProviderCandidate[] };
          if (!(provider === "assrt" ? c.assrtToken : c.openSubtitlesApiKey)) return { provider, status: "unconfigured" as const, message: "请先在设置中配置此字幕来源", candidates: [] as ProviderCandidate[] };
        }
        try { return { provider, status: "ok" as const, message: "", candidates: (await this.providers.search(provider, c, query, request.language, video.filename)).slice(0, 100) }; }
        catch (error) { return { provider, status: "failed" as const, message: error instanceof Error && /^字幕|^请/.test(error.message) ? error.message : "字幕来源返回异常，请稍后重试", candidates: [] as ProviderCandidate[] }; }
      }));
      const publicCandidates = results.flatMap(r => r.candidates).map(candidate => {
        for (const key of ["title", "language", "release", "filename"] as const) candidate[key] = candidate[key].replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 2000);
        candidate.format = candidate.format.slice(0, 64);
        Object.assign(candidate, scoreCandidate(candidate, video.filename, query));
        this.candidates.set(candidate.id, { videoId: video.id, version: versionOf(video), until: this.now() + 10 * 60_000, candidate });
        const { sourceId: _source, sourceFile: _file, ...publicValue } = candidate; return publicValue;
      }).sort((a, b) => b.score - a.score || (b.downloads ?? 0) - (a.downloads ?? 0));
      for (const [id, value] of this.candidates) if (value.until < this.now()) this.candidates.delete(id);
      while (this.candidates.size > 400) this.candidates.delete(this.candidates.keys().next().value!);
      return { query, candidates: publicCandidates, providers: results.map(({ candidates: _candidates, ...status }) => status) };
    } finally { this.searches.delete(video.id); }
  }
  async action(input: SubtitleAction): Promise<SubtitleState> {
    const request = subtitleActionSchema.parse(input);
    if (request.op === "export") throw new Error("请通过字幕导出窗口导出文件");
    if (this.queues.has(request.videoId) || this.queues.size >= 4) throw new Error("字幕操作正在进行，请稍后再试");
    const work = this.perform(request); this.queues.set(request.videoId, work);
    try { return await work; } finally { this.queues.delete(request.videoId); }
  }
  private async perform(request: SubtitleAction): Promise<SubtitleState> {
    const video = this.repo.getVideo(request.videoId), value = await this.manifest(video);
    if (request.op === "download") {
      const entry = this.candidates.get(request.id!);
      if (!entry || entry.videoId !== video.id || entry.version !== versionOf(video) || entry.until < this.now()) throw new Error("字幕搜索结果已过期，请重新搜索");
      if (value.items.length >= 50) throw new Error("这部影片已保存 50 个字幕版本，请选择已保存字幕");
      const accountRequired = entry.candidate.provider === "assrt" || entry.candidate.provider === "opensubtitles";
      const data = await this.providers.download(entry.candidate, accountRequired ? await this.credentials.get() : {});
      const text = decodeSubtitle(data), parsed = parseSubtitle(text);
      if (Buffer.byteLength(text, "utf8") > 4 * 1024 * 1024) throw new Error("字幕转换后的文件超过 4 MiB 限制，请选择其他版本");
      const item: SavedSubtitle = { id: randomUUID(), provider: entry.candidate.provider, title: entry.candidate.title,
        language: entry.candidate.language, release: entry.candidate.release, filename: path.basename(entry.candidate.filename),
        format: parsed.format, downloadedAt: new Date(this.now()).toISOString() };
      if (versionOf(this.repo.getVideo(video.id)) !== value.version) throw new Error("影片文件已改变，请重新搜索字幕");
      await atomicWrite(path.join(this.directory(video.id), `${item.id}.${item.format}`), Buffer.from(text, "utf8"));
      value.items.push(savedSchema.parse(item)); value.selectedId = item.id; value.offsetSeconds = 0;
    } else if (request.op === "select") {
      if (request.id && !value.items.some(i => i.id === request.id)) throw new Error("字幕记录不存在，请重新选择");
      if (request.id) await this.asset(video.id, value.items.find(i => i.id === request.id)!);
      value.selectedId = request.id ?? null;
    } else value.offsetSeconds = request.offsetSeconds!;
    if (versionOf(this.repo.getVideo(video.id)) !== value.version) throw new Error("影片文件已改变，请重新搜索字幕");
    await atomicWrite(path.join(this.directory(video.id), "selection.json"), Buffer.from(JSON.stringify(value), "utf8"));
    return this.state(video, value);
  }
  async exportAsset(videoId: string, id: string): Promise<{ filename: string; data: Buffer }> {
    subtitleActionSchema.parse({ videoId, id, op: "export" });
    const video = this.repo.getVideo(videoId), value = await this.manifest(video);
    const item = value.items.find(i => i.id === id); if (!item) throw new Error("字幕记录不存在");
    const asset = await this.asset(videoId, item);
    return { filename: `${path.parse(video.filename).name}.${item.format}`, data: Buffer.from(asset.text, "utf8") };
  }
}

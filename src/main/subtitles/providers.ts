import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SubtitleCandidate, SubtitleCredentials, SubtitleProvider } from "../../shared/subtitles.js";
import { parseCatDownload, parseCatResults } from "./subtitleCatHtml.js";
import { matchesSubtitleCode, subtitleCode, suggestSubtitleQuery } from "../../shared/subtitleQuery.js";
export { suggestSubtitleQuery } from "../../shared/subtitleQuery.js";

export type SearchLanguage = "any" | "chinese" | "bilingual" | "english";
export interface ProviderCandidate extends SubtitleCandidate { sourceId: string; sourceFile: string }
const name = z.string().max(2000).nullish();
const assrtItem = z.object({ id: z.number().int().positive(), native_name: z.union([name, z.array(z.string())]), videoname: name,
  subtype: name, lang: z.object({ desc: name, langlist: z.record(z.unknown()).optional() }).optional(),
  filelist: z.array(z.object({ f: z.string().max(2000) })).max(500).optional() });
const osItem = z.object({ attributes: z.object({ language: z.string(), release: name, download_count: z.number().nullable().optional(),
  moviehash_match: z.boolean().optional(), feature_details: z.object({ title: name, year: z.number().nullish() }).optional(),
  files: z.array(z.object({ file_id: z.number().int().positive(), file_name: name })).max(100) }) });

export function scoreCandidate(candidate: Pick<SubtitleCandidate, "title" | "release" | "filename">, filename: string, query: string): { score: number; matches: string[] } {
  const code = subtitleCode(query);
  if (code) return matchesSubtitleCode(candidate, code) ? { score: 90, matches: ["编号匹配"] } : { score: 0, matches: [] };
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const text = normalize(`${candidate.title} ${candidate.release} ${candidate.filename}`);
  const wanted = normalize(query.replace(/\b(?:19|20)\d{2}\b/g, ""));
  let score = 0; const matches: string[] = [];
  if (wanted && text.includes(wanted)) { score += 50; matches.push("片名匹配"); }
  const year = /\b((?:19|20)\d{2})\b/.exec(filename)?.[1];
  if (year && text.includes(year)) { score += 20; matches.push("年份匹配"); }
  const episode = /S\d{1,2}E\d{1,3}/i.exec(filename)?.[0];
  if (episode && text.includes(normalize(episode))) { score += 25; matches.push("季集匹配"); }
  for (const [expression, label, points] of [[/blu[ .-]?ray/i, "蓝光版本", 10], [/web[ .-]?(dl|rip)/i, "网络发行版本", 10], [/2160p|1080p|720p/i, "分辨率匹配", 3]] as const) {
    const tag = expression.exec(filename)?.[0];
    if (tag && text.includes(normalize(tag))) { score += points; matches.push(label); }
  }
  return { score: Math.min(100, score), matches };
}
export function validateDownloadUrl(input: string, provider: SubtitleProvider): URL {
  const url = new URL(input);
  if (url.protocol === "http:") url.protocol = "https:";
  const host = url.hostname.toLowerCase();
  const allowed = { assrt: /(^|\.)(assrt\.net|makedie\.me)$/, opensubtitles: /(^|\.)(opensubtitles\.(com|org)|osdb\.link)$/,
    thunder: /^subtitle\.v\.geilijiasu\.com$/, subtitlecat: /^(www\.)?subtitlecat\.com$/ }[provider];
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || !allowed.test(host)) throw new Error("字幕下载地址不受信任，请选择其他版本");
  return url;
}
function httpError(status: number): Error {
  if (status === 401 || status === 403) return new Error("字幕服务认证失败，请检查账号和 API 密钥");
  if (status === 429 || status === 406) return new Error("字幕服务配额已用完或请求过快，请稍后再试");
  return new Error("字幕服务暂时不可用，请稍后重试");
}
export class SubtitleProviders {
  private assrtNext = 0;
  private assrtQueue: Promise<unknown> = Promise.resolve();
  private osSession: { key: string; token: string; host: string; until: number } | null = null;
  constructor(private fetcher: typeof fetch = fetch, private now = () => Date.now(), private wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}
  private async bytes(url: string, options: RequestInit = {}, limit = 2 * 1024 * 1024): Promise<Buffer> {
    try {
      const response = await this.fetcher(url, { ...options, signal: AbortSignal.timeout(15_000), redirect: "error" });
      if (!response.ok) throw httpError(response.status);
      return await this.readBody(response, limit);
    } catch (error) {
      if (error instanceof Error && /^字幕/.test(error.message)) throw error;
      throw new Error("字幕服务连接失败或超时，请检查网络后重试");
    }
  }
  private async readBody(response: Response, limit: number): Promise<Buffer> {
    if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("字幕服务返回内容过大"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("字幕服务返回内容为空");
    const chunks: Buffer[] = []; let size = 0;
    try {
      while (true) {
        const result = await reader.read(); if (result.done) break;
        size += result.value.length;
        if (size > limit) { await reader.cancel(); throw new Error("字幕服务返回内容过大"); }
        chunks.push(Buffer.from(result.value));
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
  private async json(url: string, options: RequestInit = {}): Promise<unknown> {
    const data = await this.bytes(url, options);
    try { return JSON.parse(data.toString("utf8")); } catch { throw new Error("字幕服务返回格式异常，请稍后重试"); }
  }
  private assrt(endpoint: string, token: string, params: Record<string, string>): Promise<unknown> {
    const work = this.assrtQueue.catch(() => undefined).then(async () => {
      await this.wait(Math.max(0, this.assrtNext - this.now())); this.assrtNext = this.now() + 3100;
      const result = await this.json(`https://api.assrt.net/v1/${endpoint}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "YingXia/0.1.15" } });
      const body = z.object({ status: z.number(), sub: z.unknown().optional() }).safeParse(result);
      if (!body.success) throw new Error("字幕服务返回格式异常，请稍后重试");
      if (body.data.status !== 0) throw body.data.status === 30900 ? httpError(429) : body.data.status === 20001 ? httpError(401) : new Error("字幕服务查询失败，请稍后重试");
      return body.data.sub;
    });
    this.assrtQueue = work; return work;
  }
  private osHeaders(c: SubtitleCredentials): Record<string, string> {
    return { "Api-Key": c.openSubtitlesApiKey!, "User-Agent": "YingXia v0.1.15", "Content-Type": "application/json", Accept: "application/json" };
  }
  async search(provider: SubtitleProvider, c: SubtitleCredentials, query: string, language: SearchLanguage, filename = query): Promise<ProviderCandidate[]> {
    if (provider === "thunder") return this.searchThunder(query, language, filename);
    if (provider === "subtitlecat") return this.searchCat(query, language);
    if (provider === "assrt") {
      const body = await this.assrt("sub/search", c.assrtToken!, { q: query, cnt: "15", filelist: "1" });
      const parsed = z.object({ subs: z.array(z.unknown()).max(100) }).safeParse(body);
      if (!parsed.success) throw new Error("字幕服务返回格式异常，请稍后重试");
      return parsed.data.subs.flatMap(raw => {
        const result = assrtItem.safeParse(raw); if (!result.success) return [];
        const s = result.data, desc = s.lang?.desc ?? "未知语言", languages = s.lang?.langlist ?? {};
        const bilingual = "langdou" in languages || /双语|雙語/.test(desc);
        const matches = language === "bilingual" ? bilingual : language === "english" ? "langeng" in languages || /英/.test(desc) : bilingual || Object.keys(languages).some(l => /lang(chs|cht|chi|zho)/.test(l)) || /中|汉|漢|简|繁/.test(desc);
        if (language !== "any" && !matches) return [];
        const files = s.filelist?.filter(f => /\.(srt|ass|ssa|vtt)$/i.test(f.f)) ?? [];
        const title = Array.isArray(s.native_name) ? s.native_name.join(" / ") : s.native_name ?? query;
        const base = { provider, title, language: desc, release: s.videoname ?? "未标注版本", score: 0, matches: [], downloads: null, sourceId: String(s.id) };
        if (files.length) return files.slice(0, 40).map(f => ({ ...base, id: randomUUID(), sourceFile: f.f, filename: f.f, format: f.f.split(".").pop()!.toLowerCase() }));
        if (/srt|subrip|ass|ssa|webvtt/i.test(s.subtype ?? "")) return [{ ...base, id: randomUUID(), sourceFile: "", filename: "详情中选择字幕文件", format: s.subtype ?? "未知" }];
        return [];
      });
    }
    const languages = language === "bilingual" ? "ze" : language === "english" ? "en" : "zh-cn,zh-tw,ze";
    const result = await this.json(`https://api.opensubtitles.com/api/v1/subtitles?${new URLSearchParams({ query, ...(language === "any" ? {} : { languages }), order_by: "download_count", order_direction: "desc" })}`, { headers: this.osHeaders(c) });
    const parsed = z.object({ data: z.array(z.unknown()).max(1000) }).safeParse(result);
    if (!parsed.success) throw new Error("字幕服务返回格式异常，请稍后重试");
    return parsed.data.data.flatMap(raw => {
      const parsedItem = osItem.safeParse(raw); if (!parsedItem.success) return [];
      const s = parsedItem.data.attributes;
      return s.files.map(f => ({ id: randomUUID(), provider, title: s.feature_details?.title ?? query,
        language: ({ "zh-cn": "简体中文", "zh-tw": "繁体中文", ze: "中英双语", en: "英语" } as Record<string, string>)[s.language] ?? s.language,
        release: s.release ?? "未标注版本", filename: f.file_name ?? s.release ?? "字幕", format: "srt",
        score: 0, matches: [], downloads: s.download_count ?? null, sourceId: String(f.file_id), sourceFile: f.file_name ?? "" }));
    });
  }
  private async searchThunder(query: string, language: SearchLanguage, filename: string): Promise<ProviderCandidate[]> {
    // Filename is a useful release clue; an explicitly edited query takes precedence.
    const nameQuery = subtitleCode(query) ?? (query === suggestSubtitleQuery(filename) ? filename : query);
    const raw = await this.json(`https://api-shoulei-ssl.xunlei.com/oracle/subtitle?${new URLSearchParams({ name: nameQuery })}`);
    const body = z.object({ code: z.number(), result: z.string(), data: z.array(z.unknown()).max(500).nullish() }).safeParse(raw);
    if (!body.success || body.data.code !== 0 || body.data.result !== "ok") throw new Error("字幕服务查询失败，请稍后重试或换用其他来源");
    const itemSchema = z.object({ name: z.string().min(1).max(2000), extra_name: name, ext: z.string().max(16), url: z.string().max(8192), score: z.number().finite().optional(), gcid: name, cid: name });
    return (body.data.data ?? []).flatMap(value => {
      const result = itemSchema.safeParse(value); if (!result.success) return [];
      const item = result.data, format = item.ext.replace(/^\./, "").toLowerCase();
      if (!["srt", "ass", "ssa", "vtt"].includes(format)) return [];
      try { validateDownloadUrl(item.url, "thunder"); } catch { return []; }
      const bilingual = /双语|雙語|中英|chs[._-]eng|zh[._-]en/i.test(item.name);
      const chinese = bilingual || /中文|简体|繁体|汉化|[._\s-](?:chs|cht|chn|chi|zho|zh)(?:[._\s-]|$)/i.test(item.name);
      const english = /英文|英语|[._\s-](?:eng|en)(?:[._\s-]|$)/i.test(item.name);
      if (language === "bilingual" && !bilingual || language === "chinese" && !chinese || language === "english" && !english && !bilingual) return [];
      const description = bilingual ? "可能中英双语（文件名线索）" : chinese ? "可能中文（文件名线索）" : english ? "可能英语（文件名线索）" : "语言未确认";
      return [{ id: randomUUID(), provider: "thunder" as const, title: item.name.replace(/\.(srt|ass|ssa|vtt)$/i, ""), language: description,
        release: item.extra_name ?? "版本未标注", filename: item.name, format, score: 0, matches: [], downloads: null,
        sourceId: `${item.gcid ?? ""}:${item.cid ?? ""}`, sourceFile: item.url }];
    }).slice(0, 100);
  }
  private async searchCat(query: string, language: SearchLanguage): Promise<ProviderCandidate[]> {
    if (language === "bilingual") throw new Error("字幕网站未提供可核实的中英双语筛选，请选择中文、英语或不限语言");
    const html = (await this.bytes(`https://subtitlecat.com/index.php?${new URLSearchParams({ search: query })}`)).toString("utf8");
    const targets = language === "any" ? ["zh-CN", "en"] : language === "english" ? ["en"] : ["zh-CN"];
    return parseCatResults(html, query).flatMap(item => {
      let detail: URL;
      try { detail = validateDownloadUrl(new URL(item.href, "https://subtitlecat.com/").href, "subtitlecat"); } catch { return []; }
      if (!detail.pathname.startsWith("/subs/") || !detail.pathname.endsWith(".html")) return [];
      return targets.map(target => ({ id: randomUUID(), provider: "subtitlecat" as const, title: item.title,
        language: target === "en" ? "英语（网站版本）" : "中文（网站版本）", release: "网站字幕，所选语言下载链接将在下载时核实；译文请核对",
        filename: `${item.title}.${target}.srt`, format: "srt", score: 0, matches: [], downloads: item.downloads, sourceId: detail.href, sourceFile: target }));
    });
  }
  private async login(c: SubtitleCredentials): Promise<{ token: string; host: string }> {
    if (!c.openSubtitlesUsername || !c.openSubtitlesPassword) throw new Error("请在设置中填写 OpenSubtitles 用户名和密码后下载");
    const key = JSON.stringify([c.openSubtitlesApiKey, c.openSubtitlesUsername, c.openSubtitlesPassword]);
    if (this.osSession?.key === key && this.osSession.until > this.now()) return this.osSession;
    const response = await this.json("https://api.opensubtitles.com/api/v1/login", { method: "POST", headers: this.osHeaders(c), body: JSON.stringify({ username: c.openSubtitlesUsername, password: c.openSubtitlesPassword }) });
    const parsed = z.object({ token: z.string().min(1).max(8192), base_url: z.string().optional() }).safeParse(response);
    if (!parsed.success) throw new Error("字幕服务认证失败，请检查账号和 API 密钥");
    const host = parsed.data.base_url ?? "api.opensubtitles.com";
    if (!["api.opensubtitles.com", "vip-api.opensubtitles.com"].includes(host)) throw new Error("字幕服务返回的账号服务器异常");
    this.osSession = { key, token: parsed.data.token, host, until: this.now() + 23 * 3600000 };
    return this.osSession;
  }
  async download(candidate: ProviderCandidate, credentials: SubtitleCredentials): Promise<Buffer> {
    let url: string;
    if (candidate.provider === "thunder") {
      url = candidate.sourceFile;
    } else if (candidate.provider === "subtitlecat") {
      const detail = validateDownloadUrl(candidate.sourceId, "subtitlecat");
      if (!detail.pathname.startsWith("/subs/") || !detail.pathname.endsWith(".html")) throw new Error("字幕详情地址无效，请重新搜索");
      const html = (await this.bytes(detail.href)).toString("utf8");
      url = new URL(parseCatDownload(html, candidate.sourceFile), detail).href;
    } else if (candidate.provider === "assrt") {
      const response = await this.assrt("sub/detail", credentials.assrtToken!, { id: candidate.sourceId });
      const parsed = z.object({ subs: z.array(z.object({ url: z.string().optional(), filename: z.string().optional(), filelist: z.array(z.object({ f: z.string(), url: z.string() })).optional() })).min(1).max(100) }).safeParse(response);
      if (!parsed.success) throw new Error("字幕详情已失效，请重新搜索");
      const s = parsed.data.subs[0];
      const file = s.filelist?.find(f => candidate.sourceFile ? f.f === candidate.sourceFile : /\.(srt|ass|ssa|vtt)$/i.test(f.f));
      if (file) url = file.url;
      else if (!candidate.sourceFile && s.url && /\.(srt|ass|ssa|vtt)$/i.test(s.filename ?? new URL(s.url).pathname)) url = s.url;
      else throw new Error("该版本未提供可直接下载的字幕文件，请选择其他版本");
    } else {
      const session = await this.login(credentials);
      let response: unknown;
      try { response = await this.json(`https://${session.host}/api/v1/download`, { method: "POST", headers: { ...this.osHeaders(credentials), Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ file_id: Number(candidate.sourceId), sub_format: "srt" }) }); }
      catch (error) { this.osSession = null; throw error; }
      const parsed = z.object({ link: z.string().max(8192) }).safeParse(response);
      if (!parsed.success) throw new Error("字幕下载链接无效，请重新搜索");
      url = parsed.data.link;
    }
    // Never forward API credentials to download/CDN hosts or their redirects.
    for (let redirect = 0; redirect <= 3; redirect++) {
      const target = validateDownloadUrl(url, candidate.provider);
      try {
        const response = await this.fetcher(target, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location"); await response.body?.cancel();
          if (!location) throw new Error("字幕下载链接无效，请重新搜索");
          url = new URL(location, target).href; continue;
        }
        if (!response.ok) throw httpError(response.status);
        return await this.readBody(response, 4 * 1024 * 1024);
      } catch (error) {
        if (error instanceof Error && /^字幕|^该版本/.test(error.message)) throw error;
        throw new Error("字幕下载连接失败或超时，请重试");
      }
    }
    throw new Error("字幕下载重定向过多，请选择其他版本");
  }
}

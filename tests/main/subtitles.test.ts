import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { VideoRecord } from "../../src/shared/videoTypes";
import { subtitleActionSchema, subtitleConfigSchema, subtitleSearchSchema } from "../../src/shared/subtitles";
const secure = vi.hoisted(() => ({ available: true }));
vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => secure.available,
  encryptString: (text: string) => Buffer.from(Buffer.from(text).toString("base64")),
  decryptString: (data: Buffer) => Buffer.from(data.toString(), "base64").toString() } }));
import { createSubtitleCredentialStore } from "../../src/main/subtitles/secureStore";
import { SubtitleService } from "../../src/main/subtitles/subtitleService";
import { SubtitleProviders, scoreCandidate, suggestSubtitleQuery, validateDownloadUrl, type ProviderCandidate } from "../../src/main/subtitles/providers";
import { decodeSubtitle, parseSubtitle, toVtt } from "../../src/main/subtitles/subtitleText";

const roots: string[] = [];
afterEach(async () => { secure.available = true; await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const srt = "1\n00:00:01,000 --> 00:00:03,500\n你好 <i>World</i>\n";
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yingxia-subtitles-")); roots.push(root);
  const credentials = createSubtitleCredentialStore(root); await credentials.save({ assrtToken: "fixture-token" });
  const candidate: ProviderCandidate = { id: randomUUID(), provider: "assrt", title: "Movie 2024", language: "简体中文", release: "Movie.2024.WEB-DL", filename: "Movie.srt", format: "srt", score: 0, matches: [], downloads: null, sourceId: "123", sourceFile: "Movie.srt" };
  const providers = { search: vi.fn(async (provider: string) => provider === "assrt" ? [candidate] : []), download: vi.fn(async () => Buffer.from(srt)) };
  const video = { id: "v1", filename: "Movie.2024.1080p.WEB-DL.mkv", sizeBytes: 1000, modifiedAt: "2026-10-05T00:00:00.000Z" } as VideoRecord;
  const repo = { getVideo: vi.fn((id: string) => ({ ...video, id })) };
  const service = new SubtitleService(repo, path.join(root, "subtitles"), credentials, providers as unknown as SubtitleProviders);
  return { root, credentials, providers, video, repo, service, candidate };
}
describe("subtitle security and persistence", () => {
  it("reuses an identical downloaded source across new searches and restart while preserving its offset", async () => {
    const f = await fixture();
    const result = await f.service.search({ videoId: "v1" });
    const first = await f.service.action({ op: "download", videoId: "v1", id: result.candidates[0].id });
    await f.service.action({ op: "offset", videoId: "v1", offsetSeconds: 1.5 });
    const restart = new SubtitleService(f.repo, path.join(f.root, "subtitles"), f.credentials, f.providers as unknown as SubtitleProviders);
    f.candidate.id = randomUUID();
    const next = await restart.search({ videoId: "v1" });
    const reused = await restart.action({ op: "download", videoId: "v1", id: next.candidates[0].id });
    expect(reused.selectedId).toBe(first.selectedId); expect(reused.items).toHaveLength(1);
    expect(reused.offsetSeconds).toBe(1.5); expect(reused.items[0]).not.toHaveProperty("sourceKey");
    expect(f.providers.download).toHaveBeenCalledOnce();
  });
  it("replaces a missing saved download and separates different source files", async () => {
    const f = await fixture(), result = await f.service.search({ videoId: "v1" });
    const first = await f.service.action({ op: "download", videoId: "v1", id: result.candidates[0].id });
    await fs.rm((await f.service.getPlaybackSubtitle("v1")).path!);
    const restored = await f.service.action({ op: "download", videoId: "v1", id: result.candidates[0].id });
    expect(restored.selectedId).not.toBe(first.selectedId); expect(restored.items).toHaveLength(1);
    f.candidate.filename = "Movie.other.srt"; f.candidate.sourceFile = "Movie.other.srt"; f.candidate.id = randomUUID();
    const other = await f.service.search({ videoId: "v1" });
    expect((await f.service.action({ op: "download", videoId: "v1", id: other.candidates[0].id })).items).toHaveLength(2);
    expect(f.providers.download).toHaveBeenCalledTimes(3);
  });
  it("bounds provider metadata before persistence so saved records remain readable", async () => {
    const f = await fixture(); f.candidate.title = "长".repeat(3000); f.candidate.language = "\u0001".repeat(2000) + "x".repeat(3000);
    const result = await f.service.search({ videoId: "v1" });
    expect(result.candidates[0].title.length).toBe(2000);
    expect(result.candidates[0].language).toBe("x".repeat(2000));
    const state = await f.service.action({ op: "download", videoId: "v1", id: result.candidates[0].id });
    expect(await f.service.getState("v1")).toEqual(state);
  });
  it("encrypts secrets, returns only flags, preserves absent fields and clears explicitly", async () => {
    const f = await fixture();
    await f.credentials.save({ openSubtitlesApiKey: "fixture-api", openSubtitlesUsername: "fixture-user", openSubtitlesPassword: "fixture-pass" });
    expect((await fs.readFile(path.join(f.root, "subtitle-credentials.bin"), "utf8"))).not.toContain("fixture-pass");
    expect(await f.credentials.status()).toEqual({ assrtConfigured: true, openSubtitlesConfigured: true, openSubtitlesAccountConfigured: true, storageAvailable: true });
    await f.credentials.save({ assrtToken: "" });
    expect((await f.credentials.get()).openSubtitlesPassword).toBe("fixture-pass");
    expect((await f.credentials.status()).assrtConfigured).toBe(false);
    await expect(f.credentials.save({ openSubtitlesUsername: "" })).rejects.toThrow("同时");
    secure.available = false;
    await expect(f.credentials.save({ assrtToken: "fixture" })).rejects.toThrow("安全存储");
    expect(await f.credentials.get()).toEqual({});
  });
  it("rejects renderer paths, URLs, extra keys, nonfinite offsets and arbitrary candidate IDs", async () => {
    expect(subtitleSearchSchema.safeParse({ videoId: "v1", url: "https://evil.example" }).success).toBe(false);
    expect(subtitleActionSchema.safeParse({ videoId: "v1", op: "download", id: randomUUID(), path: "C:\\bad.srt" }).success).toBe(false);
    expect(subtitleActionSchema.safeParse({ videoId: "v1", op: "offset", offsetSeconds: Infinity }).success).toBe(false);
    expect(subtitleConfigSchema.safeParse({ password: "other" }).success).toBe(false);
    const f = await fixture();
    await expect(f.service.action({ op: "download", videoId: "v1", id: randomUUID() })).rejects.toThrow("过期");
    const result = await f.service.search({ videoId: "v1" });
    expect(result.candidates[0]).not.toHaveProperty("sourceId");
    expect(result.candidates[0]).not.toHaveProperty("sourceFile");
    expect(result.providers.find(p => p.provider === "opensubtitles")?.status).toBe("unconfigured");
    await expect(f.service.action({ op: "download", videoId: "v2", id: result.candidates[0].id })).rejects.toThrow("过期");
    expect(f.providers.download).not.toHaveBeenCalled();
  });
  it("persists a selection and offset across restart without touching source video or cache", async () => {
    const f = await fixture(), result = await f.service.search({ videoId: "v1" });
    let state = await f.service.action({ op: "download", videoId: "v1", id: result.candidates[0].id });
    expect(state.nativeVtt).toContain("你好 World");
    state = await f.service.action({ op: "offset", videoId: "v1", offsetSeconds: 2 });
    expect(state.nativeVtt).toContain("00:00:03.000 --> 00:00:05.500");
    const restart = new SubtitleService(f.repo, path.join(f.root, "subtitles"), f.credentials);
    expect(await restart.getState("v1")).toEqual(state);
    const playback = await restart.getPlaybackSubtitle("v1");
    expect(playback.path).toMatch(/\.srt$/); expect(playback.offsetSeconds).toBe(2);
    expect((await restart.exportAsset("v1", state.selectedId!)).data.toString()).toBe(srt);
    expect((await restart.action({ op: "select", videoId: "v1", id: null })).nativeVtt).toBeNull();
    await restart.action({ op: "select", videoId: "v1", id: state.selectedId });
    await fs.rm(playback.path!);
    expect((await restart.getState("v1")).message).toContain("缺失");
    await expect(restart.getPlaybackSubtitle("v1")).rejects.toThrow("缺失");
    f.video.modifiedAt = "changed";
    expect((await restart.getState("v1")).items).toEqual([]);
  });
  it("does not publish invalid downloads or late downloads for replaced video files", async () => {
    const f = await fixture(), result = await f.service.search({ videoId: "v1" });
    f.providers.download.mockResolvedValueOnce(Buffer.from("<html>error</html>"));
    await expect(f.service.action({ op: "download", videoId: "v1", id: result.candidates[0].id })).rejects.toThrow("不是可用字幕");
    expect((await f.service.getState("v1")).items).toEqual([]);
    let resolve!: (data: Buffer<ArrayBuffer>) => void;
    f.providers.download.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = f.service.action({ op: "download", videoId: "v1", id: result.candidates[0].id });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await expect(f.service.action({ op: "select", videoId: "v1", id: null })).rejects.toThrow("正在进行");
    f.video.sizeBytes = 2000; resolve(Buffer.from(srt));
    await expect(pending).rejects.toThrow("已改变");
    expect((await f.service.getState("v1")).items).toEqual([]);
  });
  it("distinguishes provider outage from empty results and sanitizes upstream exceptions", async () => {
    const f = await fixture(); f.providers.search.mockRejectedValueOnce(new Error("https://secret@host/token"));
    const result = await f.service.search({ videoId: "v1" });
    expect(result.providers[0].status).toBe("failed"); expect(JSON.stringify(result)).not.toContain("secret");
    f.providers.search.mockResolvedValueOnce([]);
    expect((await f.service.search({ videoId: "v1" })).providers[0].status).toBe("ok");
  });
});
describe("subtitle formats", () => {
  it("decodes UTF-16 and GB18030 and produces escaped VTT with offsets", () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(srt, "utf16le")]);
    expect(decodeSubtitle(utf16)).toContain("你好");
    expect(decodeSubtitle(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))).toBe("你好");
    const cues = parseSubtitle(srt.replace("World", "World & friends")).cues;
    expect(toVtt(cues, -2)).toContain("00:00:00.000 --> 00:00:01.500");
    expect(toVtt(cues)).toContain("&amp;");
    expect(toVtt(cues, -10)).toBe("WEBVTT\n\n");
    expect(() => parseSubtitle("no timestamps")).toThrow("时间轴");
    expect(() => decodeSubtitle(Buffer.alloc(4 * 1024 * 1024 + 1))).toThrow("4 MiB");
  });
  it("keeps ASS source formatting and extracts basic text for Chromium playback", () => {
    const text = "[Script Info]\nTitle: test\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\b1}中文\\NEnglish, too";
    const parsed = parseSubtitle(text); expect(parsed.format).toBe("ass");
    expect(parsed.cues[0].text).toBe("中文\nEnglish, too");
    expect(toVtt(parsed.cues)).toContain("00:00:03.500");
  });
  it("uses match clues instead of claiming exact timing compatibility", () => {
    expect(suggestSubtitleQuery("Movie.Title.2024.1080p.WEB-DL.x265.mkv")).toBe("Movie Title 2024");
    expect(scoreCandidate({ title: "Movie Title", release: "2024 WEB-DL", filename: "file.srt" }, "Movie.Title.2024.1080p.WEB-DL.mkv", "Movie Title 2024").matches).toContain("年份匹配");
  });
});
describe("official provider adapters", () => {
  it("expands ASSRT individual files, filters language, and authenticates without URL tokens", async () => {
    const fetcher = vi.fn(async () => Response.json({ status: 0, sub: { subs: [
      { id: 1, native_name: "Movie", videoname: "WEB-DL", lang: { desc: "简体中文", langlist: { langchs: true } }, filelist: [{ f: "简体.srt" }, { f: "双语.ass" }, { f: "archive.zip" }] },
      { id: 2, native_name: "Movie", lang: { desc: "English", langlist: { langeng: true } }, filelist: [{ f: "english.srt" }] }
    ] } }));
    const api = new SubtitleProviders(fetcher as typeof fetch, () => 0, async () => undefined);
    const results = await api.search("assrt", { assrtToken: "fixture-only" }, "Movie", "chinese");
    expect(results.map(r => r.filename)).toEqual(["简体.srt", "双语.ass"]);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("fixture-only"); expect(options.headers).toMatchObject({ Authorization: "Bearer fixture-only" });
  });
  it("rejects untrusted URLs and revalidates CDN redirects without forwarding secrets", async () => {
    for (const url of ["https://opensubtitles.com.evil.example/x", "https://user@assrt.net/x", "https://127.0.0.1/x", "file:///C:/x", "https://assrt.net:123/x"]) expect(() => validateDownloadUrl(url, "assrt")).toThrow();
    const f = await fixture();
    const fetcher = vi.fn(async (url: URL | RequestInfo, options?: RequestInit) => {
      if (String(url).includes("/sub/detail")) return Response.json({ status: 0, sub: { subs: [{ filelist: [{ f: "Movie.srt", url: "https://assrt.net/download/x" }] }] } });
      expect(options?.headers).toBeUndefined();
      return new Response(null, { status: 302, headers: { location: "https://evil.example/x" } });
    });
    const api = new SubtitleProviders(fetcher as typeof fetch, Date.now, async () => undefined);
    await expect(api.download(f.candidate, { assrtToken: "fixture-only" })).rejects.toThrow("不受信任");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("logs into OpenSubtitles only for download, honors API language and hides CDN credentials", async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo, options?: RequestInit) => {
      if (String(url).includes("/subtitles?")) return Response.json({ data: [{ attributes: { language: "ze", release: "Movie WEB-DL", files: [{ file_id: 10, file_name: "Movie" }] } }] });
      if (String(url).endsWith("/login")) return Response.json({ token: "fixture-session", base_url: "vip-api.opensubtitles.com" });
      if (String(url).endsWith("/download")) { expect(options?.headers).toMatchObject({ Authorization: "Bearer fixture-session" }); expect(options?.body).toBe(JSON.stringify({ file_id: 10, sub_format: "srt" })); return Response.json({ link: "https://dl.opensubtitles.com/x" }); }
      expect(options?.headers).toBeUndefined(); return new Response(srt);
    });
    const api = new SubtitleProviders(fetcher as typeof fetch);
    const c = { openSubtitlesApiKey: "fixture-api", openSubtitlesUsername: "fixture-user", openSubtitlesPassword: "fixture-pass" };
    const results = await api.search("opensubtitles", c, "Movie", "bilingual");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0][0])).toContain("languages=ze");
    expect(results[0].language).toBe("中英双语");
    expect((await api.download(results[0], c)).toString()).toBe(srt);
    await api.download(results[0], c);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/login"))).toHaveLength(1);
  });
  it("returns actionable quota errors and bounds large responses", async () => {
    const api = new SubtitleProviders(vi.fn(async () => new Response("quota", { status: 429 })) as typeof fetch);
    await expect(api.search("opensubtitles", { openSubtitlesApiKey: "fixture" }, "Movie", "english")).rejects.toThrow("配额");
    const large = new SubtitleProviders(vi.fn(async () => new Response("{}", { headers: { "content-length": String(3 * 1024 * 1024) } })) as typeof fetch);
    await expect(large.search("opensubtitles", { openSubtitlesApiKey: "fixture" }, "Movie", "english")).rejects.toThrow("过大");
  });
});

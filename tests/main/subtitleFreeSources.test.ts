import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { VideoRecord } from "../../src/shared/videoTypes";
import { SubtitleProviders, validateDownloadUrl, type ProviderCandidate } from "../../src/main/subtitles/providers";
import { parseCatDownload, parseCatResults } from "../../src/main/subtitles/subtitleCatHtml";
import { SubtitleService } from "../../src/main/subtitles/subtitleService";
import type { SubtitleCredentialStore } from "../../src/main/subtitles/secureStore";
vi.mock("electron", () => ({ safeStorage: {} }));

const srt = "1\n00:00:01,500 --> 00:00:03,050\n字幕\n";
const row = (title: string, href = "subs/100/Movie.html") => `<tr><td><a href="${href}">${title}</a></td><td>Size 30 KB</td><td>Downloads 1,234 downloads</td></tr>`;
const page = (...rows: string[]) => `<table class="sub-table"><tbody>${rows.join("")}</tbody></table>`;
const item = (name: string, ext = "srt", url = "http://subtitle.v.geilijiasu.com/file.srt") => ({ name, extra_name: "网友上传", ext, url, score: 5, gcid: "abc", cid: "def" });
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe("no-key subtitle adapters", () => {
  it("sends only the structured code to Thunder, including the automatic query case", async () => {
    const fetcher = vi.fn(async () => Response.json({ code: 0, result: "ok", data: [] }));
    const provider = new SubtitleProviders(fetcher as typeof fetch);
    await provider.search("thunder", {}, "SSIS-570", "any", "SSIS-570 描述文字和姓名.mp4");
    expect(new URL((fetcher.mock.calls[0] as unknown as [string])[0]).searchParams.get("name")).toBe("SSIS-570");
  });
  it("filters wrong and unmarked codes before exposing any provider candidate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yingxia-code-match-")); roots.push(root);
    const video = { id: "code-video", filename: "SSIS-570 描述文字和姓名.mp4", sizeBytes: 10, modifiedAt: "v1" } as VideoRecord;
    const fetcher = vi.fn(async () => Response.json({ code: 0, result: "ok", data: [item("姓名SSIS-037.srt"), item("姓名.srt"), item("SSIS-5700.srt"), item("SSIS-570.chs.srt")] }));
    const service = new SubtitleService({ getVideo: () => video }, root, { get: vi.fn() } as unknown as SubtitleCredentialStore, new SubtitleProviders(fetcher as typeof fetch));
    const result = await service.search({ videoId: video.id, provider: "thunder", language: "any" });
    expect(result.query).toBe("SSIS-570"); expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].filename).toBe("SSIS-570.chs.srt"); expect(result.candidates[0].matches).toContain("编号匹配");
    expect(new URL((fetcher.mock.calls[0] as unknown as [string])[0]).searchParams.get("name")).toBe("SSIS-570");
    const edited = await service.search({ videoId: video.id, provider: "thunder", query: "SSIS-037", language: "any" });
    expect(edited.candidates.map(c => c.filename)).toEqual(["姓名SSIS-037.srt"]);
  });
  it("searches Thunder with release filename without eagerly downloading or sending credentials", async () => {
    const fetcher = vi.fn(async () => Response.json({ code: 0, result: "ok", data: [item("Movie.chn.srt"), item("Movie.srt"), item("Movie.zip", "zip")] }));
    const api = new SubtitleProviders(fetcher as typeof fetch);
    const results = await api.search("thunder", { assrtToken: "should-not-send" }, "Movie 2024", "any", "Movie.2024.1080p.mkv");
    expect(results).toHaveLength(2); expect(results[1].language).toBe("语言未确认");
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("name")).toBe("Movie.2024.1080p.mkv");
    expect(options.headers).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await api.search("thunder", {}, "Edited & title", "chinese")).map(c => c.filename)).toEqual(["Movie.chn.srt"]);
    expect(new URL((fetcher.mock.calls[1] as unknown as [string])[0]).searchParams.get("name")).toBe("Edited & title");
  });
  it("rejects API failures, archives and untrusted download links", async () => {
    const failed = new SubtitleProviders(vi.fn(async () => Response.json({ code: -1, result: "error" })) as typeof fetch);
    await expect(failed.search("thunder", {}, "Movie", "any")).rejects.toThrow("查询失败");
    const api = new SubtitleProviders(vi.fn(async () => Response.json({ code: 0, result: "ok", data: [item("evil.srt", "srt", "https://127.0.0.1/"), item("bad.zip", "zip")] })) as typeof fetch);
    expect(await api.search("thunder", {}, "Movie", "any")).toEqual([]);
    for (const provider of ["thunder", "subtitlecat"] as const) for (const url of ["https://subtitlecat.com.evil.example/file", "https://user@subtitle.v.geilijiasu.com/file", "https://127.0.0.1/file", "file:///C:/file", "https://subtitlecat.com:123/file"]) expect(() => validateDownloadUrl(url, provider)).toThrow();
  });
  it("checks every Thunder redirect and never forwards account headers", async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo, options?: RequestInit) => {
      expect(options?.headers).toBeUndefined(); expect(String(url)).toMatch(/^https:/);
      return new Response(null, { status: 302, headers: { location: "http://localhost/file.srt" } });
    });
    const api = new SubtitleProviders(fetcher as typeof fetch);
    await expect(api.download({ provider: "thunder", sourceFile: "http://subtitle.v.geilijiasu.com/file.srt" } as ProviderCandidate, { openSubtitlesPassword: "never-send" })).rejects.toThrow("不受信任");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses actual HTML structure and entities; finds matches after irrelevant early rows", () => {
    const results = parseCatResults(page(...Array.from({ length: 8 }, () => row("Unrelated")), row("Movie &amp; Title 2024.en")), "Movie Title 2024");
    expect(results).toEqual([{ title: "Movie & Title 2024.en", href: "subs/100/Movie.html", downloads: 1234 }]);
    expect(() => parseCatResults("<h1>Access blocked</h1>", "Movie")).toThrow("访问受限");
    expect(parseCatDownload('<a id="download_zh-CN" href="/file.srt?x=1&amp;y=2">Download</a>', "zh-CN")).toBe("/file.srt?x=1&y=2");
    expect(() => parseCatDownload('<a id="download_en" href="/file.srt">English</a>', "zh-CN")).toThrow("所选语言");
  });
  it("keeps Cat details and download links in main and fetches them only after selection", async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      if (String(url).includes("/index.php?")) return new Response(page(row("Movie 2024")));
      if (String(url).endsWith(".html")) return new Response('<a id="download_zh-CN" href="/files/Movie.srt">下载</a>');
      return new Response(srt);
    });
    const api = new SubtitleProviders(fetcher as typeof fetch);
    const result = await api.search("subtitlecat", {}, "Movie 2024", "chinese");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(result).toHaveLength(1);
    expect((await api.download(result[0], {})).toString()).toBe(srt);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(api.search("subtitlecat", {}, "Movie", "bilingual")).rejects.toThrow("双语");
  });
  it("rejects a malicious Cat download URL, and bounds HTML response sizes", async () => {
    const api = new SubtitleProviders(vi.fn(async () => new Response('<a id="download_en" href="https://evil.example/sub.srt">Download</a>')) as typeof fetch);
    await expect(api.download({ provider: "subtitlecat", sourceId: "https://subtitlecat.com/subs/1/movie.html", sourceFile: "en" } as ProviderCandidate, {})).rejects.toThrow("不受信任");
    const large = new SubtitleProviders(vi.fn(async () => new Response("x", { headers: { "content-length": String(3 * 1024 * 1024) } })) as typeof fetch);
    await expect(large.search("subtitlecat", {}, "Movie", "english")).rejects.toThrow("过大");
  });
  it("offers no-account sources even if credential decryption fails, and keeps saved versions readable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yingxia-free-sources-")); roots.push(root);
    const video = { id: "v1", filename: "Movie.2024.mkv", sizeBytes: 10, modifiedAt: "2026-10-05" } as VideoRecord;
    const account = { get: vi.fn(async () => { throw new Error("broken credentials"); }) } as unknown as SubtitleCredentialStore;
    const provider = new SubtitleProviders(vi.fn(async (url: URL | RequestInfo) => String(url).includes("/oracle/subtitle?") ? Response.json({ code: 0, result: "ok", data: [item("Movie.srt")] }) : new Response(srt)) as typeof fetch);
    const service = new SubtitleService({ getVideo: () => video }, root, account, provider);
    const direct = await service.search({ videoId: video.id, provider: "thunder", language: "any" });
    expect(account.get).not.toHaveBeenCalled(); expect(direct.candidates[0]).not.toHaveProperty("sourceFile"); expect(JSON.stringify(direct)).not.toContain("geilijiasu");
    const saved = await service.action({ videoId: video.id, op: "download", id: direct.candidates[0].id });
    expect(account.get).not.toHaveBeenCalled(); expect(saved.nativeVtt).toContain("00:00:01.500 --> 00:00:03.050");
    expect((await new SubtitleService({ getVideo: () => video }, root, account).getState(video.id)).items[0].provider).toBe("thunder");
    const aggregate = await service.search({ videoId: video.id, provider: "all", language: "any" });
    expect(aggregate.providers.map(p => [p.provider, p.status])).toEqual([["thunder", "ok"], ["assrt", "failed"], ["opensubtitles", "failed"]]);
    expect(aggregate.providers.some(p => p.provider === "subtitlecat")).toBe(false);
  });
});

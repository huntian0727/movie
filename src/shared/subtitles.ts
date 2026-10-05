import { z } from "zod";

export const subtitleProviderSchema = z.enum(["assrt", "opensubtitles", "thunder", "subtitlecat"]);
export type SubtitleProvider = z.infer<typeof subtitleProviderSchema>;
export const subtitleProviderLabels: Record<SubtitleProvider, string> = { assrt: "ASSRT 射手网", opensubtitles: "OpenSubtitles", thunder: "迅雷字幕", subtitlecat: "Subtitle Cat" };
export const subtitleProviderWebsites: Record<SubtitleProvider, string> = { assrt: "https://assrt.net/", opensubtitles: "https://www.opensubtitles.com/", thunder: "https://www.xunlei.com/", subtitlecat: "https://subtitlecat.com/" };
export const subtitleSearchSchema = z.object({
  videoId: z.string().min(1).max(128), query: z.string().trim().max(240).optional(),
  language: z.enum(["any", "chinese", "bilingual", "english"]).default("chinese"),
  provider: z.enum(["all", "assrt", "opensubtitles", "thunder", "subtitlecat"]).default("all")
}).strict();
export type SubtitleSearchRequest = z.input<typeof subtitleSearchSchema>;
export const subtitleActionSchema = z.object({
  videoId: z.string().min(1).max(128),
  op: z.enum(["download", "select", "offset", "export"]),
  id: z.string().uuid().nullable().optional(),
  offsetSeconds: z.number().finite().min(-600).max(600).optional()
}).strict().superRefine((v, ctx) => {
  if ((v.op === "download" || v.op === "export") && !v.id) ctx.addIssue({ code: "custom", message: "请选择字幕" });
  if (v.op === "select" && v.id === undefined) ctx.addIssue({ code: "custom", message: "请选择字幕或关闭字幕" });
  if (v.op === "offset" && v.offsetSeconds === undefined) ctx.addIssue({ code: "custom", message: "请输入字幕偏移" });
});
export type SubtitleAction = z.infer<typeof subtitleActionSchema>;
export const subtitleConfigSchema = z.object({
  assrtToken: z.string().trim().max(512).optional(),
  openSubtitlesApiKey: z.string().trim().max(512).optional(),
  openSubtitlesUsername: z.string().trim().max(128).optional(),
  openSubtitlesPassword: z.string().max(512).optional()
}).strict();
export type SubtitleCredentials = z.infer<typeof subtitleConfigSchema>;
export interface SubtitleConfigStatus {
  assrtConfigured: boolean; openSubtitlesConfigured: boolean;
  openSubtitlesAccountConfigured: boolean; storageAvailable: boolean;
}
export interface SubtitleCandidate {
  id: string; provider: SubtitleProvider; title: string; language: string;
  release: string; filename: string; format: string;
  score: number; matches: string[]; downloads: number | null;
}
export interface SubtitleSearchResult {
  query: string; candidates: SubtitleCandidate[];
  providers: Array<{ provider: SubtitleProvider; status: "ok" | "unconfigured" | "failed"; message: string }>;
}
export interface SavedSubtitle {
  id: string; provider: SubtitleProvider; title: string; language: string; release: string;
  filename: string; format: "srt" | "ass" | "vtt"; downloadedAt: string;
}
export interface SubtitleState {
  videoId: string; items: SavedSubtitle[]; selectedId: string | null; offsetSeconds: number;
  nativeVtt: string | null; message?: string;
}
export type SubtitleApi = {
  openSubtitleWebsite(provider: SubtitleProvider): Promise<void>;
  getSubtitleConfig(): Promise<SubtitleConfigStatus>;
  saveSubtitleConfig(input: SubtitleCredentials): Promise<SubtitleConfigStatus>;
  searchSubtitles(input: SubtitleSearchRequest): Promise<SubtitleSearchResult>;
  getSubtitleState(videoId: string): Promise<SubtitleState>;
  subtitleAction(input: SubtitleAction): Promise<SubtitleState>;
};

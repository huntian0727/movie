import type { SubtitleSearchRequest, SubtitleSearchResult } from "../../shared/subtitles";
import type { VideoRecord } from "../../shared/videoTypes";
import type { PlayerSubtitleApi } from "./SubtitleDialog";
import { suggestSubtitleQuery } from "../../shared/subtitleQuery";

export type SearchPreferences = { language: "any" | "chinese" | "bilingual" | "english"; provider: NonNullable<SubtitleSearchRequest["provider"]> };
const preferenceKey = "movie.subtitle-search.preferences.v1";
const ttl = 5 * 60_000;
const caches = new WeakMap<PlayerSubtitleApi, Map<string, { until: number; work: Promise<SubtitleSearchResult> }>>();
const queries = new Map<string, string>();
export const subtitleVideoKey = (video: VideoRecord) => JSON.stringify([video.id, video.filename, video.sizeBytes, video.modifiedAt]);
export function readSubtitlePreferences(): SearchPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || "null");
    if (["any", "chinese", "bilingual", "english"].includes(value?.language) && ["all", "thunder", "subtitlecat", "assrt", "opensubtitles"].includes(value?.provider)) return { language: value.language, provider: value.provider };
  } catch { /* Search remains available when preference storage is disabled. */ }
  return { language: "any", provider: "thunder" };
}
export function saveSubtitlePreferences(value: SearchPreferences) {
  try { localStorage.setItem(preferenceKey, JSON.stringify(value)); } catch { /* Optional preference. */ }
}
export function subtitleQuery(video: VideoRecord) {
  return queries.get(subtitleVideoKey(video)) ?? suggestSubtitleQuery(video.filename);
}
export async function searchSubtitleCache(api: PlayerSubtitleApi, video: VideoRecord, input: SubtitleSearchRequest, fresh = false) {
  let cache = caches.get(api);
  if (!cache) { cache = new Map(); caches.set(api, cache); }
  const key = JSON.stringify([subtitleVideoKey(video), input.query?.trim(), input.language, input.provider]);
  const previous = cache.get(key);
  if (!fresh && previous && previous.until > Date.now()) return previous.work;
  for (const [id, entry] of cache) if (entry.until <= Date.now()) cache.delete(id);
  while (cache.size >= 30) cache.delete(cache.keys().next().value!);
  queries.set(subtitleVideoKey(video), input.query?.trim() || subtitleQuery(video));
  while (queries.size > 30) queries.delete(queries.keys().next().value!);
  const entry = { until: Infinity, work: Promise.resolve(null as unknown as SubtitleSearchResult) };
  entry.work = api.searchSubtitles(input).then(result => {
    entry.until = Date.now() + ttl;
    // Failed searches may be retried immediately; successful empty results are cached.
    if (!result.providers.some(p => p.status === "ok") && cache!.get(key) === entry) cache!.delete(key);
    return result;
  }, error => { if (cache!.get(key) === entry) cache!.delete(key); throw error; });
  cache.set(key, entry);
  return entry.work;
}
export function recommendedSubtitles(result: SubtitleSearchResult) {
  const priority = (language: string) => /中|zh|chinese|mandarin|双语/i.test(language) ? 1 : 0;
  return [...result.candidates].sort((a, b) => priority(b.language) - priority(a.language) || b.score - a.score);
}

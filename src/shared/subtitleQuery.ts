/** Structured release IDs take precedence over descriptive text. No network or paths. */
export function subtitleCodes(text: string): string[] {
  const value = text.normalize("NFKC").toUpperCase().replace(/[‐‑–—−]/g, "-");
  const codes = new Set<string>();
  for (const match of value.matchAll(/(?:^|[^A-Z0-9])FC2[-_ .]*(?:PPV[-_ .]*)?(\d{5,9})(?=$|[^A-Z0-9])/g)) codes.add(`FC2-PPV-${match[1]}`);
  for (const match of value.matchAll(/(?:^|[^A-Z0-9])([A-Z]{2,10})([-_ .]+)(\d{3,7})(?=$|[^A-Z0-9])/g)) {
    const [, prefix, separator, digits] = match;
    const series = /^(?:SSIS|SSNI|SNIS|SONE|STARS|MIDV|MIDE|IPX|IPZZ|FSDSS|CAWD|ABP|ADN|JUQ|JUL|PRED|DASS)$/.test(prefix);
    if (!series && !/[-_]/.test(separator)) continue;
    if (!series && /^(?:19|20)\d{2}$/.test(digits) || /^(?:PPV|VIDEO|MOVIE|TEST|WEB|HDTV|XVID|DIVX|AVC|HEVC|AAC|DTS)$/.test(prefix)) continue;
    codes.add(`${prefix}-${digits}`);
  }
  // Compact names are recognized only for explicit series prefixes, avoiding Movie2024 etc.
  for (const match of value.matchAll(/(?:^|[^A-Z0-9])(SSIS|SSNI|SNIS|SONE|STARS|MIDV|MIDE|IPX|IPZZ|FSDSS|CAWD|ABP|ADN|JUQ|JUL|PRED|DASS)(\d{3,7})(?=$|[^A-Z0-9])/g)) codes.add(`${match[1]}-${match[2]}`);
  return [...codes];
}
export const subtitleCode = (text: string) => subtitleCodes(text)[0] ?? null;
const comparableCode = (value: string) => value.replace(/-0+(?=\d+$)/, "-");
export function matchesSubtitleCode(candidate: { title: string; release: string; filename: string }, code: string): boolean {
  return [candidate.title, candidate.release, candidate.filename].some(text => subtitleCodes(text).some(value => comparableCode(value) === comparableCode(code)));
}
export function suggestSubtitleQuery(filename: string): string {
  const code = subtitleCode(filename);
  if (code) return code;
  return filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[._]/g, " ")
    .replace(/\b(?:480p|720p|1080[pi]|2160p|4k|8k|blu[ -]?ray|b[dr]rip|web[ -]?(?:dl|rip)|hdtv|dvdrip|remux|x26[45]|h26[45]|hevc|avc|aac|ac3|dts|truehd|atmos)\b.*$/i, "")
    .replace(/[\[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

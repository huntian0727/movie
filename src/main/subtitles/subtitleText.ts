export interface SubtitleCue { start: number; end: number; text: string }
const timestamp = (s: string) => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000 : NaN;
};
export function decodeSubtitle(data: Buffer): string {
  if (data.length > 4 * 1024 * 1024) throw new Error("字幕文件超过 4 MiB 限制");
  let text: string;
  if (data[0] === 0xff && data[1] === 0xfe) text = new TextDecoder("utf-16le").decode(data);
  else if (data[0] === 0xfe && data[1] === 0xff) text = new TextDecoder("utf-16be").decode(data);
  else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
    catch { text = new TextDecoder("gb18030", { fatal: true }).decode(data); }
  }
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\0/g, "");
  if (/^\s*(?:<!doctype|<html|PK\x03\x04)/i.test(text)) throw new Error("下载内容不是可用字幕，请更换版本");
  return text;
}
export function parseSubtitle(text: string): { format: "srt" | "ass" | "vtt"; cues: SubtitleCue[] } {
  const ass = /^\s*\[Script Info\]/im.test(text) && /^\s*\[Events\]/im.test(text);
  const format = ass ? "ass" : /^WEBVTT/.test(text) ? "vtt" : "srt";
  const cues: SubtitleCue[] = [];
  if (ass) {
    let fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"], events = false;
    for (const line of text.split("\n")) {
      if (/^\[/.test(line)) events = /^\[Events\]/i.test(line);
      if (!events) continue;
      if (/^Format:/i.test(line)) fields = line.slice(7).split(",").map(s => s.trim().toLowerCase());
      if (!/^Dialogue:/i.test(line)) continue;
      const rest = line.slice(9).trim(), parts = rest.split(",");
      if (parts.length < fields.length || fields[fields.length - 1] !== "text") continue;
      const content = parts.slice(fields.length - 1).join(",").replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ");
      cues.push({ start: timestamp(parts[fields.indexOf("start")] ?? ""), end: timestamp(parts[fields.indexOf("end")] ?? ""), text: content });
    }
  } else {
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split("\n"), index = lines.findIndex(l => l.includes("-->"));
      if (index < 0) continue;
      const times = lines[index].split("-->");
      cues.push({ start: timestamp(times[0]), end: timestamp(times[1]?.trim().split(/\s+/)[0] ?? ""), text: lines.slice(index + 1).join("\n") });
    }
  }
  const valid = cues.filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start && c.text.trim());
  if (!valid.length || valid.length > 100_000) throw new Error("字幕没有有效时间轴，请选择其他版本");
  return { format, cues: valid.sort((a, b) => a.start - b.start) };
}
function clock(n: number): string {
  const ms = Math.round(Math.max(0, n) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
export function toVtt(cues: SubtitleCue[], offset = 0): string {
  return "WEBVTT\n\n" + cues.filter(c => c.end + offset > 0).map(c => `${clock(c.start + offset)} --> ${clock(c.end + offset)}\n${c.text.replace(/<[^>]*>/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}\n`).join("\n");
}

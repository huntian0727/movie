import { parse, type DefaultTreeAdapterTypes } from "parse5";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const element = (node: Node): node is Element => "tagName" in node;
const attr = (node: Element, key: string) => node.attrs.find(a => a.name === key)?.value ?? "";
function nodes(root: Node): Node[] {
  const result: Node[] = [], pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (result.length >= 50_000) throw new Error("字幕网站页面结构过大，请换用其他来源");
    result.push(node);
    if (element(node) && ["script", "style", "template"].includes(node.tagName)) continue;
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
  return result;
}
const text = (node: Node) => nodes(node).filter(n => "value" in n).map(n => (n as DefaultTreeAdapterTypes.TextNode).value).join(" ").replace(/\s+/g, " ").trim();
const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function parseCatResults(html: string, query: string): Array<{ title: string; href: string; downloads: number | null }> {
  const all = nodes(parse(html));
  const table = all.find(n => element(n) && n.tagName === "table" && attr(n, "class").split(/\s+/).includes("sub-table"));
  if (!table) throw new Error("字幕网站页面结构变化或访问受限，请换用其他来源");
  const wanted = normalized(query).split(/\s+/).filter(Boolean);
  const results: Array<{ title: string; href: string; downloads: number | null }> = [];
  const seen = new Set<string>();
  for (const row of nodes(table).filter(n => element(n) && n.tagName === "tr")) {
    const cells = "childNodes" in row ? row.childNodes.filter(n => element(n) && n.tagName === "td") : [];
    if (!cells.length) continue;
    const link = nodes(cells[0]).find(n => element(n) && n.tagName === "a" && attr(n, "href"));
    if (!link || !element(link)) continue;
    const title = text(link).slice(0, 2000), href = attr(link, "href");
    const candidate = normalized(title);
    if (!wanted.every(word => candidate.includes(word)) || seen.has(href)) continue;
    seen.add(href);
    const rowText = text(row), count = /Downloads\s*([\d,]+)/i.exec(rowText)?.[1] ?? (cells[2] ? /^\s*([\d,]+)\s*$/.exec(text(cells[2]))?.[1] : undefined);
    results.push({ title, href, downloads: count ? Number(count.replace(/,/g, "")) : null });
    if (results.length >= 10) break;
  }
  return results;
}
export function parseCatDownload(html: string, language: string): string {
  const link = nodes(parse(html)).find(n => element(n) && n.tagName === "a" && attr(n, "id") === `download_${language}`);
  if (!link || !element(link) || !attr(link, "href")) throw new Error("该版本未提供所选语言的下载文件，请选择其他字幕");
  return attr(link, "href");
}

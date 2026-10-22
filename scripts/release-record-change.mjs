/** Append a categorized development change, with no GitHub or application side effects. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../docs/releases/NEXT-CHANGES.md");
export const categories = { safety: "安全类", performance: "性能类", feature: "功能增加类" };
export const initialLog = "# 下一版改动记录（尚未发布）\n\n" +
  "每次开发完成后记录，发布时整理到 CHANGELOG.md 和 docs/releases/<版本>.md。\n" +
  "不要把仅计划或尚未验证的内容标记为完成。\n\n" +
  "## 安全类\n\n## 性能类\n\n## 功能增加类\n";

export function formatEntry({ date, category, text, tests }) {
  if (!categories[category]) throw new Error("类别只能是 safety、performance、feature");
  if (typeof text !== "string" || text.trim().length < 3 || /[\r\n]/.test(text))
    throw new Error("请用一行至少三个字描述真实变化");
  if (typeof tests !== "string" || /[\r\n]/.test(tests))
    throw new Error("测试结果只能写一行");
  return "- " + date + "：" + text.trim().replace(/\s+/g, " ") +
    "（验证：" + (tests.trim() || "尚未验证，发布前补验收") + "）";
}

export function addEntry(content, entry) {
  const heading = "## " + categories[entry.category];
  const value = formatEntry(entry);
  if (content.includes(value)) return { content, added: false };
  const start = content.indexOf(heading);
  if (start < 0) throw new Error("缺少记录分类标题：" + heading);
  const nextHeading = content.indexOf("\n## ", start + heading.length);
  const end = nextHeading < 0 ? content.length : nextHeading + 1;
  const before = content.slice(0, end).trimEnd();
  const after = content.slice(end).trimStart();
  return { content: before + "\n\n" + value + "\n" + (after ? "\n" + after : ""), added: true };
}

export function parseNoteArgs(argv) {
  const options = { category: null, text: null, tests: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--category") options.category = argv[++i];
    else if (argv[i] === "--text") options.text = argv[++i];
    else if (argv[i] === "--tests") options.tests = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") options.help = true;
    else throw new Error("未知参数：" + argv[i]);
  }
  if (!options.help && (!categories[options.category] || !options.text))
    throw new Error("用法：--category safety|performance|feature --text 描述 [--tests 实际测试]");
  return options;
}

async function main() {
  const args = parseNoteArgs(process.argv.slice(2));
  if (args.help) {
    console.log('npm run release:note -- --category feature --text "增加播放器倍速" --tests "专项测试 PASS"');
    return;
  }
  let content;
  try { content = await readFile(target, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; content = initialLog; }
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const updated = addEntry(content, { ...args, date });
  if (updated.added) await writeFile(target, updated.content, "utf8");
  console.log(updated.added ? "已记录：" + categories[args.category] : "已经存在完全相同的记录");
  console.log("交付功能时仍须同步 CHANGELOG.md 与受影响的教程。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => { console.error(error.message); process.exitCode = 2; });

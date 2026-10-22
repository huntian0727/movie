import { describe, it, expect } from "vitest";
import { categories, initialLog, formatEntry, addEntry, parseNoteArgs } from "../../scripts/release-record-change.mjs";

describe("release changes are logged during development", () => {
  it("supports the exact three requested release categories", () => {
    expect(Object.values(categories)).toEqual(["安全类", "性能类", "功能增加类"]);
    expect(parseNoteArgs(["--category", "safety", "--text", "保护删除队列"]).category).toBe("safety");
    expect(() => parseNoteArgs(["--category", "other", "--text", "foo"])).toThrow();
    expect(() => formatEntry({ date: "2026-10-22", category: "feature", text: "a\nb", tests: "" })).toThrow();
  });

  it("records under the appropriate heading and does not duplicate retries", () => {
    const entry = { date: "2026-10-22", category: "performance", text: "减少队列耗时", tests: "回归 PASS" };
    const first = addEntry(initialLog, entry);
    expect(first.added).toBe(true);
    expect(first.content.indexOf("减少队列耗时")).toBeGreaterThan(first.content.indexOf("## 性能类"));
    expect(first.content.indexOf("减少队列耗时")).toBeLessThan(first.content.indexOf("## 功能增加类"));
    expect(addEntry(first.content, entry)).toEqual({ content: first.content, added: false });
  });
});

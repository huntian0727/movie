import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8");

describe("duplicate safety workflow styles", () => {
  it("defines non-destructive verification colors and visible focus for every safety control", () => {
    expect(css).toMatch(/--workflow-accent:\s*#[0-9a-f]{6}/i);
    expect(css).toMatch(/\.verification-action[\s\S]*background:\s*#28485c/);
    expect(css).toMatch(/\.duplicate-page :is\(button, input, select, a, \[role="button"\]\):focus-visible/);
    expect(css).toMatch(/outline:\s*3px solid #9fd8ff/);
  });

  it("resolves task-center tokens and preserves the 900px two-column layout gate", () => {
    expect(css).toMatch(/--border-color:\s*#343734/);
    expect(css).not.toMatch(/var\(--accent\)/);
    expect(css).toMatch(/\.duplicate-task-center\s*\{[^}]*width:\s*min\(1080px, 92vw\)/);
    expect(css).toMatch(/\.duplicate-task-layout\s*\{[^}]*grid-template-columns:\s*minmax\(280px, 38%\) 1fr/);
    expect(css).toMatch(/@media \(max-width: 760px\)/);
  });

  it("disables workflow animation when reduced motion is requested", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\.duplicate-page \.spin, \.task-center-backdrop \.spin\s*\{\s*animation:\s*none !important/);
  });
});

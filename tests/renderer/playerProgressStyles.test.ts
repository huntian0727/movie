import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/renderer/styles.css", "utf8");
const rules = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selectors]) => selectors.trim() === selector).map(([, , declarations]) => declarations).join(";");

describe("player timeline layout", () => {
  it("triples normal and fullscreen track thickness without changing timeline width", () => {
    expect(rules(".progress-wrap > input")).toMatch(/height:\s*12px/);
    expect(rules(".progress-wrap > input")).toMatch(/width:\s*100%/);
    expect(rules(".player-page.is-fullscreen .progress-wrap > input")).toMatch(/height:\s*18px/);
  });
  it("positions the preview above the bar on both decode routes", () => {
    expect(rules(".progress-preview")).toMatch(/bottom:\s*calc\(100% \+ 8px\)/);
    expect(rules(".progress-preview")).toMatch(/top:\s*auto/);
    expect(rules(".player-page.uses-embedded-engine .progress-preview")).toBe("");
    expect(rules(".player-embedded-surface")).toContain("inset: 0");
    expect(css).not.toContain("--hover-preview-clearance");
  });
});

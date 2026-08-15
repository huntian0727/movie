import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("project scaffold", () => {
  it("defines the expected app scripts", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.dev).toBeUndefined();
    expect(pkg.scripts["dev:renderer"]).toBe("vite --host 127.0.0.1");
    expect(pkg.scripts["dev:electron"]).toBe("npm run verify:native:electron && node scripts/start-desktop.mjs");
    expect(pkg.scripts.test).toBe("npm run test:node");
    expect(pkg.scripts["test:node"]).toContain("verify:native:node");
    expect(pkg.scripts["test:electron-smoke"]).toContain("scripts/run-electron-smoke.mjs");
    expect(pkg.scripts["test:windows-files"]).toContain("tests/gates/syntheticLibrary.test.ts");
    expect(pkg.scripts["test:release-performance"]).toContain("tests/gates/performanceBaselines.test.ts");
    expect(pkg.scripts["test:release-gate"]).toContain("npm run test:node");
    expect(pkg.scripts["package:dir"]).toContain("prepare:electron");
    expect(pkg.scripts["package:dir"]).toContain("scripts/run-electron-builder.mjs --dir");
    expect(pkg.scripts["dist:win"]).toContain("scripts/run-electron-builder.mjs --win-nsis");
    expect(pkg.scripts["test:packaged-smoke"]).toContain("scripts/run-packaged-smoke.mjs");
    expect(pkg.scripts["test:installer-smoke"]).toContain("scripts/run-installer-smoke.mjs");
    expect(pkg.scripts.build).toBe("npm run clean && tsc -p tsconfig.node.json && tsc -p tsconfig.web.json && vite build");
    expect(pkg.engines).toEqual({ node: "22.23.1", npm: "10.9.8" });
    expect(pkg.packageManager).toBe("npm@10.9.8");
    expect(readFileSync(".nvmrc", "utf8").trim()).toBe("22.23.1");
  });

  it("declares explicit React runtime and type dependencies", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.dependencies["react-dom"]).toBeDefined();
    expect(pkg.devDependencies["@types/react"]).toBeDefined();
    expect(pkg.devDependencies["@types/react-dom"]).toBeDefined();
  });

  it("has an Electron main source for the configured output entry", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.main).toBe("dist-main/main/index.js");
    expect(existsSync("src/main/index.ts")).toBe(true);
  });

  it("has a desktop launcher that starts the dev server first", () => {
    expect(existsSync("scripts/start-desktop.mjs")).toBe(true);
    const launcher = readFileSync("scripts/start-desktop.mjs", "utf8");
    expect(launcher).toContain('path.join("node_modules", "vite", "bin", "vite.js")');
    expect(launcher).toContain("spawnElectron");
    expect(launcher).not.toContain("npm run dev");
  });

  it("builds renderer assets with file-compatible relative paths", () => {
    expect(readFileSync("vite.config.ts", "utf8")).toMatch(/base:\s*["']\.\/["']/);
  });

  it("has independent Windows CI, release, and dependency update policies", () => {
    const ci = readFileSync(".github/workflows/windows-ci.yml", "utf8");
    const release = readFileSync(".github/workflows/windows-release.yml", "utf8");
    expect(ci).toContain("Node tests and Windows file safety");
    expect(ci).toContain("npm run test:release-gate");
    expect(ci).toContain("Electron native and main-process smoke");
    expect(ci).not.toContain("continue-on-error");
    expect(release).toContain("npm run test:release-gate");
    expect(release).toContain("npm audit --omit=dev");
    expect(release).toContain("npm run test:packaged-smoke");
    expect(release).toContain("npm run test:installer-smoke");
    expect(release).toContain("WINDOWS_CSC_LINK");
    expect(readFileSync("electron-builder.yml", "utf8")).toContain("deleteAppDataOnUninstall: false");
    expect(existsSync(".github/dependabot.yml")).toBe(true);
  });
});

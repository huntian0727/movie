import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planDependencyLifecycles } from "../../scripts/install-locked-dependencies.mjs";
const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(entries) {
  const root = await mkdtemp(path.join(os.tmpdir(), "movie-install-plan-")); roots.push(root);
  const lock = { packages: { "": {}, ...Object.fromEntries(entries.map(([location, manifest]) => [location, { version: manifest.version }])) } };
  for (const [location, manifest, gyp] of entries) {
    await mkdir(path.join(root, location), { recursive: true });
    await writeFile(path.join(root, location, "package.json"), JSON.stringify(manifest));
    if (gyp) await writeFile(path.join(root, location, "binding.gyp"), "{}");
  }
  return { root, lock };
}
it("honors N-API opt-out while retaining authored install scripts", async () => {
  const { root, lock } = await fixture([
    ["node_modules/sqlite", { name: "sqlite", version: "13.0.3", gypfile: false }, true],
    ["node_modules/media", { name: "media", version: "1", gypfile: false, scripts: { postinstall: "download" } }, true],
    ["node_modules/native", { name: "native", version: "1" }, true]
  ]);
  expect(await planDependencyLifecycles(root, lock)).toEqual([path.join(root, "node_modules/media"), path.join(root, "node_modules/native")]);
});
it("selects exact directories without pulling in another version's opt-out", async () => {
  const { root, lock } = await fixture([
    ["node_modules/sqlite", { name: "sqlite", version: "13", gypfile: false }, true],
    ["node_modules/legacy/node_modules/sqlite", { name: "sqlite", version: "11" }, true]
  ]);
  expect(await planDependencyLifecycles(root, lock)).toEqual([path.join(root, "node_modules/legacy/node_modules/sqlite")]);
});
it("refuses missing required packages, mismatched versions and traversal", async () => {
  const { root, lock } = await fixture([["node_modules/pkg", { name: "pkg", version: "1" }]]);
  lock.packages["node_modules/pkg"].version = "2";
  await expect(planDependencyLifecycles(root, lock)).rejects.toThrow("version");
  await expect(planDependencyLifecycles(root, { packages: { "node_modules/missing": { version: "1" } } })).rejects.toThrow();
  await expect(planDependencyLifecycles(root, { packages: { "../outside": { version: "1" } } })).rejects.toThrow("path");
});
it("permits absent optional platform packages only", async () => {
  const { root } = await fixture([]);
  expect(await planDependencyLifecycles(root, { packages: { "node_modules/optional": { version: "1", optional: true } } })).toEqual([]);
});

const path = require("node:path");
const fs = require("node:fs/promises");
module.exports = async (context) => {
  const { packagedFileManifest, renderRemovalManifest, writeJson } = await import("./release-engineering.mjs");
  const root = context.packager.projectDir;
  const manifest = await packagedFileManifest(context.appOutDir);
  await fs.mkdir(path.join(root, ".tmp", "release-engineering"), { recursive: true });
  await fs.writeFile(path.join(root, ".tmp", "release-engineering", "owned-files.nsh"), renderRemovalManifest(manifest), "utf8");
  await writeJson(path.join(root, ".tmp", "release-engineering", "owned-files.json"), manifest);
};

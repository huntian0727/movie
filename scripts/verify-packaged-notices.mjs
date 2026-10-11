/**
 * Verifies installed licensing materials really match the reviewed working tree.
 * Separate from legal approval: correctness of bytes does not certify LGPL compliance.
 */
import { lstat } from "node:fs/promises";
import path from "node:path";
import { hashFile } from "./release-engineering.mjs";

export const packagedNoticeMap = Object.freeze([
  ["LICENSE", "legal/PROJECT-LICENSE.txt"],
  ["THIRD_PARTY_LICENSES.md", "legal/THIRD_PARTY_LICENSES.md"],
  ["docs/legal/THIRD_PARTY_RELEASE_NOTICES.md", "legal/THIRD_PARTY_RELEASE_NOTICES.md"],
  ["docs/legal/FFMPEG_BUILD_INFO.md", "legal/FFMPEG_BUILD_INFO.md"],
  ["docs/legal/FFMPEG_SOURCE_NOTICE.md", "legal/FFMPEG_SOURCE_NOTICE.md"],
  ["docs/legal/NATIVE_COMPONENTS.md", "legal/NATIVE_COMPONENTS.md"],
  ["docs/legal/FFMPEG-LITE-SBOM.spdx.json", "legal/FFMPEG-LITE-SBOM.spdx.json"],
  ["docs/legal/MPV_SOURCE_NOTICE.md", "legal/MPV_SOURCE_NOTICE.md"],
]);

async function requireRegular(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0)
    throw new Error("Required third-party notice missing, empty or linked: " + file);
}

/**
 * All paths are hardcoded trusted paths from packagedNoticeMap (no user paths).
 * Verify actual files and contents, including absence of symlink substitution.
 */
export async function verifyPackagedNotices(root, resources) {
  for (const [sourceRelative, packedRelative] of packagedNoticeMap) {
    const source = path.join(root, sourceRelative);
    const packed = path.join(resources, packedRelative);
    await requireRegular(source);
    await requireRegular(packed);
    if (await hashFile(source) !== await hashFile(packed))
      throw new Error("Packaged legal notice differs from source: " + packedRelative);
  }
  return packagedNoticeMap.length;
}

import path from "node:path";

export function mediaVariant(env = process.env) {
  const candidate = env.MOVIE_MEDIA_VARIANT || "btbn-candidate";
  if (!["btbn-candidate", "lite-candidate", "source-candidate"].includes(candidate)) {
    throw new Error("Unknown media variant; refuse unreviewed native inputs");
  }
  return candidate;
}
export function candidateDirectory(root, variant) {
  if (variant === "btbn-candidate") return path.join(root,"native-bin","media-tools");
  if (variant === "lite-candidate") return path.join(root,".tmp","native-media-lite-tools");
  if (variant === "source-candidate") return path.join(root,".tmp","native-source-media-tools");
  throw new Error("Unsupported media variant");
}
export const liteRuntime = ["libvpl-2.dll","libopenh264-7.dll","libwinpthread-1.dll","libgcc_s_seh-1.dll","libstdc++-6.dll"];
export const liteNotices = ["COPYING.LGPLv2.1","SOURCE.txt","LIBVPL-LICENSE.txt","LIBOPENH264-LICENSE.txt","LIBWINPTHREAD-LICENSE.txt","GCC-LICENSE.txt"];
export const liteFiles = ["ffmpeg.exe","ffprobe.exe","LICENSE.txt","SOURCE-STATUS.txt",...liteRuntime,...liteNotices];

export function mediaLockPath(root, variant) {
  const names = { "btbn-candidate": "native-media-candidate.lock.json", "lite-candidate": "native-media-lite.lock.json", "source-candidate": "native-source-media.lock.json" };
  if (!Object.hasOwn(names, variant)) throw new Error("Unsupported media variant");
  return path.join(root, "scripts", names[variant]);
}

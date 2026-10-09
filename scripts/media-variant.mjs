import path from "node:path";

export function mediaVariant(env = process.env) {
  const candidate = env.MOVIE_MEDIA_VARIANT || "btbn-candidate";
  if (candidate !== "btbn-candidate" && candidate !== "lite-candidate") {
    throw new Error("Unknown media variant; refuse unreviewed native inputs");
  }
  return candidate;
}
export function candidateDirectory(root, variant) {
  if (variant === "btbn-candidate") return path.join(root,"native-bin","media-tools");
  if (variant === "lite-candidate") return path.join(root,".tmp","native-media-lite-tools");
  throw new Error("Unsupported media variant");
}
export const liteRuntime = ["libvpl-2.dll","libopenh264-7.dll","libwinpthread-1.dll","libgcc_s_seh-1.dll","libstdc++-6.dll"];
export const liteNotices = ["COPYING.LGPLv2.1","SOURCE.txt","LIBVPL-LICENSE.txt","LIBOPENH264-LICENSE.txt","LIBWINPTHREAD-LICENSE.txt","GCC-LICENSE.txt"];
export const liteFiles = ["ffmpeg.exe","ffprobe.exe","LICENSE.txt","SOURCE-STATUS.txt",...liteRuntime,...liteNotices];

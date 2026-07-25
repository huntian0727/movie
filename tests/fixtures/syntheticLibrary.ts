import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

export interface SyntheticLibrary {
  root: string;
  identical: [string, string];
  sameSizeDifferentContent: [string, string];
  conflictSource: string;
  conflictTarget: string;
  tinyVideo: string;
}

export async function createSyntheticLibrary(root: string): Promise<SyntheticLibrary> {
  const library = path.join(root, "library");
  const source = path.join(root, "move-source");
  const target = path.join(root, "move-target");
  await Promise.all([
    mkdir(library, { recursive: true }),
    mkdir(source, { recursive: true }),
    mkdir(target, { recursive: true })
  ]);

  const identical: [string, string] = [
    path.join(library, "identical-a.bin"),
    path.join(library, "identical-b.bin")
  ];
  const sameSizeDifferentContent: [string, string] = [
    path.join(library, "same-size-a.bin"),
    path.join(library, "same-size-b.bin")
  ];
  const conflictSource = path.join(source, "conflict.mp4");
  const conflictTarget = path.join(target, "conflict.mp4");
  const tinyVideo = path.join(library, "tiny-fixture.mp4");

  await Promise.all([
    writeFile(identical[0], Buffer.from("identical-content")),
    writeFile(identical[1], Buffer.from("identical-content")),
    writeFile(sameSizeDifferentContent[0], Buffer.from("AAAA")),
    writeFile(sameSizeDifferentContent[1], Buffer.from("BBBB")),
    writeFile(conflictSource, Buffer.from("source-video")),
    writeFile(conflictTarget, Buffer.from("existing-target"))
  ]);

  const ffmpegPath = require("ffmpeg-static") as string | null;
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not provide an executable for the synthetic fixture");
  }
  await execFileAsync(ffmpegPath, [
    "-hide_banner",
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", "color=c=black:s=32x24:d=0.2",
    "-an",
    "-c:v", "mpeg4",
    "-pix_fmt", "yuv420p",
    "-y",
    tinyVideo
  ], { windowsHide: true, timeout: 30_000 });

  return {
    root,
    identical,
    sameSizeDifferentContent,
    conflictSource,
    conflictTarget,
    tinyVideo
  };
}

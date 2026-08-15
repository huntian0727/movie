import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { readMetadata } from "../dist-main/main/media/metadataService.js";
import { choosePlaybackRoute } from "../dist-main/shared/playbackRouting.js";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "video-manager-codec-validation-"));
const samples = [
  {
    name: "h264-mp4",
    extension: ".mp4",
    output: path.join(tempDirectory, "h264.mp4"),
    args: ["-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-c:a", "aac"]
  },
  {
    name: "hevc-mp4",
    extension: ".mp4",
    output: path.join(tempDirectory, "hevc.mp4"),
    args: ["-f", "lavfi", "-i", "color=c=green:s=320x180:d=1", "-c:v", "libx265", "-pix_fmt", "yuv420p", "-an"]
  },
  {
    name: "vp9-webm",
    extension: ".webm",
    output: path.join(tempDirectory, "vp9.webm"),
    args: ["-f", "lavfi", "-i", "color=c=red:s=320x180:d=1", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:v", "libvpx-vp9", "-c:a", "libopus"]
  }
];

try {
  const results = [];
  for (const sample of samples) {
    execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...sample.args, sample.output], {
      stdio: "pipe",
      timeout: 60_000
    });
    const metadata = await readMetadata(sample.output);
    results.push({
      sample: sample.name,
      videoCodec: metadata.videoCodec,
      videoProfile: metadata.videoProfile,
      pixelFormat: metadata.pixelFormat,
      audioCodec: metadata.audioCodec,
      autoRoute: choosePlaybackRoute({ extension: sample.extension, ...metadata }, "auto")
    });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

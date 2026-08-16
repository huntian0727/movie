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
    expectedRoute: "native",
    extension: ".mp4",
    output: path.join(tempDirectory, "h264.mp4"),
    args: ["-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-c:a", "aac"]
  },
  {
    name: "hevc-mp4",
    expectedRoute: "mpv",
    extension: ".mp4",
    output: path.join(tempDirectory, "hevc.mp4"),
    args: ["-f", "lavfi", "-i", "color=c=green:s=320x180:d=1", "-c:v", "libx265", "-pix_fmt", "yuv420p", "-an"]
  },
  {
    name: "vp9-webm",
    expectedRoute: "native",
    extension: ".webm",
    output: path.join(tempDirectory, "vp9.webm"),
    args: ["-f", "lavfi", "-i", "color=c=red:s=320x180:d=1", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-c:a", "libopus"]
  },
  {
    name: "vp9-10bit-webm",
    expectedRoute: "mpv",
    extension: ".webm",
    output: path.join(tempDirectory, "vp9-10bit.webm"),
    args: ["-f", "lavfi", "-i", "color=c=yellow:s=320x180:d=1", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-c:v", "libvpx-vp9", "-profile:v", "2", "-pix_fmt", "yuv420p10le", "-c:a", "libopus"]
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
    const autoRoute = choosePlaybackRoute({
      extension: sample.extension,
      ...metadata,
      metadataStatus: "ready",
      codecProbeStatus: "ready"
    }, "auto");
    if (autoRoute !== sample.expectedRoute) {
      throw new Error(`${sample.name} routed to ${autoRoute}; expected ${sample.expectedRoute}`);
    }
    results.push({
      sample: sample.name,
      videoCodec: metadata.videoCodec,
      videoProfile: metadata.videoProfile,
      pixelFormat: metadata.pixelFormat,
      audioCodec: metadata.audioCodec,
      autoRoute
    });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

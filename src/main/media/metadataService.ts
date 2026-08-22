import { createRequire } from "node:module";
import { execa } from "execa";
import { resolvePackagedExecutablePath } from "./packagedExecutable.js";

export interface MediaMetadata {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  videoCodec?: string | null;
  videoProfile?: string | null;
  pixelFormat?: string | null;
  audioCodec?: string | null;
}

export type ProbeProfile = "local" | "cloud";

export interface FfprobeOutput {
  format?: {
    duration?: string;
    format_name?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
  }>;
}

interface FfprobeStaticModule {
  path: string;
}

interface ProbeResult {
  stdout: string;
}

interface MetadataReaderDependencies {
  ffprobePath?: string;
  /** "cloud" uses tighter probesize/analyzeduration to reduce bytes read over network drives. */
  probeProfile?: ProbeProfile;
  runProbe?: (ffprobePath: string, filePath: string, profile: ProbeProfile) => Promise<ProbeResult>;
}

const CLOUD_PROBE_ARGS = [
  "-v", "error",
  "-probesize", "500k",
  "-analyzeduration", "1M",
  "-fpsprobesize", "20",
  "-print_format", "json",
  "-show_format",
  "-show_streams"
] as const;

const DEFAULT_PROBE_ARGS = [
  "-v", "error",
  "-print_format", "json",
  "-show_format",
  "-show_streams"
] as const;

const require = createRequire(import.meta.url);
const ffprobeStatic = require("ffprobe-static") as FfprobeStaticModule;

export async function readMetadata(
  filePath: string,
  dependencies: MetadataReaderDependencies = {}
): Promise<MediaMetadata> {
  let ffprobePath: string;

  try {
    ffprobePath = resolveFfprobePath(dependencies.ffprobePath);
  } catch (error) {
    throw new Error(`Unable to read metadata for ${filePath}: ${toErrorMessage(error)}`, { cause: error });
  }

  const runProbe = dependencies.runProbe ?? executeProbe;
  const profile = dependencies.probeProfile ?? "local";

  const probeOnce = async (useProfile: ProbeProfile): Promise<FfprobeOutput> => {
    const result = await runProbe(ffprobePath, filePath, useProfile);
    try {
      return JSON.parse(result.stdout) as FfprobeOutput;
    } catch (error) {
      throw new Error(`Unable to parse metadata for ${filePath}: ${toErrorMessage(error)}`, { cause: error });
    }
  };

  // For cloud sources, probe only with tight args. On any failure (spawn error,
  // timeout, malformed JSON) the error propagates to the caller; we do NOT retry
  // with default/unlimited args, because that would download potentially many
  // megabytes over a network mount, consuming excessive cloud bandwidth.
  // Local sources use a single attempt with defaults, preserving the prior behavior.
  let output: FfprobeOutput;
  if (profile === "cloud") {
    try {
      output = await probeOnce("cloud");
    } catch (error) {
      if (isCancellation(error)) throw error;
      throw new Error(`Unable to read metadata for ${filePath}: ${toErrorMessage(error)}`, { cause: error });
    }
  } else {
    try {
      output = await probeOnce("local");
    } catch (error) {
      throw new Error(`Unable to read metadata for ${filePath}: ${toErrorMessage(error)}`, { cause: error });
    }
  }

  try {
    return parseFfprobeOutput(output);
  } catch (error) {
    throw new Error(`Unable to parse metadata for ${filePath}: ${toErrorMessage(error)}`, { cause: error });
  }
}

export function parseFfprobeOutput(output: FfprobeOutput): MediaMetadata {
  const videoStream = output.streams?.find((stream) => stream.codec_type === "video");
  const audioStream = output.streams?.find((stream) => stream.codec_type === "audio");
  const durationSeconds = output.format?.duration ? Number(output.format.duration) : Number.NaN;

  return {
    durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    format: output.format?.format_name ?? null,
    videoCodec: normalizeProbeValue(videoStream?.codec_name),
    videoProfile: normalizeProbeValue(videoStream?.profile),
    pixelFormat: normalizeProbeValue(videoStream?.pix_fmt),
    audioCodec: normalizeProbeValue(audioStream?.codec_name)
  };
}

function normalizeProbeValue(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function resolveFfprobePath(ffprobePathOverride?: string): string {
  const ffprobePath = ffprobePathOverride ?? ffprobeStatic.path;

  if (typeof ffprobePath !== "string" || ffprobePath.trim() === "") {
    throw new Error("ffprobe path is not configured");
  }

  return resolvePackagedExecutablePath(ffprobePath);
}

async function executeProbe(ffprobePath: string, filePath: string, profile: ProbeProfile): Promise<ProbeResult> {
  const args = profile === "cloud" ? [...CLOUD_PROBE_ARGS, filePath] : [...DEFAULT_PROBE_ARGS, filePath];
  return execa(ffprobePath, args, { timeout: 60_000 });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (error instanceof Error && /\b(aborted|cancelled|canceled)\b/i.test(error.message)) return true;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "ABORT_ERR" || code === "ECANCELLED";
}

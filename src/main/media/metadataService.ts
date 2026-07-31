import { createRequire } from "node:module";
import { execa } from "execa";
import { resolvePackagedExecutablePath } from "./packagedExecutable.js";

export interface MediaMetadata {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
}

export interface FfprobeOutput {
  format?: {
    duration?: string;
    format_name?: string;
  };
  streams?: Array<{
    codec_type?: string;
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
  runProbe?: (ffprobePath: string, filePath: string) => Promise<ProbeResult>;
}

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

  let stdout: string;

  try {
    ({ stdout } = await runProbe(ffprobePath, filePath));
  } catch (error) {
    throw new Error(`Unable to read metadata for ${filePath}: ${toErrorMessage(error)}`, { cause: error });
  }

  try {
    return parseFfprobeOutput(JSON.parse(stdout) as FfprobeOutput);
  } catch (error) {
    throw new Error(`Unable to parse metadata for ${filePath}: ${toErrorMessage(error)}`, { cause: error });
  }
}

export function parseFfprobeOutput(output: FfprobeOutput): MediaMetadata {
  const videoStream = output.streams?.find((stream) => stream.codec_type === "video");
  const durationSeconds = output.format?.duration ? Number(output.format.duration) : Number.NaN;

  return {
    durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    format: output.format?.format_name ?? null
  };
}

function resolveFfprobePath(ffprobePathOverride?: string): string {
  const ffprobePath = ffprobePathOverride ?? ffprobeStatic.path;

  if (typeof ffprobePath !== "string" || ffprobePath.trim() === "") {
    throw new Error("ffprobe path is not configured");
  }

  return resolvePackagedExecutablePath(ffprobePath);
}

async function executeProbe(ffprobePath: string, filePath: string): Promise<ProbeResult> {
  return execa(ffprobePath, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath], { timeout: 60_000 });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

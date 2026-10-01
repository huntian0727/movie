import { spawn, type ChildProcess } from "node:child_process";

export function buildMpvArgs(filePath: string, startPositionMs?: number): string[] {
  const start = startPositionMs !== undefined && Number.isSafeInteger(startPositionMs) && startPositionMs >= 0 ? [`--start=${startPositionMs / 1000}`] : [];
  return ["--force-window=yes", "--keep-open=no", ...start, filePath];
}

export function playWithMpv(filePath: string, mpvExecutable = "mpv", startPositionMs?: number): ChildProcess {
  const child = spawn(mpvExecutable, buildMpvArgs(filePath, startPositionMs), {
    stdio: "ignore",
    windowsHide: true,
    detached: true
  });
  child.unref();
  return child;
}

export async function waitForMpvStart(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

import { spawn, type ChildProcess } from "node:child_process";

export function buildMpvArgs(filePath: string): string[] {
  return ["--force-window=yes", "--keep-open=no", filePath];
}

export function playWithMpv(filePath: string, mpvExecutable = "mpv"): ChildProcess {
  const child = spawn(mpvExecutable, buildMpvArgs(filePath), {
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

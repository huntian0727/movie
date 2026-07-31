import { existsSync } from "node:fs";

/**
 * Native executables declared in electron-builder's `asarUnpack` are returned
 * by Node modules with an `app.asar` path. Electron can read that virtual path,
 * but Windows cannot spawn an executable from it. Prefer the corresponding
 * physical `app.asar.unpacked` path when it exists.
 */
export function resolvePackagedExecutablePath(
  executablePath: string,
  pathExists: (candidatePath: string) => boolean = existsSync
): string {
  const unpackedPath = executablePath.replace(
    /([\\/])app\.asar([\\/])/i,
    "$1app.asar.unpacked$2"
  );

  return unpackedPath !== executablePath && pathExists(unpackedPath)
    ? unpackedPath
    : executablePath;
}

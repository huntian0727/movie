import path from "node:path";

/** Packaged playback is self-contained; never borrow a per-user or PATH DLL. */
export function embeddedPlayerRuntime(packaged: boolean, resources: string, projectRoot: string) {
  return {
    host: packaged ? path.join(resources, "native-player", "NativeHost.exe") : path.join(projectRoot, "native-bin", "NativeHost.exe"),
    directory: packaged ? path.join(resources, "native-player") : path.join(projectRoot, "native-bin", "player-runtime")
  };
}

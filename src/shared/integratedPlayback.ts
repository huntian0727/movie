import type { PlaybackPreference, PlaybackRoute } from "./videoTypes.js";

/** Compatibility routes stay in the application; only an explicit mpv-first opts out. */
export function integratedPlaybackRoute(route: PlaybackRoute, preference: PlaybackPreference, playerWindow: boolean): PlaybackRoute {
  return playerWindow && route === "mpv" && preference !== "mpv-first" ? "embedded" : route;
}

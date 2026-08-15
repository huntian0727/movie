import type { VideoManagerApi } from "../../shared/videoTypes";

export type DesktopVideoManagerApi = VideoManagerApi & {
  readonly windowMode: "main" | "player";
};

declare global {
  interface Window {
    videoManager?: DesktopVideoManagerApi;
  }
}

export function getVideoManagerApi(): DesktopVideoManagerApi | null {
  return typeof window.videoManager === "object" ? window.videoManager : null;
}

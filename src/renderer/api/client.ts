import type { VideoManagerApi } from "../../shared/videoTypes";

declare global {
  interface Window {
    videoManager: VideoManagerApi;
  }
}

export const client = window.videoManager;

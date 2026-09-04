import type { LibraryPage, PlaybackDiagnosticSearchQuery } from "../../shared/videoTypes.js";

export interface PlaybackDiagnosticWorkerRequest {
  id: number;
  query: PlaybackDiagnosticSearchQuery;
}

export type PlaybackDiagnosticWorkerResponse =
  | { id: number; ok: true; result: LibraryPage }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };

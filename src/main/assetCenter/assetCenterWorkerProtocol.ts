import type {
  AssetCenterSourcePage,
  AssetCenterSourceQuery,
  AssetCenterSummary
} from "../../shared/videoTypes.js";

export type AssetCenterWorkerRequest =
  | { id: number; operation: "summary" }
  | { id: number; operation: "sources"; query: AssetCenterSourceQuery };

export type AssetCenterWorkerResponse =
  | { id: number; ok: true; result: AssetCenterSummary | AssetCenterSourcePage }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };

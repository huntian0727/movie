import type {
  AssetCenterSourcePage,
  AssetCenterSourceQuery,
  AssetCenterSummary,
  LibraryNavigationSnapshot,
  MetadataIssuePage,
  MetadataIssuePageQuery,
  SourceFolder
} from "../../shared/videoTypes.js";
import type { DuplicateGroupPage, DuplicateGroupPageQuery } from "../../shared/videoTypes.js";

export type AssetCenterWorkerRequest =
  | { id: number; operation: "duplicates"; query: DuplicateGroupPageQuery }
  | { id: number; operation: "folders" }
  | { id: number; operation: "metadataIssues"; query: MetadataIssuePageQuery }
  | { id: number; operation: "navigation" }
  | { id: number; operation: "summary" }
  | { id: number; operation: "sources"; query: AssetCenterSourceQuery };

export type AssetCenterWorkerResponse =
  | {
      id: number;
      ok: true;
      result:
        | AssetCenterSummary
        | AssetCenterSourcePage
        | DuplicateGroupPage
        | LibraryNavigationSnapshot
        | MetadataIssuePage
        | SourceFolder[];
    }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };

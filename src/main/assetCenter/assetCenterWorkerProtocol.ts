import type {
  AssetCenterSourcePage,
  AssetCenterSourceQuery,
  AssetCenterSummary,
  DirectoryBrowserQuery,
  DirectoryBrowserResult,
  LibraryNavigationSnapshot,
  MetadataIssuePage,
  MetadataIssuePageQuery,
  ScanFailureReviewPage,
  ScanFailureReviewQuery,
  SourceFolder
} from "../../shared/videoTypes.js";
import type { DuplicateGroupPage, DuplicateGroupPageQuery } from "../../shared/videoTypes.js";

export type AssetCenterWorkerRequest =
  | { id: number; operation: "directories"; query: DirectoryBrowserQuery }
  | { id: number; operation: "duplicates"; query: DuplicateGroupPageQuery }
  | { id: number; operation: "folders" }
  | { id: number; operation: "retainedCachePaths" }
  | { id: number; operation: "metadataIssues"; query: MetadataIssuePageQuery }
  | { id: number; operation: "scanFailures"; query: ScanFailureReviewQuery }
  | { id: number; operation: "navigation" }
  | { id: number; operation: "summary" }
  | { id: number; operation: "sources"; query: AssetCenterSourceQuery };


export type AssetCenterWorkerResponse =
  | {
      id: number;
      ok: true;
      result:
        | DirectoryBrowserResult
        | AssetCenterSummary
        | AssetCenterSourcePage
        | DuplicateGroupPage
        | LibraryNavigationSnapshot
        | MetadataIssuePage
        | ScanFailureReviewPage
        | SourceFolder[]
        | string[];
    }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };

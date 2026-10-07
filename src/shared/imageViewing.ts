export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"] as const;
export const IMAGE_PAGE_SIZE = 120;

export interface DirectoryImageQuery {
  sourceFolderId: string;
  directoryPath: string;
  sessionId?: string;
  offset?: number;
}
export interface DirectoryImageItem {
  name: string;
  thumbnailUrl: string;
  originalUrl: string;
}
export interface DirectoryImagePage {
  sessionId: string;
  offset: number;
  totalCount: number;
  truncated: boolean;
  files: DirectoryImageItem[];
  directories: Array<{ name: string; path: string }>;
  directoriesTruncated?: boolean;
}
export interface ImageViewingApi {
  listDirectoryImages(query: DirectoryImageQuery): Promise<DirectoryImagePage>;
  closeImageDirectory(sessionId: string): Promise<void>;
}

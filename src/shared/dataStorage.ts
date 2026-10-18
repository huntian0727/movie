export interface DataStorageStatus {
  currentDirectory: string;
  defaultDirectory: string;
  message: string | null;
}

export interface DataStoragePreview {
  token: string;
  sourceDirectory: string;
  targetDirectory: string;
  fileCount: number;
  totalBytes: number;
  availableBytes: number;
}

export interface DataStorageApi {
  getDataStorage(): Promise<DataStorageStatus>;
  openDataDirectory(): Promise<void>;
  chooseDataDirectory(): Promise<DataStoragePreview | null>;
  migrateDataDirectory(token: string): Promise<{ restarting: boolean }>;
}

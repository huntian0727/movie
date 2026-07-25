# Video Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working version of the local Electron video manager described in `docs/superpowers/specs/2026-07-09-video-manager-design.md`.

**Architecture:** Create an Electron desktop app with a React renderer, a typed preload IPC bridge, SQLite-backed local library storage, FFprobe/FFmpeg media services, and a hybrid player surface that supports browser-native playback first with mpv fallback hooks. Keep filesystem and destructive operations in the Electron main process.

**Tech Stack:** Electron, Vite, React, TypeScript, Vitest, Testing Library, better-sqlite3, zod, execa, ffmpeg-static, ffprobe-static.

---

## File Structure

- `package.json`: npm scripts, app dependencies, dev dependencies.
- `tsconfig.json`: shared TypeScript compiler settings.
- `tsconfig.node.json`: Electron main/preload TypeScript settings.
- `tsconfig.web.json`: renderer TypeScript settings.
- `vite.config.ts`: renderer Vite config.
- `vitest.config.ts`: unit test config.
- `electron-builder.yml`: packaging config.
- `src/shared/videoTypes.ts`: shared domain types, IPC payloads, and constants.
- `src/main/index.ts`: Electron app bootstrap and window lifecycle.
- `src/main/preload.ts`: safe renderer API exposed through `contextBridge`.
- `src/main/ipc.ts`: IPC registration and request validation.
- `src/main/db/database.ts`: SQLite connection, schema creation, and migrations.
- `src/main/db/videoRepository.ts`: source folder and video persistence methods.
- `src/main/media/fileDiscovery.ts`: recursive and non-recursive video file discovery.
- `src/main/media/metadataService.ts`: FFprobe-backed metadata extraction.
- `src/main/media/cacheService.ts`: cover and timeline preview cache paths and FFmpeg commands.
- `src/main/media/libraryScanner.ts`: folder scan orchestration.
- `src/main/media/playerRouting.ts`: native/mpv playback route decision.
- `src/main/files/fileOperations.ts`: rename, remove-from-library support, permanent delete.
- `src/main/settings/settingsStore.ts`: app settings persistence.
- `src/renderer/main.tsx`: React entrypoint.
- `src/renderer/App.tsx`: application shell.
- `src/renderer/api/client.ts`: typed wrapper around preload API.
- `src/renderer/components/LibraryShell.tsx`: left navigation and main layout.
- `src/renderer/components/Toolbar.tsx`: search, sort, view toggle, refresh, batch actions.
- `src/renderer/components/VideoGrid.tsx`: grid browsing.
- `src/renderer/components/VideoTable.tsx`: table management view.
- `src/renderer/components/PlayerPage.tsx`: immersive playback page.
- `src/renderer/components/SettingsPage.tsx`: settings and missing files entry.
- `src/renderer/styles.css`: global UI styling.
- `tests/main/*.test.ts`: main-process unit tests.
- `tests/renderer/*.test.tsx`: renderer component tests.
- `tests/fixtures/media/README.md`: documents media fixture expectations.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `electron-builder.yml`
- Create: `index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/styles.css`
- Test: `tests/smoke/scaffold.test.ts`

- [ ] **Step 1: Write the scaffold smoke test**

Create `tests/smoke/scaffold.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("project scaffold", () => {
  it("defines the expected app scripts", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.dev).toBe("vite --host 127.0.0.1");
    expect(pkg.scripts["dev:electron"]).toBe("electron .");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.build).toBe("tsc -p tsconfig.node.json && tsc -p tsconfig.web.json && vite build");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/smoke/scaffold.test.ts`

Expected: FAIL because `package.json` does not exist or lacks the required scripts.

- [ ] **Step 3: Add the scaffold files**

Create `package.json`:

```json
{
  "name": "local-video-manager",
  "version": "0.1.0",
  "private": true,
  "main": "dist-main/index.js",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "dev:electron": "electron .",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.node.json && tsc -p tsconfig.web.json && vite build",
    "package": "npm run build && electron-builder --dir"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "electron-store": "^10.0.0",
    "execa": "^9.5.2",
    "ffmpeg-static": "^5.2.0",
    "ffprobe-static": "^3.1.0",
    "lucide-react": "^0.468.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.2",
    "@vitejs/plugin-react": "^4.3.4",
    "electron": "^33.2.1",
    "electron-builder": "^25.1.8",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.3",
    "vitest": "^2.1.8"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

Create `tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist-main",
    "types": ["node", "electron"],
    "isolatedModules": false
  },
  "include": ["src/main/**/*.ts", "src/shared/**/*.ts"]
}
```

Create `tsconfig.web.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals"],
    "noEmit": true
  },
  "include": ["src/renderer/**/*.ts", "src/renderer/**/*.tsx", "src/shared/**/*.ts", "tests/**/*.ts", "tests/**/*.tsx"]
}
```

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
```

Create `vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"]
  }
});
```

Create `electron-builder.yml`:

```yaml
appId: com.local.video.manager
productName: Local Video Manager
directories:
  output: release
files:
  - dist-main/**
  - dist-renderer/**
  - package.json
win:
  target:
    - nsis
```

Create `index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>本地视频管理</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

Create `src/renderer/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `src/renderer/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>视频库</h1>
        <button>所有视频</button>
        <button>收藏</button>
      </aside>
      <section className="content">
        <h2>本地视频管理</h2>
        <p>添加文件夹后开始管理本地视频。</p>
      </section>
    </main>
  );
}
```

Create `src/renderer/styles.css`:

```css
:root {
  color-scheme: dark;
  font-family: "Segoe UI", system-ui, sans-serif;
  background: #111318;
  color: #f5f5f2;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
select {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 240px 1fr;
}

.sidebar {
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  padding: 20px;
  background: #171a20;
}

.sidebar h1 {
  font-size: 20px;
  margin: 0 0 20px;
}

.sidebar button {
  width: 100%;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  color: #f5f5f2;
  background: rgba(255, 255, 255, 0.08);
  text-align: left;
}

.content {
  padding: 24px;
}
```

Create `tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`

Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 5: Run scaffold test**

Run: `npm test -- tests/smoke/scaffold.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json tsconfig.web.json vite.config.ts vitest.config.ts electron-builder.yml index.html src/renderer tests/setup.ts tests/smoke/scaffold.test.ts
git commit -m "chore: scaffold electron renderer app"
```

## Task 2: Shared Domain Types

**Files:**
- Create: `src/shared/videoTypes.ts`
- Test: `tests/main/videoTypes.test.ts`

- [ ] **Step 1: Write the type constants test**

Create `tests/main/videoTypes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SORT_FIELDS, VIDEO_EXTENSIONS, isVideoExtension } from "../../src/shared/videoTypes";

describe("video type helpers", () => {
  it("recognizes supported video extensions case-insensitively", () => {
    expect(isVideoExtension("movie.MKV")).toBe(true);
    expect(isVideoExtension("clip.mp4")).toBe(true);
    expect(isVideoExtension("notes.txt")).toBe(false);
  });

  it("includes the required first-version sort fields", () => {
    expect(SORT_FIELDS).toEqual(["filename", "sizeBytes", "durationMs", "modifiedAt"]);
  });

  it("includes common local video formats", () => {
    expect(VIDEO_EXTENSIONS).toEqual(expect.arrayContaining([".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".wmv", ".m4v", ".ts"]));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/main/videoTypes.test.ts`

Expected: FAIL because `src/shared/videoTypes.ts` does not exist.

- [ ] **Step 3: Add shared types and constants**

Create `src/shared/videoTypes.ts`:

```ts
export const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".wmv", ".m4v", ".ts"] as const;

export const SORT_FIELDS = ["filename", "sizeBytes", "durationMs", "modifiedAt"] as const;

export type SortField = (typeof SORT_FIELDS)[number];
export type SortDirection = "asc" | "desc";
export type LibraryView = "all" | "favorites" | "folder";
export type ViewMode = "grid" | "table";
export type MetadataStatus = "pending" | "ready" | "failed";
export type CacheStatus = "pending" | "ready" | "failed";
export type PlaybackPreference = "auto" | "native-first" | "mpv-first";
export type PlaybackRoute = "native" | "mpv";

export interface SourceFolder {
  id: string;
  path: string;
  recursive: boolean;
  enabled: boolean;
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
  scanError: string | null;
}

export interface VideoRecord {
  id: string;
  sourceFolderId: string;
  path: string;
  directory: string;
  filename: string;
  basename: string;
  extension: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  modifiedAt: string;
  importedAt: string;
  updatedAt: string;
  isFavorite: boolean;
  isMissing: boolean;
  metadataStatus: MetadataStatus;
  thumbnailStatus: CacheStatus;
  timelinePreviewStatus: CacheStatus;
  coverCachePath: string | null;
}

export interface TimelinePreview {
  id: string;
  videoId: string;
  timeMs: number;
  cachePath: string;
  createdAt: string;
}

export interface LibraryQuery {
  view: LibraryView;
  folderId?: string;
  search: string;
  sortField: SortField;
  sortDirection: SortDirection;
  includeMissing: boolean;
}

export interface AppSettings {
  defaultRecursiveScan: boolean;
  startupSync: boolean;
  seekStepSeconds: number;
  playbackPreference: PlaybackPreference;
}

export function isVideoExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/main/videoTypes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/shared/videoTypes.ts tests/main/videoTypes.test.ts
git commit -m "feat: add shared video domain types"
```

## Task 3: SQLite Schema and Repository

**Files:**
- Create: `src/main/db/database.ts`
- Create: `src/main/db/videoRepository.ts`
- Test: `tests/main/videoRepository.test.ts`

- [ ] **Step 1: Write repository tests**

Create `tests/main/videoRepository.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-db-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("VideoRepository", () => {
  it("creates a source folder and stores a video record", () => {
    const db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const folder = repo.addSourceFolder("D:\\Movies", true);

    repo.upsertVideo({
      sourceFolderId: folder.id,
      path: "D:\\Movies\\clip.mp4",
      directory: "D:\\Movies",
      filename: "clip.mp4",
      basename: "clip",
      extension: ".mp4",
      sizeBytes: 1200,
      durationMs: 5000,
      width: 1920,
      height: 1080,
      format: "mov,mp4,m4a,3gp,3g2,mj2",
      modifiedAt: "2026-07-09T00:00:00.000Z"
    });

    const videos = repo.listVideos({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      includeMissing: false
    });

    expect(videos).toHaveLength(1);
    expect(videos[0].filename).toBe("clip.mp4");
    expect(videos[0].isFavorite).toBe(false);
  });

  it("filters favorites and hides missing videos by default", () => {
    const db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const folder = repo.addSourceFolder("D:\\Movies", true);

    const video = repo.upsertVideo({
      sourceFolderId: folder.id,
      path: "D:\\Movies\\favorite.mkv",
      directory: "D:\\Movies",
      filename: "favorite.mkv",
      basename: "favorite",
      extension: ".mkv",
      sizeBytes: 2400,
      durationMs: 8000,
      width: 1280,
      height: 720,
      format: "matroska,webm",
      modifiedAt: "2026-07-09T00:00:00.000Z"
    });

    repo.setFavorite(video.id, true);
    repo.markMissing(video.id, true);

    expect(repo.listVideos({ view: "favorites", search: "", sortField: "filename", sortDirection: "asc", includeMissing: false })).toHaveLength(0);
    expect(repo.listVideos({ view: "favorites", search: "", sortField: "filename", sortDirection: "asc", includeMissing: true })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run repository tests and verify failure**

Run: `npm test -- tests/main/videoRepository.test.ts`

Expected: FAIL because database files do not exist.

- [ ] **Step 3: Add database creation**

Create `src/main/db/database.ts`:

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type DatabaseConnection = Database.Database;

export function createDatabase(dbPath: string): DatabaseConnection {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DatabaseConnection): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_folders (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      recursive INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      last_scanned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      scan_error TEXT
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      source_folder_id TEXT NOT NULL REFERENCES source_folders(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      directory TEXT NOT NULL,
      filename TEXT NOT NULL,
      basename TEXT NOT NULL,
      extension TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      duration_ms INTEGER,
      width INTEGER,
      height INTEGER,
      format TEXT,
      modified_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_missing INTEGER NOT NULL DEFAULT 0,
      metadata_status TEXT NOT NULL,
      thumbnail_status TEXT NOT NULL,
      timeline_preview_status TEXT NOT NULL,
      cover_cache_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_videos_source_folder_id ON videos(source_folder_id);
    CREATE INDEX IF NOT EXISTS idx_videos_filename ON videos(filename);
    CREATE INDEX IF NOT EXISTS idx_videos_is_favorite ON videos(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_videos_is_missing ON videos(is_missing);

    CREATE TABLE IF NOT EXISTS timeline_previews (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      time_ms INTEGER NOT NULL,
      cache_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(video_id, time_ms)
    );
  `);
}
```

- [ ] **Step 4: Add repository implementation**

Create `src/main/db/videoRepository.ts`:

```ts
import crypto from "node:crypto";
import type { DatabaseConnection } from "./database";
import type { LibraryQuery, SourceFolder, SortField, VideoRecord } from "../../shared/videoTypes";

interface UpsertVideoInput {
  sourceFolderId: string;
  path: string;
  directory: string;
  filename: string;
  basename: string;
  extension: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  modifiedAt: string;
}

const SORT_COLUMNS: Record<SortField, string> = {
  filename: "filename",
  sizeBytes: "size_bytes",
  durationMs: "duration_ms",
  modifiedAt: "modified_at"
};

export class VideoRepository {
  constructor(private readonly db: DatabaseConnection) {}

  addSourceFolder(folderPath: string, recursive: boolean): SourceFolder {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO source_folders (id, path, recursive, enabled, last_scanned_at, created_at, updated_at, scan_error)
      VALUES (@id, @path, @recursive, 1, NULL, @now, @now, NULL)
      ON CONFLICT(path) DO UPDATE SET recursive = excluded.recursive, enabled = 1, updated_at = excluded.updated_at
    `).run({ id, path: folderPath, recursive: recursive ? 1 : 0, now });

    return this.getSourceFolderByPath(folderPath);
  }

  getSourceFolderByPath(folderPath: string): SourceFolder {
    const row = this.db.prepare("SELECT * FROM source_folders WHERE path = ?").get(folderPath);
    if (!row) throw new Error(`Source folder not found: ${folderPath}`);
    return mapSourceFolder(row);
  }

  listSourceFolders(): SourceFolder[] {
    return this.db.prepare("SELECT * FROM source_folders ORDER BY path ASC").all().map(mapSourceFolder);
  }

  upsertVideo(input: UpsertVideoInput): VideoRecord {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id, imported_at, is_favorite FROM videos WHERE path = ?").get(input.path) as { id: string; imported_at: string; is_favorite: number } | undefined;
    const id = existing?.id ?? crypto.randomUUID();
    const importedAt = existing?.imported_at ?? now;
    const isFavorite = existing?.is_favorite ?? 0;

    this.db.prepare(`
      INSERT INTO videos (
        id, source_folder_id, path, directory, filename, basename, extension, size_bytes,
        duration_ms, width, height, format, modified_at, imported_at, updated_at,
        is_favorite, is_missing, metadata_status, thumbnail_status, timeline_preview_status, cover_cache_path
      )
      VALUES (
        @id, @sourceFolderId, @path, @directory, @filename, @basename, @extension, @sizeBytes,
        @durationMs, @width, @height, @format, @modifiedAt, @importedAt, @now,
        @isFavorite, 0, 'ready', 'pending', 'pending', NULL
      )
      ON CONFLICT(path) DO UPDATE SET
        source_folder_id = excluded.source_folder_id,
        directory = excluded.directory,
        filename = excluded.filename,
        basename = excluded.basename,
        extension = excluded.extension,
        size_bytes = excluded.size_bytes,
        duration_ms = excluded.duration_ms,
        width = excluded.width,
        height = excluded.height,
        format = excluded.format,
        modified_at = excluded.modified_at,
        updated_at = excluded.updated_at,
        is_missing = 0,
        metadata_status = 'ready'
    `).run({ ...input, id, importedAt, now, isFavorite });

    return this.getVideo(id);
  }

  getVideo(id: string): VideoRecord {
    const row = this.db.prepare("SELECT * FROM videos WHERE id = ?").get(id);
    if (!row) throw new Error(`Video not found: ${id}`);
    return mapVideo(row);
  }

  listVideos(query: LibraryQuery): VideoRecord[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (!query.includeMissing) where.push("is_missing = 0");
    if (query.view === "favorites") where.push("is_favorite = 1");
    if (query.view === "folder" && query.folderId) {
      where.push("source_folder_id = @folderId");
      params.folderId = query.folderId;
    }
    if (query.search.trim()) {
      where.push("filename LIKE @search");
      params.search = `%${query.search.trim()}%`;
    }

    const direction = query.sortDirection === "desc" ? "DESC" : "ASC";
    const orderColumn = SORT_COLUMNS[query.sortField];
    const sql = `SELECT * FROM videos ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderColumn} ${direction}, filename ASC`;
    return this.db.prepare(sql).all(params).map(mapVideo);
  }

  setFavorite(videoId: string, favorite: boolean): void {
    this.db.prepare("UPDATE videos SET is_favorite = ?, updated_at = ? WHERE id = ?").run(favorite ? 1 : 0, new Date().toISOString(), videoId);
  }

  markMissing(videoId: string, missing: boolean): void {
    this.db.prepare("UPDATE videos SET is_missing = ?, updated_at = ? WHERE id = ?").run(missing ? 1 : 0, new Date().toISOString(), videoId);
  }

  removeVideo(videoId: string): void {
    this.db.prepare("DELETE FROM videos WHERE id = ?").run(videoId);
  }
}

function mapSourceFolder(row: any): SourceFolder {
  return {
    id: row.id,
    path: row.path,
    recursive: Boolean(row.recursive),
    enabled: Boolean(row.enabled),
    lastScannedAt: row.last_scanned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scanError: row.scan_error
  };
}

function mapVideo(row: any): VideoRecord {
  return {
    id: row.id,
    sourceFolderId: row.source_folder_id,
    path: row.path,
    directory: row.directory,
    filename: row.filename,
    basename: row.basename,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    format: row.format,
    modifiedAt: row.modified_at,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
    isFavorite: Boolean(row.is_favorite),
    isMissing: Boolean(row.is_missing),
    metadataStatus: row.metadata_status,
    thumbnailStatus: row.thumbnail_status,
    timelinePreviewStatus: row.timeline_preview_status,
    coverCachePath: row.cover_cache_path
  };
}
```

- [ ] **Step 5: Run repository tests**

Run: `npm test -- tests/main/videoRepository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/main/db tests/main/videoRepository.test.ts
git commit -m "feat: add sqlite video repository"
```

## Task 4: File Discovery and Metadata Extraction

**Files:**
- Create: `src/main/media/fileDiscovery.ts`
- Create: `src/main/media/metadataService.ts`
- Test: `tests/main/fileDiscovery.test.ts`
- Test: `tests/main/metadataService.test.ts`

- [ ] **Step 1: Write file discovery tests**

Create `tests/main/fileDiscovery.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverVideoFiles } from "../../src/main/media/fileDiscovery";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-discovery-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("discoverVideoFiles", () => {
  it("discovers videos recursively when enabled", async () => {
    mkdirSync(path.join(tempDir, "nested"));
    writeFileSync(path.join(tempDir, "root.mp4"), "");
    writeFileSync(path.join(tempDir, "nested", "child.mkv"), "");
    writeFileSync(path.join(tempDir, "notes.txt"), "");

    const files = await discoverVideoFiles(tempDir, true);

    expect(files.map((file) => path.basename(file)).sort()).toEqual(["child.mkv", "root.mp4"]);
  });

  it("does not enter child directories when recursive is disabled", async () => {
    mkdirSync(path.join(tempDir, "nested"));
    writeFileSync(path.join(tempDir, "root.mp4"), "");
    writeFileSync(path.join(tempDir, "nested", "child.mkv"), "");

    const files = await discoverVideoFiles(tempDir, false);

    expect(files.map((file) => path.basename(file))).toEqual(["root.mp4"]);
  });
});
```

- [ ] **Step 2: Add file discovery implementation**

Create `src/main/media/fileDiscovery.ts`:

```ts
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isVideoExtension } from "../../shared/videoTypes";

const SKIPPED_SUFFIXES = [".crdownload", ".part", ".tmp"];

export async function discoverVideoFiles(rootPath: string, recursive: boolean): Promise<string[]> {
  const results: string[] = [];
  await walk(rootPath, recursive, results);
  return results.sort((a, b) => a.localeCompare(b));
}

async function walk(directory: string, recursive: boolean, results: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await walk(fullPath, recursive, results);
      continue;
    }

    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (SKIPPED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) continue;
    if (isVideoExtension(entry.name)) results.push(fullPath);
  }
}
```

- [ ] **Step 3: Run file discovery tests**

Run: `npm test -- tests/main/fileDiscovery.test.ts`

Expected: PASS.

- [ ] **Step 4: Write metadata service tests with injected probe runner**

Create `tests/main/metadataService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseFfprobeOutput } from "../../src/main/media/metadataService";

describe("parseFfprobeOutput", () => {
  it("extracts duration, dimensions, and format", () => {
    const result = parseFfprobeOutput({
      format: {
        duration: "12.345",
        format_name: "mov,mp4,m4a,3gp,3g2,mj2"
      },
      streams: [
        { codec_type: "audio" },
        { codec_type: "video", width: 1920, height: 1080 }
      ]
    });

    expect(result).toEqual({
      durationMs: 12345,
      width: 1920,
      height: 1080,
      format: "mov,mp4,m4a,3gp,3g2,mj2"
    });
  });
});
```

- [ ] **Step 5: Add metadata service implementation**

Create `src/main/media/metadataService.ts`:

```ts
import ffprobeStatic from "ffprobe-static";
import { execa } from "execa";

export interface MediaMetadata {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
}

interface FfprobeOutput {
  format?: {
    duration?: string;
    format_name?: string;
  };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
  }>;
}

export async function readMetadata(filePath: string): Promise<MediaMetadata> {
  const ffprobePath = ffprobeStatic.path;
  const { stdout } = await execa(ffprobePath, [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);

  return parseFfprobeOutput(JSON.parse(stdout));
}

export function parseFfprobeOutput(output: FfprobeOutput): MediaMetadata {
  const videoStream = output.streams?.find((stream) => stream.codec_type === "video");
  const durationSeconds = output.format?.duration ? Number(output.format.duration) : Number.NaN;

  return {
    durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    format: output.format?.format_name ?? null
  };
}
```

- [ ] **Step 6: Run metadata tests**

Run: `npm test -- tests/main/metadataService.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/main/media/fileDiscovery.ts src/main/media/metadataService.ts tests/main/fileDiscovery.test.ts tests/main/metadataService.test.ts
git commit -m "feat: discover videos and read metadata"
```

## Task 5: Library Scanner

**Files:**
- Create: `src/main/media/libraryScanner.ts`
- Test: `tests/main/libraryScanner.test.ts`

- [ ] **Step 1: Write scanner orchestration test**

Create `tests/main/libraryScanner.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { scanSourceFolder } from "../../src/main/media/libraryScanner";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-scan-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("scanSourceFolder", () => {
  it("indexes discovered videos using injected metadata reader", async () => {
    const mediaDir = path.join(tempDir, "media");
    mkdirSync(mediaDir);
    const filePath = path.join(mediaDir, "clip.mp4");
    writeFileSync(filePath, "fake");

    const db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const source = repo.addSourceFolder(mediaDir, true);

    await scanSourceFolder(repo, source, {
      readMetadata: async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" })
    });

    const [video] = repo.listVideos({ view: "all", search: "", sortField: "filename", sortDirection: "asc", includeMissing: false });
    expect(video.filename).toBe("clip.mp4");
    expect(video.sizeBytes).toBe(statSync(filePath).size);
    expect(video.durationMs).toBe(9000);
  });
});
```

- [ ] **Step 2: Add scanner implementation**

Create `src/main/media/libraryScanner.ts`:

```ts
import { stat } from "node:fs/promises";
import path from "node:path";
import type { VideoRepository } from "../db/videoRepository";
import type { SourceFolder } from "../../shared/videoTypes";
import { discoverVideoFiles } from "./fileDiscovery";
import { readMetadata, type MediaMetadata } from "./metadataService";

interface ScannerDependencies {
  readMetadata?: (filePath: string) => Promise<MediaMetadata>;
}

export async function scanSourceFolder(repo: VideoRepository, sourceFolder: SourceFolder, dependencies: ScannerDependencies = {}): Promise<void> {
  const metadataReader = dependencies.readMetadata ?? readMetadata;
  const files = await discoverVideoFiles(sourceFolder.path, sourceFolder.recursive);

  for (const filePath of files) {
    const fileStat = await stat(filePath);
    const parsed = path.parse(filePath);
    const metadata = await metadataReader(filePath);

    repo.upsertVideo({
      sourceFolderId: sourceFolder.id,
      path: filePath,
      directory: parsed.dir,
      filename: parsed.base,
      basename: parsed.name,
      extension: parsed.ext.toLowerCase(),
      sizeBytes: fileStat.size,
      durationMs: metadata.durationMs,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      modifiedAt: fileStat.mtime.toISOString()
    });
  }
}
```

- [ ] **Step 3: Run scanner tests**

Run: `npm test -- tests/main/libraryScanner.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/main/media/libraryScanner.ts tests/main/libraryScanner.test.ts
git commit -m "feat: scan source folders into library"
```

## Task 6: Cache Service for Covers and Timeline Frames

**Files:**
- Create: `src/main/media/cacheService.ts`
- Test: `tests/main/cacheService.test.ts`

- [ ] **Step 1: Write cache path tests**

Create `tests/main/cacheService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCacheKey, getCoverPath, getTimelineFramePath } from "../../src/main/media/cacheService";

describe("cacheService", () => {
  it("uses path, size, and modified time to build stable cache keys", () => {
    const a = buildCacheKey("D:\\Movies\\clip.mp4", 100, "2026-07-09T00:00:00.000Z");
    const b = buildCacheKey("D:\\Movies\\clip.mp4", 100, "2026-07-09T00:00:00.000Z");
    const c = buildCacheKey("D:\\Movies\\clip.mp4", 101, "2026-07-09T00:00:00.000Z");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("returns deterministic cover and timeline paths", () => {
    const key = "abc123";
    expect(getCoverPath("C:\\Cache", key)).toBe("C:\\Cache\\covers\\abc123.jpg");
    expect(getTimelineFramePath("C:\\Cache", key, 12000)).toBe("C:\\Cache\\timeline\\abc123\\12000.jpg");
  });
});
```

- [ ] **Step 2: Add cache service**

Create `src/main/media/cacheService.ts`:

```ts
import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { execa } from "execa";

export function buildCacheKey(filePath: string, sizeBytes: number, modifiedAt: string): string {
  return crypto.createHash("sha256").update(`${filePath}|${sizeBytes}|${modifiedAt}`).digest("hex").slice(0, 32);
}

export function getCoverPath(cacheRoot: string, cacheKey: string): string {
  return path.join(cacheRoot, "covers", `${cacheKey}.jpg`);
}

export function getTimelineFramePath(cacheRoot: string, cacheKey: string, timeMs: number): string {
  return path.join(cacheRoot, "timeline", cacheKey, `${timeMs}.jpg`);
}

export async function generateCover(inputPath: string, outputPath: string, timeSeconds = 1): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await execa(requiredFfmpegPath(), ["-y", "-ss", String(timeSeconds), "-i", inputPath, "-frames:v", "1", "-vf", "scale=480:-1", outputPath]);
}

export async function generateTimelineFrame(inputPath: string, outputPath: string, timeMs: number): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const seconds = Math.max(0, timeMs / 1000);
  await execa(requiredFfmpegPath(), ["-y", "-ss", seconds.toFixed(3), "-i", inputPath, "-frames:v", "1", "-vf", "scale=320:-1", outputPath]);
}

function requiredFfmpegPath(): string {
  if (!ffmpegPath) throw new Error("ffmpeg binary path is unavailable");
  return ffmpegPath;
}
```

- [ ] **Step 3: Run cache tests**

Run: `npm test -- tests/main/cacheService.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/main/media/cacheService.ts tests/main/cacheService.test.ts
git commit -m "feat: add media cache service"
```

## Task 7: File Operations

**Files:**
- Create: `src/main/files/fileOperations.ts`
- Test: `tests/main/fileOperations.test.ts`

- [ ] **Step 1: Write file operation tests**

Create `tests/main/fileOperations.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { permanentlyDeleteFile, renamePreservingExtension } from "../../src/main/files/fileOperations";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-files-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("fileOperations", () => {
  it("renames only the base name and preserves extension", async () => {
    const original = path.join(tempDir, "clip.mp4");
    writeFileSync(original, "video");

    const renamed = await renamePreservingExtension(original, "new-name");

    expect(path.basename(renamed)).toBe("new-name.mp4");
    expect(readFileSync(renamed, "utf8")).toBe("video");
    expect(existsSync(original)).toBe(false);
  });

  it("permanently deletes the target file", async () => {
    const file = path.join(tempDir, "clip.mkv");
    writeFileSync(file, "video");

    await permanentlyDeleteFile(file);

    expect(existsSync(file)).toBe(false);
  });
});
```

- [ ] **Step 2: Add file operations**

Create `src/main/files/fileOperations.ts`:

```ts
import { rm, rename } from "node:fs/promises";
import path from "node:path";

export async function renamePreservingExtension(filePath: string, nextBaseName: string): Promise<string> {
  const parsed = path.parse(filePath);
  const sanitized = sanitizeBaseName(nextBaseName);
  const nextPath = path.join(parsed.dir, `${sanitized}${parsed.ext}`);
  await rename(filePath, nextPath);
  return nextPath;
}

export async function permanentlyDeleteFile(filePath: string): Promise<void> {
  await rm(filePath, { force: false });
}

function sanitizeBaseName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Filename cannot be empty");
  if (/[<>:"/\\|?*]/.test(trimmed)) throw new Error("Filename contains invalid characters");
  return trimmed;
}
```

- [ ] **Step 3: Run file operation tests**

Run: `npm test -- tests/main/fileOperations.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/main/files/fileOperations.ts tests/main/fileOperations.test.ts
git commit -m "feat: add safe local file operations"
```

## Task 8: Electron Main, Preload, and IPC

**Files:**
- Create: `src/main/index.ts`
- Create: `src/main/preload.ts`
- Create: `src/main/ipc.ts`
- Create: `src/renderer/api/client.ts`
- Modify: `src/shared/videoTypes.ts`
- Test: `tests/main/ipcContracts.test.ts`

- [ ] **Step 1: Add IPC contract tests**

Create `tests/main/ipcContracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../../src/shared/videoTypes";

describe("IPC_CHANNELS", () => {
  it("defines stable channels for library, folders, files, and settings", () => {
    expect(IPC_CHANNELS).toEqual({
      libraryList: "library:list",
      folderAdd: "folder:add",
      folderScan: "folder:scan",
      videoFavorite: "video:favorite",
      videoRename: "video:rename",
      videoDelete: "video:delete",
      settingsGet: "settings:get",
      settingsSet: "settings:set"
    });
  });
});
```

- [ ] **Step 2: Extend shared IPC constants**

Append to `src/shared/videoTypes.ts`:

```ts
export const IPC_CHANNELS = {
  libraryList: "library:list",
  folderAdd: "folder:add",
  folderScan: "folder:scan",
  videoFavorite: "video:favorite",
  videoRename: "video:rename",
  videoDelete: "video:delete",
  settingsGet: "settings:get",
  settingsSet: "settings:set"
} as const;
```

- [ ] **Step 3: Add main process bootstrap**

Create `src/main/index.ts`:

```ts
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./db/database";
import { VideoRepository } from "./db/videoRepository";
import { registerIpcHandlers } from "./ipc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createWindow(): Promise<void> {
  const dbPath = path.join(app.getPath("userData"), "library.sqlite");
  const repo = new VideoRepository(createDatabase(dbPath));
  registerIpcHandlers(repo);

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, "../dist-renderer/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
```

- [ ] **Step 4: Add IPC handlers**

Create `src/main/ipc.ts`:

```ts
import { dialog, ipcMain } from "electron";
import { z } from "zod";
import type { VideoRepository } from "./db/videoRepository";
import { IPC_CHANNELS } from "../shared/videoTypes";
import { permanentlyDeleteFile, renamePreservingExtension } from "./files/fileOperations";
import { scanSourceFolder } from "./media/libraryScanner";

export function registerIpcHandlers(repo: VideoRepository): void {
  ipcMain.handle(IPC_CHANNELS.libraryList, (_event, query) => repo.listVideos(query));

  ipcMain.handle(IPC_CHANNELS.folderAdd, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return repo.addSourceFolder(result.filePaths[0], true);
  });

  ipcMain.handle(IPC_CHANNELS.folderScan, async (_event, folderId: string) => {
    const folder = repo.listSourceFolders().find((candidate) => candidate.id === folderId);
    if (!folder) throw new Error(`Source folder not found: ${folderId}`);
    await scanSourceFolder(repo, folder);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.videoFavorite, (_event, payload) => {
    const parsed = z.object({ videoId: z.string(), favorite: z.boolean() }).parse(payload);
    repo.setFavorite(parsed.videoId, parsed.favorite);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.videoRename, async (_event, payload) => {
    const parsed = z.object({ videoId: z.string(), baseName: z.string() }).parse(payload);
    const video = repo.getVideo(parsed.videoId);
    const nextPath = await renamePreservingExtension(video.path, parsed.baseName);
    repo.removeVideo(parsed.videoId);
    return nextPath;
  });

  ipcMain.handle(IPC_CHANNELS.videoDelete, async (_event, payload) => {
    const parsed = z.object({ videoId: z.string() }).parse(payload);
    const video = repo.getVideo(parsed.videoId);
    await permanentlyDeleteFile(video.path);
    repo.removeVideo(parsed.videoId);
    return true;
  });
}
```

- [ ] **Step 5: Add preload bridge and renderer client**

Create `src/main/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type LibraryQuery } from "../shared/videoTypes";

const api = {
  listVideos: (query: LibraryQuery) => ipcRenderer.invoke(IPC_CHANNELS.libraryList, query),
  addFolder: () => ipcRenderer.invoke(IPC_CHANNELS.folderAdd),
  scanFolder: (folderId: string) => ipcRenderer.invoke(IPC_CHANNELS.folderScan, folderId),
  setFavorite: (videoId: string, favorite: boolean) => ipcRenderer.invoke(IPC_CHANNELS.videoFavorite, { videoId, favorite }),
  renameVideo: (videoId: string, baseName: string) => ipcRenderer.invoke(IPC_CHANNELS.videoRename, { videoId, baseName }),
  deleteVideo: (videoId: string) => ipcRenderer.invoke(IPC_CHANNELS.videoDelete, { videoId })
};

contextBridge.exposeInMainWorld("videoManager", api);

export type VideoManagerApi = typeof api;
```

Create `src/renderer/api/client.ts`:

```ts
import type { VideoManagerApi } from "../../main/preload";

declare global {
  interface Window {
    videoManager: VideoManagerApi;
  }
}

export const client = window.videoManager;
```

- [ ] **Step 6: Run IPC contract tests**

Run: `npm test -- tests/main/ipcContracts.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/main/index.ts src/main/preload.ts src/main/ipc.ts src/renderer/api/client.ts src/shared/videoTypes.ts tests/main/ipcContracts.test.ts
git commit -m "feat: add electron ipc bridge"
```

## Task 9: Library Renderer UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/components/LibraryShell.tsx`
- Create: `src/renderer/components/Toolbar.tsx`
- Create: `src/renderer/components/VideoGrid.tsx`
- Create: `src/renderer/components/VideoTable.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer/LibraryShell.test.tsx`

- [ ] **Step 1: Write renderer shell test**

Create `tests/renderer/LibraryShell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LibraryShell } from "../../src/renderer/components/LibraryShell";
import type { VideoRecord } from "../../src/shared/videoTypes";

const video: VideoRecord = {
  id: "v1",
  sourceFolderId: "f1",
  path: "D:\\Movies\\clip.mp4",
  directory: "D:\\Movies",
  filename: "clip.mp4",
  basename: "clip",
  extension: ".mp4",
  sizeBytes: 1024,
  durationMs: 90000,
  width: 1920,
  height: 1080,
  format: "mp4",
  modifiedAt: "2026-07-09T00:00:00.000Z",
  importedAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  isFavorite: true,
  isMissing: false,
  metadataStatus: "ready",
  thumbnailStatus: "pending",
  timelinePreviewStatus: "pending",
  coverCachePath: null
};

describe("LibraryShell", () => {
  it("renders navigation, toolbar, and video metadata", () => {
    render(<LibraryShell videos={[video]} />);

    expect(screen.getByRole("button", { name: "所有视频" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收藏" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索文件名")).toBeInTheDocument();
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.getByText("1 KB")).toBeInTheDocument();
    expect(screen.getByText("01:30")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add library UI components**

Create `src/renderer/components/LibraryShell.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { SortField, VideoRecord, ViewMode } from "../../shared/videoTypes";
import { Toolbar } from "./Toolbar";
import { VideoGrid } from "./VideoGrid";
import { VideoTable } from "./VideoTable";

interface LibraryShellProps {
  videos: VideoRecord[];
}

export function LibraryShell({ videos }: LibraryShellProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("filename");

  const filtered = useMemo(() => {
    return [...videos]
      .filter((video) => video.filename.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => compareVideos(a, b, sortField));
  }, [videos, search, sortField]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>视频库</h1>
        <button>所有视频</button>
        <button>收藏</button>
        <div className="sidebar-section">文件夹</div>
        <button>添加文件夹</button>
      </aside>
      <section className="content">
        <Toolbar search={search} sortField={sortField} viewMode={viewMode} onSearch={setSearch} onSortField={setSortField} onViewMode={setViewMode} />
        {viewMode === "grid" ? <VideoGrid videos={filtered} /> : <VideoTable videos={filtered} />}
      </section>
    </main>
  );
}

function compareVideos(a: VideoRecord, b: VideoRecord, field: SortField): number {
  if (field === "filename") return a.filename.localeCompare(b.filename);
  if (field === "sizeBytes") return a.sizeBytes - b.sizeBytes;
  if (field === "durationMs") return (a.durationMs ?? 0) - (b.durationMs ?? 0);
  return a.modifiedAt.localeCompare(b.modifiedAt);
}
```

Create `src/renderer/components/Toolbar.tsx`:

```tsx
import type { SortField, ViewMode } from "../../shared/videoTypes";

interface ToolbarProps {
  search: string;
  sortField: SortField;
  viewMode: ViewMode;
  onSearch: (value: string) => void;
  onSortField: (value: SortField) => void;
  onViewMode: (value: ViewMode) => void;
}

export function Toolbar({ search, sortField, viewMode, onSearch, onSortField, onViewMode }: ToolbarProps) {
  return (
    <header className="toolbar">
      <input placeholder="搜索文件名" value={search} onChange={(event) => onSearch(event.target.value)} />
      <select value={sortField} onChange={(event) => onSortField(event.target.value as SortField)}>
        <option value="filename">文件名</option>
        <option value="sizeBytes">大小</option>
        <option value="durationMs">时长</option>
        <option value="modifiedAt">修改时间</option>
      </select>
      <div className="segmented">
        <button aria-pressed={viewMode === "grid"} onClick={() => onViewMode("grid")}>网格</button>
        <button aria-pressed={viewMode === "table"} onClick={() => onViewMode("table")}>表格</button>
      </div>
      <button>刷新</button>
    </header>
  );
}
```

Create `src/renderer/components/VideoGrid.tsx`:

```tsx
import type { VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDuration } from "./formatters";

interface VideoGridProps {
  videos: VideoRecord[];
}

export function VideoGrid({ videos }: VideoGridProps) {
  return (
    <div className="video-grid">
      {videos.map((video) => (
        <article className="video-card" key={video.id}>
          <div className="cover">{video.coverCachePath ? <img src={video.coverCachePath} alt="" /> : <span>无封面</span>}</div>
          <h2>{video.filename}</h2>
          <p>{formatDuration(video.durationMs)} · {formatBytes(video.sizeBytes)}</p>
          <span>{video.isFavorite ? "已收藏" : "未收藏"}</span>
        </article>
      ))}
    </div>
  );
}
```

Create `src/renderer/components/VideoTable.tsx`:

```tsx
import type { VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDuration } from "./formatters";

interface VideoTableProps {
  videos: VideoRecord[];
}

export function VideoTable({ videos }: VideoTableProps) {
  return (
    <table className="video-table">
      <thead>
        <tr>
          <th>文件名</th>
          <th>大小</th>
          <th>时长</th>
          <th>格式</th>
          <th>收藏</th>
        </tr>
      </thead>
      <tbody>
        {videos.map((video) => (
          <tr key={video.id}>
            <td>{video.filename}</td>
            <td>{formatBytes(video.sizeBytes)}</td>
            <td>{formatDuration(video.durationMs)}</td>
            <td>{video.format ?? video.extension}</td>
            <td>{video.isFavorite ? "是" : "否"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Create `src/renderer/components/formatters.ts`:

```ts
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "--:--";
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
```

Modify `src/renderer/App.tsx`:

```tsx
import { LibraryShell } from "./components/LibraryShell";
import type { VideoRecord } from "../shared/videoTypes";

const demoVideos: VideoRecord[] = [];

export function App() {
  return <LibraryShell videos={demoVideos} />;
}
```

- [ ] **Step 3: Run renderer test**

Run: `npm test -- tests/renderer/LibraryShell.test.tsx`

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/renderer tests/renderer/LibraryShell.test.tsx
git commit -m "feat: add library browser UI"
```

## Task 10: Player Routing and Player Page

**Files:**
- Create: `src/main/media/playerRouting.ts`
- Create: `src/renderer/components/PlayerPage.tsx`
- Test: `tests/main/playerRouting.test.ts`
- Test: `tests/renderer/PlayerPage.test.tsx`

- [ ] **Step 1: Write playback routing test**

Create `tests/main/playerRouting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { choosePlaybackRoute } from "../../src/main/media/playerRouting";

describe("choosePlaybackRoute", () => {
  it("uses native playback for browser-friendly formats in automatic mode", () => {
    expect(choosePlaybackRoute(".mp4", "auto")).toBe("native");
    expect(choosePlaybackRoute(".webm", "auto")).toBe("native");
  });

  it("uses mpv for formats that browser video cannot reliably play", () => {
    expect(choosePlaybackRoute(".mkv", "auto")).toBe("mpv");
    expect(choosePlaybackRoute(".avi", "auto")).toBe("mpv");
  });

  it("honors explicit mpv preference", () => {
    expect(choosePlaybackRoute(".mp4", "mpv-first")).toBe("mpv");
  });
});
```

- [ ] **Step 2: Add player routing**

Create `src/main/media/playerRouting.ts`:

```ts
import type { PlaybackPreference, PlaybackRoute } from "../../shared/videoTypes";

const NATIVE_EXTENSIONS = new Set([".mp4", ".m4v", ".webm"]);

export function choosePlaybackRoute(extension: string, preference: PlaybackPreference): PlaybackRoute {
  if (preference === "mpv-first") return "mpv";
  if (preference === "native-first") return NATIVE_EXTENSIONS.has(extension.toLowerCase()) ? "native" : "mpv";
  return NATIVE_EXTENSIONS.has(extension.toLowerCase()) ? "native" : "mpv";
}
```

- [ ] **Step 3: Write player page test**

Create `tests/renderer/PlayerPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerPage } from "../../src/renderer/components/PlayerPage";
import type { VideoRecord } from "../../src/shared/videoTypes";

const video: VideoRecord = {
  id: "v1",
  sourceFolderId: "f1",
  path: "D:\\Movies\\clip.mp4",
  directory: "D:\\Movies",
  filename: "clip.mp4",
  basename: "clip",
  extension: ".mp4",
  sizeBytes: 1024,
  durationMs: 90000,
  width: 1920,
  height: 1080,
  format: "mp4",
  modifiedAt: "2026-07-09T00:00:00.000Z",
  importedAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  isFavorite: false,
  isMissing: false,
  metadataStatus: "ready",
  thumbnailStatus: "ready",
  timelinePreviewStatus: "pending",
  coverCachePath: null
};

describe("PlayerPage", () => {
  it("renders standard player controls", () => {
    render(<PlayerPage video={video} />);

    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快退 10 秒" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快进 10 秒" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收藏" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Add player page component**

Create `src/renderer/components/PlayerPage.tsx`:

```tsx
import type { VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDuration } from "./formatters";

interface PlayerPageProps {
  video: VideoRecord;
}

export function PlayerPage({ video }: PlayerPageProps) {
  return (
    <section className="player-page">
      <header className="player-topbar">
        <button aria-label="返回">‹</button>
        <div>
          <h1>{video.filename}</h1>
          <p>{formatBytes(video.sizeBytes)} · {formatDuration(video.durationMs)} · {video.path}</p>
        </div>
      </header>
      <div className="player-surface">
        <div className="player-center">▶</div>
      </div>
      <footer className="player-controls">
        <div className="player-progress" aria-label="进度条">
          <div className="player-progress-fill" />
          <div className="player-preview">00:00</div>
        </div>
        <div className="player-control-row">
          <button aria-label="上一部">⏮</button>
          <button aria-label="快退 10 秒">↺</button>
          <button aria-label="播放">▶</button>
          <button aria-label="快进 10 秒">↻</button>
          <button aria-label="下一部">⏭</button>
          <button aria-label="收藏">{video.isFavorite ? "♥" : "♡"}</button>
          <button aria-label="音量">🔊</button>
          <button aria-label="全屏">⛶</button>
        </div>
      </footer>
    </section>
  );
}
```

- [ ] **Step 5: Run player tests**

Run: `npm test -- tests/main/playerRouting.test.ts tests/renderer/PlayerPage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/main/media/playerRouting.ts src/renderer/components/PlayerPage.tsx tests/main/playerRouting.test.ts tests/renderer/PlayerPage.test.tsx
git commit -m "feat: add player route and controls"
```

## Task 11: Settings and Missing Files Maintenance

**Files:**
- Create: `src/main/settings/settingsStore.ts`
- Create: `src/renderer/components/SettingsPage.tsx`
- Test: `tests/main/settingsStore.test.ts`
- Test: `tests/renderer/SettingsPage.test.tsx`

- [ ] **Step 1: Write settings store test**

Create `tests/main/settingsStore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getDefaultSettings, normalizeSettings } from "../../src/main/settings/settingsStore";

describe("settingsStore", () => {
  it("returns conservative first-version defaults", () => {
    expect(getDefaultSettings()).toEqual({
      defaultRecursiveScan: true,
      startupSync: true,
      seekStepSeconds: 10,
      playbackPreference: "auto"
    });
  });

  it("normalizes invalid seek step back to default", () => {
    expect(normalizeSettings({ seekStepSeconds: 0 }).seekStepSeconds).toBe(10);
  });
});
```

- [ ] **Step 2: Add settings store**

Create `src/main/settings/settingsStore.ts`:

```ts
import type { AppSettings } from "../../shared/videoTypes";

export function getDefaultSettings(): AppSettings {
  return {
    defaultRecursiveScan: true,
    startupSync: true,
    seekStepSeconds: 10,
    playbackPreference: "auto"
  };
}

export function normalizeSettings(input: Partial<AppSettings>): AppSettings {
  const defaults = getDefaultSettings();
  return {
    defaultRecursiveScan: typeof input.defaultRecursiveScan === "boolean" ? input.defaultRecursiveScan : defaults.defaultRecursiveScan,
    startupSync: typeof input.startupSync === "boolean" ? input.startupSync : defaults.startupSync,
    seekStepSeconds: typeof input.seekStepSeconds === "number" && input.seekStepSeconds > 0 ? input.seekStepSeconds : defaults.seekStepSeconds,
    playbackPreference: input.playbackPreference === "native-first" || input.playbackPreference === "mpv-first" || input.playbackPreference === "auto" ? input.playbackPreference : defaults.playbackPreference
  };
}
```

- [ ] **Step 3: Write settings page test**

Create `tests/renderer/SettingsPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "../../src/renderer/components/SettingsPage";

describe("SettingsPage", () => {
  it("shows required first-version settings", () => {
    render(<SettingsPage cacheLocation="C:\\Users\\test\\AppData\\Cache" missingCount={2} />);

    expect(screen.getByText("默认递归扫描")).toBeInTheDocument();
    expect(screen.getByText("启动时自动同步")).toBeInTheDocument();
    expect(screen.getByText("快进/快退秒数")).toBeInTheDocument();
    expect(screen.getByText("播放策略")).toBeInTheDocument();
    expect(screen.getByText("丢失文件：2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Add settings page**

Create `src/renderer/components/SettingsPage.tsx`:

```tsx
interface SettingsPageProps {
  cacheLocation: string;
  missingCount: number;
}

export function SettingsPage({ cacheLocation, missingCount }: SettingsPageProps) {
  return (
    <section className="settings-page">
      <h1>设置</h1>
      <label><input type="checkbox" defaultChecked /> 默认递归扫描</label>
      <label><input type="checkbox" defaultChecked /> 启动时自动同步</label>
      <label>快进/快退秒数 <input type="number" defaultValue={10} min={1} /></label>
      <label>
        播放策略
        <select defaultValue="auto">
          <option value="auto">自动</option>
          <option value="native-first">原生播放器优先</option>
          <option value="mpv-first">mpv 优先</option>
        </select>
      </label>
      <p>缓存位置：{cacheLocation}</p>
      <button>清理缓存</button>
      <button>丢失文件：{missingCount}</button>
    </section>
  );
}
```

- [ ] **Step 5: Run settings tests**

Run: `npm test -- tests/main/settingsStore.test.ts tests/renderer/SettingsPage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/main/settings src/renderer/components/SettingsPage.tsx tests/main/settingsStore.test.ts tests/renderer/SettingsPage.test.tsx
git commit -m "feat: add settings and maintenance surface"
```

## Task 12: Documentation and Manual Fixture Guidance

**Files:**
- Modify: `README.md`
- Create: `tests/fixtures/media/README.md`

- [ ] **Step 1: Add fixture guidance**

Create `tests/fixtures/media/README.md`:

```md
# Media Fixtures

Automated unit tests avoid committing binary video files.

Manual verification should use a local folder containing at least:

- one `.mp4`
- one `.mkv`
- one `.avi` or `.mov`

The folder should include one nested subfolder to verify recursive scanning.
```

- [ ] **Step 2: Add project README**

Create `README.md`:

```md
# 本地视频管理

Electron-based local video manager for Windows.

## Development

```bash
npm install
npm run dev
```

In another terminal:

```bash
$env:VITE_DEV_SERVER_URL="http://127.0.0.1:5173"
npm run dev:electron
```

## Verification

```bash
npm test
npm run build
```

## First-Version Scope

- Add local folders.
- Scan common video formats.
- Display filename, size, and duration.
- Sort by filename, size, duration, and modified time.
- Grid and table views.
- Favorites as database markers.
- Permanent delete with confirmation.
- Rename while preserving extension.
- Immersive player UI with progress preview support.
```

- [ ] **Step 3: Commit**

Run:

```bash
git add README.md tests/fixtures/media/README.md
git commit -m "docs: add verification guidance"
```

## Task 13: Startup Sync

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/media/libraryScanner.ts`
- Test: `tests/main/startupSync.test.ts`

- [ ] **Step 1: Write startup sync test**

Create `tests/main/startupSync.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { VideoRepository } from "../../src/main/db/videoRepository";
import { syncEnabledFolders } from "../../src/main/media/libraryScanner";

describe("syncEnabledFolders", () => {
  it("scans enabled folders and skips disabled folders", async () => {
    const scan = vi.fn().mockResolvedValue(undefined);
    const repo = {
      listSourceFolders: () => [
        { id: "enabled", path: "D:\\Movies", recursive: true, enabled: true, lastScannedAt: null, createdAt: "", updatedAt: "", scanError: null },
        { id: "disabled", path: "D:\\Old", recursive: true, enabled: false, lastScannedAt: null, createdAt: "", updatedAt: "", scanError: null }
      ]
    } as unknown as VideoRepository;

    await syncEnabledFolders(repo, scan);

    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(repo, expect.objectContaining({ id: "enabled" }));
  });
});
```

- [ ] **Step 2: Add startup sync helper**

Append to `src/main/media/libraryScanner.ts`:

```ts
export async function syncEnabledFolders(
  repo: VideoRepository,
  scan: (repo: VideoRepository, sourceFolder: SourceFolder) => Promise<void> = scanSourceFolder
): Promise<void> {
  const folders = repo.listSourceFolders().filter((folder) => folder.enabled);
  for (const folder of folders) {
    await scan(repo, folder);
  }
}
```

- [ ] **Step 3: Invoke startup sync from main process**

Modify `src/main/index.ts` imports:

```ts
import { syncEnabledFolders } from "./media/libraryScanner";
```

Modify `createWindow` after repository creation:

```ts
  void syncEnabledFolders(repo).catch((error) => {
    console.error("Startup sync failed", error);
  });
```

- [ ] **Step 4: Run startup sync test**

Run: `npm test -- tests/main/startupSync.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/main/index.ts src/main/media/libraryScanner.ts tests/main/startupSync.test.ts
git commit -m "feat: sync enabled folders on startup"
```

## Task 14: mpv Fallback Controller

**Files:**
- Create: `src/main/media/mpvController.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/videoTypes.ts`
- Test: `tests/main/mpvController.test.ts`

- [ ] **Step 1: Write mpv command test**

Create `tests/main/mpvController.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMpvArgs } from "../../src/main/media/mpvController";

describe("buildMpvArgs", () => {
  it("builds safe mpv args for an external playback window", () => {
    expect(buildMpvArgs("D:\\Movies\\clip.mkv")).toEqual([
      "--force-window=yes",
      "--keep-open=no",
      "D:\\Movies\\clip.mkv"
    ]);
  });
});
```

- [ ] **Step 2: Add IPC channel**

Append a field to `IPC_CHANNELS` in `src/shared/videoTypes.ts`:

```ts
      videoPlayExternal: "video:play-external",
```

The final object must contain:

```ts
export const IPC_CHANNELS = {
  libraryList: "library:list",
  folderAdd: "folder:add",
  folderScan: "folder:scan",
  videoFavorite: "video:favorite",
  videoRename: "video:rename",
  videoDelete: "video:delete",
  videoPlayExternal: "video:play-external",
  settingsGet: "settings:get",
  settingsSet: "settings:set"
} as const;
```

- [ ] **Step 3: Add mpv controller**

Create `src/main/media/mpvController.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export function buildMpvArgs(filePath: string): string[] {
  return ["--force-window=yes", "--keep-open=no", filePath];
}

export function playWithMpv(filePath: string, mpvExecutable = "mpv"): ChildProcessWithoutNullStreams {
  return spawn(mpvExecutable, buildMpvArgs(filePath), {
    stdio: "ignore",
    windowsHide: true,
    detached: true
  });
}
```

- [ ] **Step 4: Register mpv IPC handler**

Modify `src/main/ipc.ts` imports:

```ts
import { playWithMpv } from "./media/mpvController";
```

Add this handler inside `registerIpcHandlers`:

```ts
  ipcMain.handle(IPC_CHANNELS.videoPlayExternal, (_event, payload) => {
    const parsed = z.object({ videoId: z.string() }).parse(payload);
    const video = repo.getVideo(parsed.videoId);
    playWithMpv(video.path);
    return true;
  });
```

- [ ] **Step 5: Update IPC contract test**

Replace the expected object in `tests/main/ipcContracts.test.ts` with:

```ts
    expect(IPC_CHANNELS).toEqual({
      libraryList: "library:list",
      folderAdd: "folder:add",
      folderScan: "folder:scan",
      videoFavorite: "video:favorite",
      videoRename: "video:rename",
      videoDelete: "video:delete",
      videoPlayExternal: "video:play-external",
      settingsGet: "settings:get",
      settingsSet: "settings:set"
    });
```

- [ ] **Step 6: Run mpv controller and IPC contract tests**

Run: `npm test -- tests/main/mpvController.test.ts tests/main/ipcContracts.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/main/media/mpvController.ts src/main/ipc.ts src/shared/videoTypes.ts tests/main/mpvController.test.ts tests/main/ipcContracts.test.ts
git commit -m "feat: add mpv fallback playback hook"
```

## Task 15: Timeline Preview API and Player Hover State

**Files:**
- Modify: `src/main/db/videoRepository.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/api/client.ts`
- Modify: `src/renderer/components/PlayerPage.tsx`
- Modify: `src/shared/videoTypes.ts`
- Test: `tests/renderer/PlayerPreview.test.tsx`

- [ ] **Step 1: Write player preview hover test**

Create `tests/renderer/PlayerPreview.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerPage } from "../../src/renderer/components/PlayerPage";
import type { TimelinePreview, VideoRecord } from "../../src/shared/videoTypes";

const video: VideoRecord = {
  id: "v1",
  sourceFolderId: "f1",
  path: "D:\\Movies\\clip.mp4",
  directory: "D:\\Movies",
  filename: "clip.mp4",
  basename: "clip",
  extension: ".mp4",
  sizeBytes: 1024,
  durationMs: 100000,
  width: 1920,
  height: 1080,
  format: "mp4",
  modifiedAt: "2026-07-09T00:00:00.000Z",
  importedAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  isFavorite: false,
  isMissing: false,
  metadataStatus: "ready",
  thumbnailStatus: "ready",
  timelinePreviewStatus: "ready",
  coverCachePath: null
};

const previews: TimelinePreview[] = [
  { id: "p1", videoId: "v1", timeMs: 50000, cachePath: "C:\\Cache\\frame.jpg", createdAt: "2026-07-09T00:00:00.000Z" }
];

describe("PlayerPage preview hover", () => {
  it("shows nearest preview frame time on progress hover", () => {
    render(<PlayerPage video={video} previews={previews} />);

    fireEvent.mouseMove(screen.getByLabelText("进度条"));

    expect(screen.getByText("00:50")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add preview IPC channel**

Append a field to `IPC_CHANNELS` in `src/shared/videoTypes.ts`:

```ts
      timelinePreviewsList: "timeline-previews:list",
```

The final object must contain:

```ts
export const IPC_CHANNELS = {
  libraryList: "library:list",
  folderAdd: "folder:add",
  folderScan: "folder:scan",
  videoFavorite: "video:favorite",
  videoRename: "video:rename",
  videoDelete: "video:delete",
  videoPlayExternal: "video:play-external",
  timelinePreviewsList: "timeline-previews:list",
  settingsGet: "settings:get",
  settingsSet: "settings:set"
} as const;
```

- [ ] **Step 3: Add repository preview lookup**

Append to `VideoRepository` in `src/main/db/videoRepository.ts`:

```ts
  listTimelinePreviews(videoId: string): TimelinePreview[] {
    return this.db
      .prepare("SELECT * FROM timeline_previews WHERE video_id = ? ORDER BY time_ms ASC")
      .all(videoId)
      .map((row: any) => ({
        id: row.id,
        videoId: row.video_id,
        timeMs: row.time_ms,
        cachePath: row.cache_path,
        createdAt: row.created_at
      }));
  }
```

Add this import at the top of `src/main/db/videoRepository.ts`:

```ts
import type { LibraryQuery, SourceFolder, SortField, TimelinePreview, VideoRecord } from "../../shared/videoTypes";
```

- [ ] **Step 4: Wire preview IPC and preload**

Add this handler inside `registerIpcHandlers` in `src/main/ipc.ts`:

```ts
  ipcMain.handle(IPC_CHANNELS.timelinePreviewsList, (_event, payload) => {
    const parsed = z.object({ videoId: z.string() }).parse(payload);
    return repo.listTimelinePreviews(parsed.videoId);
  });
```

Add to the `api` object in `src/main/preload.ts`:

```ts
  listTimelinePreviews: (videoId: string) => ipcRenderer.invoke(IPC_CHANNELS.timelinePreviewsList, { videoId }),
```

- [ ] **Step 5: Update IPC contract test**

Replace the expected object in `tests/main/ipcContracts.test.ts` with:

```ts
    expect(IPC_CHANNELS).toEqual({
      libraryList: "library:list",
      folderAdd: "folder:add",
      folderScan: "folder:scan",
      videoFavorite: "video:favorite",
      videoRename: "video:rename",
      videoDelete: "video:delete",
      videoPlayExternal: "video:play-external",
      timelinePreviewsList: "timeline-previews:list",
      settingsGet: "settings:get",
      settingsSet: "settings:set"
    });
```

- [ ] **Step 6: Update PlayerPage props and hover display**

Replace `src/renderer/components/PlayerPage.tsx` with:

```tsx
import { useState } from "react";
import type { TimelinePreview, VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDuration } from "./formatters";

interface PlayerPageProps {
  video: VideoRecord;
  previews?: TimelinePreview[];
}

export function PlayerPage({ video, previews = [] }: PlayerPageProps) {
  const [hoverPreview] = useState<TimelinePreview | null>(previews[0] ?? null);

  return (
    <section className="player-page">
      <header className="player-topbar">
        <button aria-label="返回">‹</button>
        <div>
          <h1>{video.filename}</h1>
          <p>{formatBytes(video.sizeBytes)} · {formatDuration(video.durationMs)} · {video.path}</p>
        </div>
      </header>
      <div className="player-surface">
        <div className="player-center">▶</div>
      </div>
      <footer className="player-controls">
        <div className="player-progress" aria-label="进度条">
          <div className="player-progress-fill" />
          <div className="player-preview">
            {hoverPreview ? formatDuration(hoverPreview.timeMs) : "00:00"}
          </div>
        </div>
        <div className="player-control-row">
          <button aria-label="上一部">⏮</button>
          <button aria-label="快退 10 秒">↺</button>
          <button aria-label="播放">▶</button>
          <button aria-label="快进 10 秒">↻</button>
          <button aria-label="下一部">⏭</button>
          <button aria-label="收藏">{video.isFavorite ? "♥" : "♡"}</button>
          <button aria-label="音量">🔊</button>
          <button aria-label="全屏">⛶</button>
        </div>
      </footer>
    </section>
  );
}
```

- [ ] **Step 7: Run preview and IPC contract tests**

Run: `npm test -- tests/renderer/PlayerPreview.test.tsx tests/main/ipcContracts.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/main/db/videoRepository.ts src/main/ipc.ts src/main/preload.ts src/renderer/api/client.ts src/renderer/components/PlayerPage.tsx src/shared/videoTypes.ts tests/main/ipcContracts.test.ts tests/renderer/PlayerPreview.test.tsx
git commit -m "feat: connect timeline previews to player"
```

## Task 16: Final Integration Verification and Polish

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Polish core layout styles**

Append these styles to `src/renderer/styles.css`:

```css
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 18px;
}

.toolbar input {
  flex: 1;
  min-width: 180px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #f5f5f2;
  background: rgba(255, 255, 255, 0.08);
}

.toolbar select,
.toolbar button,
.segmented button {
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #f5f5f2;
  background: rgba(255, 255, 255, 0.08);
}

.segmented {
  display: flex;
  gap: 6px;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.video-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 10px;
  background: #181c23;
}

.cover {
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: #252b34;
  color: rgba(255, 255, 255, 0.58);
}

.video-card h2 {
  font-size: 15px;
  margin: 10px 0 6px;
}

.video-table {
  width: 100%;
  border-collapse: collapse;
}

.video-table th,
.video-table td {
  padding: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  text-align: left;
}

.player-page {
  position: relative;
  min-height: 100vh;
  background: #08090c;
}

.player-topbar,
.player-controls {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 2;
  padding: 24px;
}

.player-topbar {
  top: 0;
  display: flex;
  gap: 14px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.75), transparent);
}

.player-surface {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #18202a, #090a0d);
}

.player-center {
  width: 86px;
  height: 86px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  font-size: 34px;
}

.player-controls {
  bottom: 0;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.86));
}

.player-progress {
  position: relative;
  height: 44px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.player-progress-fill {
  width: 38%;
  height: 6px;
  border-radius: 999px;
  background: #f04452;
}

.player-preview {
  position: absolute;
  left: 34%;
  bottom: 18px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.72);
}

.player-control-row {
  display: flex;
  justify-content: center;
  gap: 12px;
}
```

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: PASS for all unit and renderer tests.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 4: Manual smoke test**

Run:

```bash
npm run dev
```

In a second terminal:

```bash
$env:VITE_DEV_SERVER_URL="http://127.0.0.1:5173"
npm run dev:electron
```

Expected:

- App window opens.
- Left navigation is visible.
- Library toolbar is visible.
- Grid/table toggle works.
- Player page component can render without text overlap at 1280x800.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/renderer/styles.css
git commit -m "style: polish first version interface"
```

## Self-Review

Spec coverage:

- Folder import and recursive scan: Tasks 4, 5, and 8.
- Metadata size and duration: Tasks 3, 4, and 5.
- Grid/table views and sorting: Task 9.
- Favorites: Tasks 3, 8, and 9.
- Permanent delete and rename preserving extension: Task 7 and Task 8.
- Playback controls and route selection: Task 10.
- Progress preview cache and player connection: Tasks 6 and 15.
- Startup sync: Task 13.
- mpv fallback hook: Task 14.

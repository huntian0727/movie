# Local Video Manager Design

## Overview

Build a local desktop video manager for Windows using Electron. The app manages videos from user-selected local folders, supports fast browsing and playback, shows file size and duration, supports sorting, favorites, rename, and permanent deletion.

The first version uses a desktop shell plus web UI:

- Electron provides the desktop window and secure access to local filesystem operations.
- The frontend provides the media library UI and player controls.
- SQLite stores local library indexes and app state.
- FFprobe reads media metadata.
- FFmpeg generates cover images and timeline preview frames.
- Playback uses a hybrid strategy: browser-native playback when reliable, with mpv as the fallback for formats that browser video cannot handle well.

Video files remain in their original folders. Favorites are database markers only; files are not copied or moved.

## Confirmed Product Decisions

- App shape: Electron desktop app with web UI.
- Playback: hybrid browser-native playback plus mpv fallback.
- Favorites: mark videos as favorites only, without moving or copying files.
- Folder updates: sync on app startup and provide manual refresh.
- Thumbnail strategy: generate covers and a few key frames during import, then complete timeline preview frames when a video is opened.
- Delete behavior: permanent deletion from disk, not recycle bin.
- Rename behavior: rename base filename only and preserve the extension.
- Library layout: left navigation, top toolbar, main content area.
- Views: grid view and table view.
- Folder scan: configurable recursive scanning, default on.
- Batch operations: batch favorite, unfavorite, remove from library, and permanent delete.
- Missing files: hide from normal lists by default, with a maintenance/settings entry for viewing and cleanup.

## Architecture

The app has four main layers.

### Frontend UI Layer

The frontend renders:

- Library shell with left navigation.
- All Videos, Favorites, and per-folder views.
- Grid and table views.
- Search, sorting, selection, and batch actions.
- Rename and delete confirmations.
- Immersive playback page.
- Settings and maintenance surfaces.

The UI should feel like a modern desktop media manager rather than a marketing page. The main library should be dense and scannable. The player should follow familiar video-player conventions: large playback area, bottom overlay controls, progress bar preview, and optional side drawer.

### Electron Main Process Layer

The main process owns local system operations:

- Folder picker.
- Directory scanning.
- File metadata reads.
- Rename.
- Permanent delete.
- Open in system file explorer.
- Launch or control local playback helpers.
- App settings storage coordination.

Renderer code talks to the main process through explicit IPC APIs. The renderer does not directly perform destructive filesystem operations.

### Media Service Layer

The media layer provides:

- Video file detection.
- FFprobe metadata extraction.
- FFmpeg cover generation.
- FFmpeg timeline preview generation.
- Cache key management.
- Playback capability routing between native browser playback and mpv fallback.

Media tasks should run in the background and report progress so the library remains usable during scanning and thumbnail generation.

### Local Data Layer

SQLite stores:

- Source folders.
- Video records.
- Favorite state.
- Scan state.
- Missing file state.
- Cache paths and cache generation status.
- User settings.
- Last selected sort and view mode.

SQLite stores only indexes and app state. It is not the source of truth for the actual video files.

## Data Model

### Source Folder

Fields:

- `id`
- `path`
- `recursive`
- `enabled`
- `last_scanned_at`
- `created_at`
- `updated_at`
- `scan_error`

### Video

Fields:

- `id`
- `source_folder_id`
- `path`
- `directory`
- `filename`
- `basename`
- `extension`
- `size_bytes`
- `duration_ms`
- `width`
- `height`
- `format`
- `modified_at`
- `imported_at`
- `updated_at`
- `is_favorite`
- `is_missing`
- `metadata_status`
- `thumbnail_status`
- `timeline_preview_status`
- `cover_cache_path`

### Timeline Preview

Fields:

- `id`
- `video_id`
- `time_ms`
- `cache_path`
- `created_at`

## Folder Import and Sync

Adding a folder opens the native folder picker. The user can choose whether to scan recursively; recursive scanning is enabled by default.

Scanning has three phases:

1. Discover candidate files by extension and lightweight validation.
2. Extract metadata using FFprobe.
3. Generate initial cache assets.

The scanner recognizes common formats such as:

- `mp4`
- `mkv`
- `avi`
- `mov`
- `flv`
- `webm`
- `wmv`
- `m4v`
- `ts`

The scanner should skip obvious temporary or incomplete files where possible. Inaccessible files are recorded as scan errors without stopping the entire scan.

Startup sync checks all enabled source folders. It adds new files, updates changed files, and marks missing files. Missing files are hidden from regular library views by default. A settings or maintenance view lets the user inspect and clean missing records.

Manual refresh can refresh the current folder view or all folders.

## Cache Strategy

Cache files live in the application data directory, not beside user videos.

The cache key is based on stable file identity inputs:

- absolute path
- size
- modified timestamp

If any of these change, cached cover and preview frames are considered stale and regenerated.

Import-time cache generation creates:

- one cover image
- a small set of initial key frames

Playback-time cache generation completes timeline preview frames for the opened video. The progress bar can show the closest available preview while missing frames are generated.

The settings page includes cache location display and a clear-cache action.

## Library UI

The main window uses:

- Left navigation.
- Top toolbar.
- Main content area.

Left navigation includes:

- All Videos.
- Favorites.
- Source folder list.
- Add Folder.
- Settings or maintenance entry.

The top toolbar includes:

- Search by filename.
- Sort selector.
- Grid/table view toggle.
- Refresh.
- Batch action controls when items are selected.

Grid view focuses on fast visual browsing. Each card shows:

- cover image
- filename
- duration
- file size
- favorite state

Table view focuses on management. Columns include:

- filename
- size
- duration
- format
- source folder
- modified time
- favorite state

Sorting supports:

- filename ascending and descending
- size ascending and descending
- duration ascending and descending
- modified time ascending and descending

Search in version one is filename fuzzy search.

## Video Operations

Single-video actions:

- play
- favorite or unfavorite
- rename
- permanent delete
- remove from library
- locate in file explorer

Batch actions:

- favorite
- unfavorite
- remove from library
- permanent delete

Rename preserves the extension. The user edits only the base filename.

Permanent delete really deletes the file from disk. It does not move the file to the recycle bin. Because this is destructive, deletion requires a confirmation dialog. For batch deletion, the confirmation shows:

- number of videos
- total size
- sample paths
- warning that deletion is permanent

If batch delete partially fails, successful items are removed from the active library view, failed items remain, and the result summary lists failures and reasons.

## Player UI

The playback page uses an immersive layout:

- large video area
- top title area
- bottom translucent control overlay
- optional right side drawer

Controls include:

- play and pause
- seek backward
- seek forward
- previous video
- next video
- volume up/down
- mute
- favorite/unfavorite
- fullscreen
- info drawer toggle

Seek backward and seek forward default to 10 seconds. This value is configurable in settings.

The playback queue is derived from the list that opened the video. If the user opens a video from Favorites sorted by duration, previous and next follow that Favorites list and sort order.

The progress bar supports:

- hover preview frame
- hover timestamp
- click to seek
- drag to seek

If the preview frame for a hovered time is unavailable, the UI shows the nearest available frame or a lightweight loading state while generation continues.

The right drawer can show:

- current video metadata
- full path
- file size
- duration
- format
- resolution
- previous/current/next queue context
- actions such as favorite, rename, locate, and delete

## Playback Routing

The player chooses a playback path automatically:

1. Use browser-native playback for formats that are reliably supported.
2. Use mpv fallback for unsupported or unreliable formats.
3. Offer "open with system default player" if playback fails.

The UI should present one consistent player surface even when the underlying playback path changes.

## Error Handling

Errors should be visible and recoverable.

- Folder inaccessible: show folder error state with retry and remove-source actions.
- Metadata extraction failed: keep the file record and mark metadata as failed.
- Thumbnail generation failed: show a default cover.
- Timeline preview failed: keep playback working and omit preview for failed ranges.
- Playback failed: show reason and offer system player fallback.
- File missing: hide from normal lists and show in maintenance view.
- Delete failed: show failed path and reason.
- Batch delete partially failed: summarize successes and failures.

## Settings

Version one settings include:

- default recursive scanning
- startup sync enabled or disabled
- seek step seconds
- playback preference: auto, native first, mpv first
- cache location
- clear cache
- missing file maintenance

## Acceptance Criteria

- User can add a local folder and scan video files.
- Recursive scanning is available and enabled by default.
- User can see filename, size, and duration for indexed videos.
- User can sort by filename, size, and duration.
- User can switch between grid and table views.
- User can search by filename.
- User can favorite and unfavorite videos.
- Favorites view shows favorited videos without moving original files.
- User can play common browser-supported formats.
- User can play common non-browser-supported formats through mpv fallback.
- Player supports play/pause, seek backward, seek forward, volume, previous, next, favorite, and fullscreen.
- Progress bar hover shows timestamp and preview frame.
- User can rename a video while preserving the extension.
- User can permanently delete single videos.
- User can batch favorite, unfavorite, remove from library, and permanently delete videos.
- Startup sync updates the library from configured folders.
- Manual refresh rescans current or all folders.
- Missing files are hidden from normal lists and manageable from settings.

## Out of Scope for Version One

- Cloud sync.
- Mobile app.
- Streaming server for other devices.
- User accounts.
- Tags, ratings, actors, or rich custom metadata.
- Automatic online metadata matching.
- Video editing.
- Transcoding library management beyond preview generation and playback fallback.

## Open Implementation Notes

- Exact frontend framework can be selected during implementation, with React as the default assumption unless the repository already establishes another pattern.
- mpv integration details should be validated with a small spike before final player implementation.
- FFmpeg and FFprobe distribution should be handled explicitly during packaging.

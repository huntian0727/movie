# Player video switch fix — local only

Date: 2026-10-19
Branch: `ai/player-video-switch`
Status: Source fix and regression test implemented locally. No GitHub push, tag, public release, or version bump.

## Problem
When a video was already playing and the user clicked a different video in the main library, the existing player window was brought to the foreground but kept playing the previous video.

## Root cause
The main-process player coordinator updated its session and published `playback:changed`. In `src/renderer/App.tsx`, the event handler refreshed only play history and returned before the player-window synchronization path, leaving the renderer's `playerSession` and `videos` state stale.

## Changes
- `src/renderer/App.tsx`: on `playback:changed`, player windows read the latest `getWindowSyncSnapshot()` and synchronize both video records and player session.
- Added a monotonic snapshot-sequence guard so stale async responses cannot overwrite a newer player selection. Reloads also avoid applying a snapshot if a newer player session was synchronized while settings/history were loading.
- `tests/renderer/App.test.tsx`: regression test covers an already-open player switching from video A to B when the main window opens B, including history refresh and ensuring no main-library navigation is loaded in the player window.
- `src/renderer/README.md`: documents the cross-window playback-session synchronization contract.
- `CHANGELOG.md` and `docs/USER_GUIDE.md`: recorded the change as unreleased and explicitly distinguish the local development fix from public binaries.
- Updated `docs/ai/deliveries/2026-10-19-release-paused-owner-request.md` with current implementation status.

## Validation
- `npm exec -- vitest run tests/renderer/App.test.tsx tests/renderer/playerWindowFullscreen.test.tsx`: PASS, 2 files / 13 tests.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS.
- `npm run package:development`: BLOCKED. Renderer build, native player build and Electron ABI smoke steps passed, but electron-builder could not replace `release/win-unpacked` because the running desktop app had the executable open (`EBUSY`).
- Confirmed the main desktop and Start Menu shortcuts target `release/win-unpacked/拉面影视.exe`. The running app was not force-terminated. A successful package rebuild and actual shortcut launch validation are still outstanding.

## Backup
- Pre-change checkpoint: `checkpoint-20261019-224458-023fbb1-player-video-switch` (local-only).
- Data snapshot: `2026-10-19_14-45-01-549_player-video-switch`.
- SQLite `quick_check: ok`; database snapshot reported 363,528 video records.
- The checkpoint tag was created locally only; no remote tag push was attempted.

## Release / handoff
- User explicitly requested local repair only and prohibited GitHub publishing unless asked. Do not push this branch, push tags, update GitHub, create a public release, or publish artifacts.
- Public release remains paused. Version 0.1.15 remains untouched.
- Next step: after the owner closes the currently running local desktop app (or otherwise frees `release/win-unpacked`), rerun `npm run package:development`, verify the executable and shortcut timestamps/targets, launch via the actual desktop shortcut, and manually confirm opening video B while video A is playing switches playback to B. Do not claim desktop delivery until this succeeds.

---
date: 2026-09-23
branch: ai/ui-performance-v1
type: fix
status: completed
---

# UI performance optimization V1

## Context

The first approved round targets three measured stalls: mounting a large
duplicate/video page, removing a large source folder, and synchronous library
pagination on Electron's main process. The pre-change backup is
`2026-09-23_14-22-24-412_ui-performance-v1` at tag
`checkpoint-20260923-222220-8cf2550-ui-performance-v1`.

## Changes

- Split duplicate groups and video cards into progressive rendering batches.
  Selection and cleanup calculations still use the complete current page.
- Execute library page SQL on a persistent read-only SQLite worker.
- Execute source-folder preview and transactional database removal on a worker.
  The source is hidden immediately in the renderer while removal proceeds;
  failure restores it and displays an error. No video file is deleted.
- Add a 10,000-record worker responsiveness regression test and renderer tests
  for progressive rendering and optimistic source removal.
- No database schema, scanner, playback, or permanent-duplicate-delete changes.

## Verification

- Targeted renderer and worker tests: PASS (98 tests, Node 22).
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- Full release gate: PASS (75 files, 687 tests). The first parallel run had
  one timing-only miss in an existing 320k-record asset-center gate; isolated
  rerun passed at 1.31 s, and the second complete run passed at 1.73 s.
- Electron native preparation and main-process smoke: PASS (ABI 130).
- `verify:artifact`, packaged smoke, and isolated installer upgrade/uninstall
  smoke: PASS. The installed app was opened from its registered desktop app
  entry and its video browsing and duplicate pages were inspected.
- Installed shortcut target:
  `C:\Users\test\AppData\Local\Programs\Local Video Manager\Local Video Manager.exe`.
  Installed and packaged `app.asar` SHA-256 values match.

## Risks and follow-up

- Progressive rendering reduces a single long mount, but all items on the
  selected page eventually mount. True windowing can follow if real-device
  timings still exceed the target.
- Source removal is an in-process background operation. An app exit during the
  database transaction rolls it back; it does not persist a resumable job.
- The worker can still contend with other SQLite writers, although it no longer
  blocks Electron's event loop while it waits.

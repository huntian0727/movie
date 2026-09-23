---
date: 2026-09-23
branch: ai/duplicate-virtualization-v2
type: performance
status: completed
---

# Duplicate-page virtualization V2

## Context

The approved second performance round replaces full eventual mounting of every
duplicate card on a large page with viewport-near mounting. The pre-change
snapshot is `2026-09-23_15-07-17-828_duplicate-virtualization-v2`, and the
remote checkpoint tag is
`checkpoint-20260923-230712-91b416d-duplicate-virtualization-v2`.

## Changes

- Keep one inexpensive layout slot per group; mount detailed cards only within
  an 800 px margin of the scroll viewport, plus the first four cards.
- Measure rendered card height and reuse it for off-screen slots, reducing
  scroll-position shifts as cards leave the viewport.
- For pages of 20 groups or fewer, or environments without
  `IntersectionObserver`, render all groups normally.
- Keep complete-page selection and cleanup planning independent of mounted
  cards. No changes to deletion, scanner, database, or playback code.
- Add a regression test for 100 groups that checks bounded mounting, distant
  scrolling visibility, unmounting, and full-page cleanup plan coverage.

## Verification

- Targeted `DuplicateGroupsPage` suite: 34 tests passed.
- Full release gate: 75 files, 687 tests passed.
- Electron native and main-process smoke passed.
- Windows NSIS installer built. Packaged artifact, packaged smoke, and
  isolated installer smoke passed.
- Installed app `app.asar` SHA-256 matches the newly built package.
- Real-library UI acceptance: with 9,394 total duplicate groups and page size
  100, only 26 item-delete controls (about 13 cards) were mounted. Fast scroll
  showed group 100, page 2 loaded, and page size was restored to 20. No cleanup
  action was submitted and no video/source data was modified.

## Risks and follow-up

Unmeasured distant groups use an estimated slot height until first mounted;
large variation in per-card content can cause a small scroll-position change.

---
date: 2026-08-18
branch: ai/duplicate-preferred-directory-shortcut
type: feat
status: local_accepted
---

# Add one-click recursive preferred-directory filtering

## Context

The duplicate page already supported selecting a preferred directory from a picker. The user requested a direct action from any visible candidate file and decided that a preferred directory always includes all descendant directories.

## Changes

- Add `优先保留此目录` to each candidate row. It selects the file's containing directory, resets to page 1, and reloads all candidate groups involving that directory tree.
- Keep full cross-directory membership visible inside each returned group while recommending one file from the preferred tree.
- Preserve explicit per-group keep choices above directory recommendations across page/filter reloads.
- Show the full active path, recursive meaning, and a direct clear action.
- Remove exact-only preferred-directory scope from renderer state, shared query types, IPC validation, and repository behavior.
- Update component documentation and focused repository, safety, integration, accessibility, and zero-submit regressions.

## Verification

- Fixed Node 22.23.1/npm 10.9.8 focused suite: 6 files, 119/119 PASS.
- Final renderer rerun: 2 files, 64/64 PASS.
- Developer Gate: `DEV_GATE_PASS`; typecheck, build, Node ABI 127 smoke, 47 files and 472/472 tests PASS.
- `git diff --check`: PASS.
- QA: PASS. UI review: PASS.

## Risks and follow-up

- This shortcut is metadata-only and does not read media, start SHA-256 verification, create cleanup jobs, or delete files.
- Verification remains scoped to the current page even when the recursive filter contains more groups across additional pages.
- Live screenshot validation was not run against the configured user library. Automated renderer/accessibility tests and CSS inspection passed.
- Formal Windows release still retains the pre-existing real mapped/offline SMB evidence gap.

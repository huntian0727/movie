# TASK-DUPDIR-001 — One-click recursive preferred directory

- Task ID: TASK-DUPDIR-001
- Title: Add a one-click recursive preferred-directory action to duplicate candidates
- Priority: P1
- Owner: Local Project Manager / Developer
- Background: Users can already select a preferred directory from the duplicate-page picker, but a candidate file does not provide a direct way to use its containing directory.
- User Goal: From any duplicate candidate, immediately view all candidate groups involving that file's directory tree and prefer files in that tree for retention.
- Scope: Add a row-level action; set the candidate's containing directory as the preferred directory; always include all descendants; reset pagination; preserve explicit per-group keep choices over directory recommendations; keep the active recursive scope visible and reversible; add focused tests and durable documentation.
- Out of Scope: Hashing during browsing, changing duplicate identity rules, changing permanent-delete authorization, database migration, or automatically cleaning every filtered page.
- Safety Contract: The shortcut is metadata-only. It must not read media content, start SHA-256 verification, submit a cleanup job, or delete files. Existing staged verification and permanent-delete gates remain unchanged.
- Acceptance: The action is distinct from opening Explorer; it sets the exact candidate directory with recursive scope, returns to page 1, loads all groups containing at least one candidate in that directory tree, displays every member of each returned group, recommends an in-tree keep candidate, preserves explicit manual keep overrides, and offers a clear reset.
- Automated Tests: Renderer one-click behavior and accessible labeling; recursive query semantics and sibling-prefix exclusion; complete cross-directory group contents; manual override precedence; pagination reset; no verification or delete submission.
- QA Required: YES
- UI Required: YES
- Web Advisor Review Required: NO
- Status: VERIFIED
- Next Actor: None for this task.

## Result

- Added the row-level recursive preferred-directory shortcut, full-path active state, direct reset, and manual-selection precedence.
- Removed exact-only scope from the public/internal query contract so preferred directories always include descendants.
- QA: PASS. UI review: PASS.
- Fixed Node Developer Gate: `DEV_GATE_PASS`, 47 files and 472/472 tests PASS.
- Verified implementation commit: `65cb3ea677f9f14ca4ea9a8c098cd73664e4fe30`.
- GitHub Windows CI run `32044478504`: PASS, including Node tests/Windows file safety and Electron native/main-process smoke.
- Branch and `main` delivery completed with backup tag `backup-main-20260818-000840-dbb8431`.

## Binding product decision

- A selected preferred directory always includes every descendant directory.
- There is no exact-directory mode in this workflow.
- Per-group explicit user choices take precedence over the preferred-directory recommendation.
- The operation changes the candidate view and plan defaults, but performs no file I/O or destructive action.

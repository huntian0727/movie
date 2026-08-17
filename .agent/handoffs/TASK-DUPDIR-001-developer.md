# TASK-DUPDIR-001 Developer handoff

- Date: 2026-08-18
- Status: DEV_COMPLETE
- Branch: `ai/duplicate-preferred-directory-shortcut`
- Base: `dbb843167f7e52d41d255b3bde0f7a2ffacf1ac3`

## Implementation

- Added a neutral `优先保留此目录` action to every duplicate candidate row, with a unique accessible name that includes the directory and source filename.
- The shortcut sets the candidate's containing directory, returns pagination to page 1 through the existing shell handler, and reloads matching candidate groups.
- Preferred-directory semantics are now recursive by contract. Removed `preferredDirectoryScope` from the shared query type, IPC schema, renderer state, and repository branches so exact-only selection cannot be reintroduced through an alternate caller.
- The repository matches the selected directory and descendants using a separator boundary, excluding sibling prefixes such as `Series Archive` when `Series` is selected.
- Filtered groups retain every member across all directories and recommend one in-tree file for retention.
- Explicit per-group keep selections are stored separately from server recommendations and survive filtering, pagination, and recommendation reloads. `按推荐选择保留项` clears overrides for the current page.
- The active full path, recursive meaning, and direct clear action are visible. Directory browsing remains metadata-only.

## Verification

- Fixed Node 22.23.1/npm 10.9.8 focused suite: 6 files, 119/119 PASS.
- Final focused renderer rerun after accessible-name refinement: 2 files, 64/64 PASS.
- Developer Gate: `DEV_GATE_PASS`; typecheck, production build, Node ABI 127 native smoke, 47 files and 472/472 tests PASS.
- `git diff --check`: PASS.
- No migration, dependency, duplicate-cleanup service, SHA-256 verifier, authorization, staged-delete, or permanent-delete implementation changed.

## Known limits

- No real application screenshot was taken because normal startup can touch the configured user library. Renderer DOM/accessibility tests and responsive CSS inspection were used.
- The operation filters and recommends across all matching groups, but verification remains explicitly scoped to the currently displayed page.

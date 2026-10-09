---
date: 2026-10-09
branch: ai/public-release-audit
type: fix
status: partial
---

# Public-release safe deletion default: verify and manually approve, never quick-delete silently

## Context

Owner approved proceeding with recommended safety-first defaults rather than choosing fast permanent deletion behavior case-by-case. This explicitly authorizes *disabling* risky metadata-only deletion as the public default; no project license, code-signing or public distribution rights were approved. Continue PR #24 without altering main or a formal tag.

## Changes

- The active renderer LibraryShell now connects the existing `DuplicateCleanupButton` full-content SHA-256 verification flow through `onSubmitCleanup`; no longer exposes its fast delete current-page/filtered handlers. Per-item fast deletion controls are not rendered in that wiring. Users must review a verification dialog, then inspect the independent background job and enter `DELETE` for the second irreversible authorization after hashes match.
- DuplicateCleanupService rejects historical `autoDeleteAfterVerification:true` requests instead of interpreting them as unverified API deletion or silently auto-deleting verified files. It rejects metadata-only filtered fast submissions; refuses replay of an existing workflowVersion=3 fast task even with a new safer request; blocks retry/resume of previously stored fast jobs. The task worker also refuses to start workflowVersion=3 as final safeguard. Previous jobs can be canceled/cleared without running deletion.
- Existing SHA-256 workflowVersion=2 cancellation, stage recovery and final integrity checks are left in place. Fast mode is **fully disabled for now**, not merely a cosmetic toggle: re-enabling it would require a separate reviewed per-job opt-in and typed strong confirmation, plus an owner decision. Existing runtime fast-process code remains unreachable by current public service entry points for compatibility/auditing but is not an approved release path.
- Clarified candidate UI and old job status, left data and signing approval settings unchanged. Existing tests for old fast behavior were updated to assert that the formerly allowed routes now fail closed; added tests for filtered-submit rejection and stale request replay. No tests or budgets removed.

## Verification

- Starting HEAD `e92486aafa04ed20b1e3a91e86990c3efefd64dc`, clean worktree on `ai/public-release-audit`, origin matched, PR #24 Draft, main `807c495`.
- Mandatory pre-edit checkpoint `checkpoint-20261009-090518-e92486a-public-release-safe-deletion-default` pushed, SQLite quick_check OK; snapshot `2026-10-09_01-05-23-441_public-release-safe-deletion-default`. Real videos/database untouched by destructive checks.
- First targeted typecheck: FAIL, malformed JSX closing delimiters from edit; immediately fixed.
- Second targeted typecheck: PASS. Targeted Vitest first run: FAIL 1/90 (old UI copy expectation), existing behavior tests 89 pass; exact failure retained at `.tmp/public-release-safe-delete-targeted.log`. Corrected wording expectation.
- Targeted Vitest re-run `tests/main/duplicateCleanupJobs.test.ts`, `tests/renderer/DuplicateGroupsPage.test.tsx` and `tests/renderer/DuplicateCleanupTasksPanel.test.tsx`: **PASS 3 files / 92 tests**, after adding two fail-closed regression tests. Log at ignored `.tmp/public-release-safe-delete-targeted2.log`.
- Full `npm run test:release-gate` with final, correctly wired LibraryShell: **PASS (exit 0)**; lint/typecheck/build, Windows 37, migrations 40, performance 31, Node native ABI and 131 Vitest files/1177 tests without skips; separate 5 Node candidate tests PASS. Exact ignored log `.tmp/public-release-safe-delete-final-gate.log`. An earlier gate before correcting the renderer wiring also passed but is not used as final acceptance.
- `test:electron-smoke` and `test:renderer-security-smoke` initial local runs: PASS (Electron 44.7.0/ABI149, OS safeStorage, preload role and renderer protocol denial). Final-source reruns of both smokes after the LibraryShell fix also PASS (exit 0; Electron44.7.0/ABI149, renderer protocol deny), logs `.tmp/public-release-safe-delete-final-electron.log` and `.tmp/public-release-safe-delete-final-renderer.log`. Post-commit packaged QA results are recorded in PR #24. The first `dist:win`, `verify:artifact`, `release:metadata`, `test:packaged-smoke` and `test:installer-smoke` all PASS but that package was generated before final UI wiring; it is **not** the delivery candidate, and its SHA must not be used. A fresh post-commit isolated unsigned package is required. Product desktop installation: NOT_DELIVERED until the final new package is independently verified.
- Clean stable Windows 11 without developer tools, prior signed-version migration, dangerous real CloudDrive delete, historical privacy authorization and signing: NOT_RUN.

## Risks and follow-up

- The old CloudDrive fast deletion business logic is intentionally inaccessible from the default production app. Full SHA-256 on network/cloud-mapped files can be slow or may fail when content is inaccessible; failure must not authorize a delete. There is currently no safe full-filtered deletion operation over all pages; work page-by-page.
- Formal public release continues to be FAIL because of missing owner license/right-to-distribute verification, FFmpeg source/library notices and patches, signing identity/protected reviewer, clean-Windows and old signed upgrade acceptance and history privacy decisions.
- Keep old failed test logs, retain original unsigned installer/shortcuts, do not confuse local new candidate hashes with earlier package. No main/tag/Release updates.

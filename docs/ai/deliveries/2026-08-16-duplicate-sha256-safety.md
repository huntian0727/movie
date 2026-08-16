---
date: 2026-08-16
branch: ai/duplicate-sha256-safety
type: feat
status: qa_pass_with_known_risks
---

# Require full SHA-256 authorization for permanent duplicate deletion

## Context

Duplicate candidates were intentionally discovered from cached metadata, but the former permanent-delete path only rechecked size and modification time. The approved contract keeps normal browsing low-bandwidth while requiring a separate, cancellable, full-content verification before any irreversible duplicate cleanup.

## Changes

- Add schema v10 fields for workflow phase, verification revision, three-state outcome, full keep/target SHA-256 evidence, and main-process authorization. Active v9 tasks are safely invalidated and cannot resume deletion.
- Split duplicate cleanup into verification, awaiting-confirmation, deletion, and finished phases. Verification reads every selected file without deleting; only byte-identical groups proceed.
- Require an exact `DELETE` second confirmation tied to the current verification revision. The main process signs eligible rows, guards the deletion claim in SQL, and rechecks both file versions immediately before deletion.
- Make verification cancellation abortable and zero-delete. Keep “stop remaining deletions” as a separate deletion-phase action. Resume and retry always create a new verification revision and require confirmation again.
- Remove the old direct duplicate resolve IPC/API and duplicate-card single-item delete. Reject generic permanent deletion of current duplicate candidates.
- Update the minimal task-center/preflight UI, tri-state results, warnings, focus behavior, Escape handling, and regression tests.

## Verification

- `scripts/agent/run-dev-gate.ps1` via fixed Node 22.23.1/npm 10.9.8: PASS (`DEV_GATE_PASS`).
- Environment verification, TypeScript typecheck, production build, Node native smoke: PASS.
- Full Vitest suite: PASS, 46 files and 436/436 tests.
- Focused main safety/migration/legacy-helper suites: PASS, 55/55 tests.
- Focused renderer/IPC suites: PASS, 22/22 tests.
- `git diff --check`: PASS.
- Electron desktop smoke: NOT RUN here; policy requires a separate Electron ABI checkout.
- Real large-file cancellation and mapped/offline drive: NOT RUN; required in independent QA.

## Risks and follow-up

- Full hashing can be slow and bandwidth-intensive on network storage; this cost is confined to the explicit verification stage.
- Multi-file permanent deletion is not atomic after deletion begins. A stop request prevents later items but cannot restore an item whose deletion already completed.
- Independent QA must validate real Windows filesystem behavior, offline/mapped-drive failures, large-file cancellation, migration of active v9 tasks, and isolated Electron smoke before release.

## Independent QA result

- Verdict: `FAIL` on 2026-08-16.
- Fixed Node 22.23.1 focused run: 17 PASS / 2 FAIL.
- Release blocker 1: a target replaced after verification with different same-size content and restored mtime is still permanently deleted.
- Release blocker 2: scan-failure single/batch permanent deletion can delete a current duplicate candidate without full SHA-256 verification or the second confirmation.
- Full release gate, Electron ABI smoke, large-file cancellation, and mapped/offline-drive validation were not run after the P0 stop decision.
- QA evidence: `.agent/handoffs/TASK-SAFETY-001-qa.md`.

## Developer REWORK 1

- Preserve and fix both P0 regressions: same-size/same-mtime post-verification replacement and scan-failure permanent-delete bypass.
- Persist strong keep/target file identity with the complete SHA-256. Rehash both at deletion, atomically isolate the target to a persisted same-directory random path, verify the isolated stable identity and hash, then rehash keep before the irreversible call.
- Recover unfinished isolation on startup. Never overwrite an occupied original path; retain staged-path evidence and prevent task clear/retry until recovery is resolved.
- Make scan-failure helpers fail closed without a trusted permanent-delete guard and inject the centralized duplicate-candidate guard for IPC single and batch cleanup.
- Restore the QA-identified secondary database, scheduling, terminal-record, task-panel, missing/error, and detail regressions.

### REWORK verification

- Fixed Node focused suite: 5 files, 92/92 PASS.
- Full Developer gate: `DEV_GATE_PASS`; typecheck, production build, Node ABI 127 smoke, 46 files and 459/459 tests PASS.
- `git diff --check`: PASS.
- Still pending independent QA: real large-file cancellation, mapped/offline/SMB drive behavior, real Windows isolation/recovery, and separate Electron ABI smoke.

## Developer UI REWORK 2

- Candidate browsing no longer claims known duplicates or deletion results before verification. Visible labels use candidate, planned-keep, candidate-removal, and candidate-reclaimable semantics.
- Verification and review controls use neutral workflow colors; red is reserved for the actual final permanent-delete action.
- Added consistent visible keyboard focus, exact task-center opener focus restoration, stable cancellation/recovery copy, accessible progress names, throttled item-level live updates, resolved CSS tokens, and reduced-motion behavior.
- Added an isolated 900 px DOM/layout structure gate and static CSS width/grid/breakpoint verification. No real-app screenshot was taken because launching the normal app can read or update the user's configured library.
- Focused UI: 35/35 PASS without React `act(...)` warnings. Library integration: 45/45 PASS. Full Developer gate: 47 files, 467/467 PASS and `DEV_GATE_PASS`.

## Independent QA — REWORK 1

- Verdict: `PASS_WITH_KNOWN_RISKS`; task status `QA_PASS`.
- Preserved original P0/fail-closed tests: 33/33 PASS.
- Focused safety, v9→v10 migration, UI, and restored-coverage suites: 5 files, 92/92 PASS.
- Fixed Node 22.23.1/npm 10.9.8 release gate: lint/build, 37 Windows-file tests, 32 migrations, 21 performance tests, Node ABI 127 smoke, and 46 files/459 tests PASS.
- Detached temporary Electron checkout: build and Electron 33.4.11 ABI 130 native/main-process smoke PASS; main checkout remained Node ABI 127.
- Expendable non-sparse 256 MiB real streaming SHA-256 cancellation and file/hash preservation: 1/1 PASS.
- Staged same-directory rename, hash/read/cancel/delete/rename failures, path swap, occupied-path evidence, and startup recovery all pass fail-closed with actual temporary files.
- Known risk: mapped/offline SMB and server-specific identity/atomic rename behavior remain NOT RUN because no network drive is available on this host.
- QA evidence: `.agent/handoffs/TASK-SAFETY-001-qa-rework-1.md`.

## Independent QA — UI REWORK 2

- Verdict: `PASS_WITH_KNOWN_RISKS`; task status `QA_PASS`.
- Production-boundary audit found no main-process, preload, shared-contract, migration, or duplicate-deletion safety implementation change after the prior REWORK 1 QA pass.
- Original P0, staged-recovery, and scan-failure fail-closed suites: 2 files, 33/33 PASS.
- Candidate workflow, task center, safety styles, and LibraryShell integration: 4 files, 80/80 PASS without React `act(...)` warnings.
- Candidate-only DOM language, neutral verification/review treatment, exact `DELETE`, focus-visible and exact opener restoration, cancel/stop wording, stable recovery guidance, accessible throttled progress, reduced motion, and the isolated 900 px DOM/CSS layout gate pass.
- `git diff --check`: PASS.
- Electron ABI and 256 MiB cancellation were not repeated because backend/native code did not change; the prior independent evidence remains applicable.
- Known risk remains real mapped/offline SMB behavior because no suitable network drive exists on this host.
- QA evidence: `.agent/handoffs/TASK-SAFETY-001-qa-ui-rework-2.md`.

## Developer UI REWORK 3

- Replaced terminal task-row `完整哈希相同 + backend message` composition with one stable Chinese outcome conclusion.
- Added explicit fail-closed guidance for `isolation-failed` and restored/unrestored `delete-stop-requested`: not permanently deleted, deletion authorization invalid, and file recovery/access resolution followed by full re-verification.
- Audited all neighboring service/repository outcome codes. Staged failures show the recoverable path and recovery-first next step; unknown filesystem failures use a stable Chinese fallback instead of raw English.
- Scan-failure cleanup results are a separate renderer contract and do not enter this task-panel mapping. Main-process safety logic and CSS were not changed.
- Fixed Node panel test: 17/17 PASS. Focused safety UI: 4 files, 81/81 PASS. Typecheck: PASS. Full Developer gate: `DEV_GATE_PASS`, 47 files and 468/468 tests PASS. `git diff --check`: PASS.
- Developer evidence: `.agent/handoffs/TASK-SAFETY-001-developer-ui-rework-3.md`.

## Independent QA — UI REWORK 3

- Verdict: `PASS_WITH_KNOWN_RISKS`; task status `QA_PASS`.
- Production-boundary audit confirms the delta is limited to renderer outcome presentation, renderer tests, and records; no backend, preload/shared contract, migration, CSS, or native boundary changed.
- Panel-focused outcome regression: 17/17 PASS. Four-file UI/LibraryShell regression: 81/81 PASS.
- Isolation failure, restored/staged deletion stop, adjacent safety outcomes, dynamic filesystem errors, and unknown terminal failures render stable Chinese no-delete, invalid-authorization, recovery/reverification guidance. Raw backend messages and misleading `完整哈希相同` prefixes are absent; `deleted` remains correctly presented.
- `git diff --check`: PASS. Backend, Electron ABI, and 256 MiB cancellation were not repeated because their boundary did not change.
- Known risk remains real mapped/offline SMB behavior because no suitable network drive exists on this host.
- QA evidence: `.agent/handoffs/TASK-SAFETY-001-qa-ui-rework-3.md`.

## Final UI review

- Verdict: `UI_REVIEW_PASS` after UI_REVIEW 3.
- Candidate copy remains explicitly non-authoritative until full verification; only the final irreversible action uses danger styling.
- Every reachable duplicate-cleanup terminal outcome now renders stable Chinese no-delete/deleted state and recovery or re-verification guidance without exposing raw backend messages.
- Focus-visible, exact opener restoration, Escape semantics, accessible progress/live regions, reduced motion, exact `DELETE`, and isolated 900 px DOM/CSS gates pass.
- Final focused renderer/LibraryShell evidence: 4 files / 81 tests PASS, panel 17/17, no React `act(...)` warnings.
- UI evidence: `.agent/handoffs/TASK-SAFETY-001-ui-review-3.md`.

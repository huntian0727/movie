# TASK-SAFETY-001 — Reconcile duplicate-deletion safety contract

- Task ID: TASK-SAFETY-001
- Title: Decide and align the duplicate-deletion verification contract
- Priority: P0
- Owner: Local Project Manager
- Background: The takeover audit found a conflict between the release checklist's full SHA-256 requirement and the former metadata-only permanent-delete path. The user approved staged content verification with no bypass for permanent duplicate deletion.
- User Goal: Know exactly what safety guarantee the product provides before any release or destructive-operation change.
- Product Goal: Balance irreversible deletion safety against low-bandwidth network-drive performance without contradictory promises.
- Scope: Record the approved contract; implement schema v10 verification/authorization/recovery; align ADR, UX, IPC, task recovery, generic/scan-failure guards, tests, release evidence, and long-term documentation.
- Out of Scope: Hashing during ordinary candidate browsing, weakening full SHA-256 for permanent deletion, broad library redesign, or operating on non-expendable user media during validation.
- Technical Constraints: Source media is the truth; deletion is permanent; page browsing must not read whole network files; candidate grouping does not prove identical content; Node and Electron native ABIs require isolated workspaces.
- Acceptance: Duplicate browsing performs no full-file hashing; permanent cleanup first runs a cancellable read-only SHA-256 verification stage; results distinguish verified-identical, content-different, and unverifiable; cancellation/failure/offline/read errors delete nothing; only verified-identical files can reach a second permanent-delete confirmation; every target is version-rechecked immediately before deletion and any change blocks deletion; no permanent duplicate-delete path can bypass successful full verification.
- Automated Tests: Candidate browsing performs no content reads; known-equal/known-different fixtures; verification cancellation and read/offline failures; file changes between verification and deletion; restart/recovery; direct IPC and service bypass attempts; release-gate regression proving unverified permanent deletion is impossible.
- Local Validation: Use fixed Node 22.23.1/npm 10.9.8; exercise an isolated Electron-ABI smoke workspace; test real large-file cancellation and at least one mapped/offline drive when available; confirm zero deletion calls for every non-verified outcome.
- QA Required: YES after implementation
- UI Required: YES if confirmation or warning UX changes
- Web Advisor Review Required: YES
- Web Advisor Review Stage: COMPLETE — user returned the reviewed option 3 directive on 2026-08-16.
- Git Requirements: Base all review claims on pushed GitHub SHA and list the exact review files.
- Status: VERIFIED
- Next Actor: Local Project Manager or user may arrange expendable mapped/offline SMB validation when suitable infrastructure is available; no implementation rework is open.

## Binding decision

- Candidate discovery remains metadata-only and must not trigger full-file reads during normal duplicate browsing.
- Permanent duplicate cleanup requires a separate, read-only, cancellable full SHA-256 verification stage.
- Verification outcomes are `verified-identical`, `content-different`, or `unverifiable`.
- Cancellation, failure, offline state, or read error must produce zero file deletions.
- Only `verified-identical` targets may enter a second permanent-delete confirmation.
- The application must recheck file version information immediately before deletion; post-verification changes invalidate authorization.
- Fast/low-bandwidth behavior may support candidate discovery or recoverable actions, never permanent-delete bypass.
- Any code path that permanently deletes a duplicate without successful full SHA-256 verification is a Windows release blocker.

## Developer evidence (2026-08-16)

- Added schema v10 with workflow phase, verification revision, three-state verification result, complete SHA-256 evidence, and main-process authorization revision. The v9-to-v10 migration safely cancels active legacy tasks, clears deletion eligibility, and releases reservations.
- Candidate browsing remains unchanged and metadata-only. Submission stores metadata snapshots only; full reads begin only in the independently cancellable verification worker.
- Removed the `duplicate:resolve` IPC/preload/API route. The retired direct helper now hard-fails. Duplicate-page single-item deletion is removed, and generic single/batch/pending-clear permanent-delete IPC rejects current duplicate candidates.
- Only persisted `verified-identical` items whose keep/delete SHA-256 values match may receive a main-process authorization. Confirmation requires the current verification revision and exact `DELETE`; every keep and target version is rechecked immediately before a guarded deletion claim.
- Restart, resume, and retry invalidate prior authorization and restart full verification. Verification cancellation aborts reads and deletes nothing; deletion cancellation stops only remaining authorized items.
- Final Developer gate: `DEV_GATE_PASS`, Node 22.23.1/npm 10.9.8, 46 files and 436/436 tests. Focused safety tests: main 55/55 after the added v9 migration case and state-machine tests; renderer/IPC 22/22. `git diff --check`: PASS.
- Real large-file cancellation, mapped/offline drive behavior, and Electron desktop smoke remain independent QA items; Electron smoke must run in a separate Electron ABI checkout.

## Independent QA result (2026-08-16)

- Verdict: `FAIL` / `QA_FAILED`.
- P0: a target whose content changes after verification is still deleted when its size and mtime are restored to the verified values.
- P0: scan-failure single/batch permanent deletion can delete a current duplicate candidate without full SHA-256 verification or the second confirmation.
- Fixed Node 22.23.1 focused reproduction: 17 PASS / 2 FAIL across `duplicateCleanupJobs.test.ts` and `scanFailureReview.test.ts`.
- Full release gate, isolated Electron smoke, real large-file cancellation, and mapped/offline-drive validation were not run after the P0 stop decision.
- Formal evidence and required corrections: `.agent/handoffs/TASK-SAFETY-001-qa.md`.

## Developer REWORK 1 evidence (2026-08-16)

- Preserved both QA P0 regressions unchanged. Same-size/same-mtime replacement and scan-failure direct bypass now pass.
- Verification persists complete SHA-256 plus strong identity evidence derived from device, inode/file identity, birth time, exact size, mtime nanoseconds, and ctime nanoseconds for both keep and target.
- Deletion rehashes keep and target against persisted SHA-256 and identity. It then persists a random same-directory isolation path, atomically renames the target, rehashes the isolated stable identity/content, and finally rehashes keep before the guarded claim and permanent call. A path swap in the check-to-delete window is therefore isolated and rejected rather than deleted.
- Isolated-path recovery is durable: startup restores when the original path is free; if the original is occupied or recovery fails, it never overwrites/deletes and retains the staged path and failure evidence. Tasks with recovery evidence cannot be cleared or restarted.
- Scan-failure single and batch permanent cleanup now receive the centralized duplicate-candidate guard at IPC. The helper fails closed if no trusted guard is supplied, so direct application reachability cannot bypass it.
- Restored secondary regression coverage: 500-item database-only plan, multi-job serialization, terminal clear, task-panel selection/error/refresh, and duplicate-page missing/error/detail behavior.
- Fixed Node 22.23.1/npm 10.9.8 focused suite: 5 files, 92/92 PASS. Final Developer gate: `DEV_GATE_PASS`, typecheck/build/Node ABI smoke PASS, 46 files and 459/459 tests PASS. `git diff --check`: PASS.
- Independent QA still must run real large-file cancellation, mapped/offline/SMB behavior, Windows same-volume isolation/recovery, and Electron smoke in a separate Electron ABI checkout.

## Developer UI REWORK 2 evidence (2026-08-16)

- Replaced pre-verification result promises with candidate semantics: `候选组`, `候选项`, `计划保留`, `候选移除`, and `候选可释放空间`. Renderer regression rejects `重复组`, `拟删除`, `待删除`, `预计可释放`, and `待删文件` in the candidate workflow DOM.
- Verification opener and review opener are non-destructive colors; only the actual final `永久删除已验证相同项` action uses the danger treatment.
- Added shared visible `:focus-visible` treatment for workflow buttons, inputs, selects, links, and task rows. The outer task center restores focus to the exact opener after Escape, header close, and backdrop close.
- Added stable cancellation/deletion-stop copy, version-change and isolation-recovery authorization-invalidated mappings, explicit progress names, throttled item-level `aria-live`, resolved CSS tokens, and reduced-motion handling.
- 900 px real-app screenshot was intentionally not launched because the normal app can touch the user's library. An isolated 900 px DOM structure test plus static CSS width/grid/breakpoint gate passed; independent UI review may capture a fixture-app screenshot if available.
- Fixed Node focused safety UI: 3 files, 35/35 PASS with no React `act(...)` warnings. LibraryShell integration: 45/45 PASS. Final Developer gate: `DEV_GATE_PASS`, typecheck/build/Node ABI smoke PASS, 47 files and 467/467 tests PASS. `git diff --check`: PASS.

## Independent QA REWORK 1 result (2026-08-16)

- Verdict: `PASS_WITH_KNOWN_RISKS`; status `QA_PASS`.
- Both original QA P0 regression assertions are preserved and now pass. Original P0/fail-closed suites: 33/33 PASS.
- Focused safety/migration/restored-coverage suite: 5 files, 92/92 PASS.
- Fixed Node 22.23.1 release gate: lint/build, 37 Windows-file tests, 32 migrations, 21 performance tests, Node ABI 127 smoke, and 46 files/459 tests PASS.
- Isolated temporary Electron checkout: Electron 33.4.11 ABI 130 native and main-process smoke PASS; the main checkout remained Node ABI 127.
- Real temporary 256 MiB streaming SHA-256 cancellation and post-cancel full-hash preservation: 1/1 PASS.
- Actual temporary-file isolation restoration, occupied-path evidence, and startup recovery tests PASS.
- Known risk: real mapped/offline SMB and server-specific atomic rename/file-identity behavior remain NOT RUN because the host has no mapped/network drive.
- Detailed evidence: `.agent/handoffs/TASK-SAFETY-001-qa-rework-1.md`.

## Independent QA UI REWORK 2 result (2026-08-16)

- Verdict: `PASS_WITH_KNOWN_RISKS`; status `QA_PASS`.
- No main-process, preload, shared-contract, migration, or duplicate-deletion safety implementation file changed after the prior REWORK 1 QA pass.
- Original P0/staged-recovery/scan-guard focused suites: 2 files, 33/33 PASS.
- Candidate workflow, task center, safety styles, and LibraryShell integration: 4 files, 80/80 PASS with no React `act(...)` warnings.
- Candidate semantics, neutral verification/review actions, exact `DELETE`, focus-visible and opener restoration, cancel/stop copy, stable error guidance, accessible live progress, reduced motion, and the isolated 900 px DOM/CSS gate all pass.
- `git diff --check`: PASS.
- Electron ABI and 256 MiB cancellation were not repeated because backend/native code did not change; prior REWORK 1 evidence remains applicable.
- Known risk remains real mapped/offline SMB behavior, unavailable on this host.
- Detailed evidence: `.agent/handoffs/TASK-SAFETY-001-qa-ui-rework-2.md`.

## Developer UI REWORK 3 evidence (2026-08-16)

- Replaced the task-item `verification label + raw message` composition with one stable outcome conclusion. Terminal non-deletion results no longer retain the misleading `完整哈希相同` prefix.
- Added explicit Chinese conclusions for `isolation-failed` and both restored/unrestored `delete-stop-requested`: every path states that the item was not permanently deleted, the deletion authorization is invalid, and whether to resolve file access or restore the staged file before a new full verification.
- Audited adjacent repository/service outcomes: `deleted`, verification tri-state outcomes, `legacy-safety-blocked`, integrity/identity changes, isolation recovery, authorization rejection, and arbitrary filesystem error codes. Known outcomes have dedicated copy; unknown terminal failures use a fail-closed Chinese fallback and never expose backend English text.
- `scan-failure-review` cleanup uses a separate result status/message contract and does not enter `DuplicateCleanupTasksPanel` outcome mapping. No main-process safety logic, preload/shared contract, migration, or CSS was changed.
- Fixed Node 22.23.1/npm 10.9.8 focused panel: 17/17 PASS. Focused safety UI: 4 files, 81/81 PASS. Typecheck: PASS. Final Developer gate: `DEV_GATE_PASS`, production build and Node ABI smoke PASS, 47 files and 468/468 tests PASS. `git diff --check`: PASS.
- Detailed evidence: `.agent/handoffs/TASK-SAFETY-001-developer-ui-rework-3.md`.

## Independent QA UI REWORK 3 result (2026-08-16)

- Verdict: `PASS_WITH_KNOWN_RISKS`; status `QA_PASS`.
- Production-boundary timestamps confirm no main-process, preload, shared-contract, migration, CSS, or native-boundary change after the prior focused QA.
- Panel-focused outcome mapping: 1 file, 17/17 PASS.
- Four-file focused UI and LibraryShell regression: 4 files, 81/81 PASS.
- `isolation-failed`, restored/staged `delete-stop-requested`, adjacent safety codes, dynamic `EBUSY`, and unknown terminal failures all render stable Chinese no-delete/authorization-invalidated/recovery-or-reverification guidance without raw messages or a misleading `完整哈希相同` prefix. `deleted` remains correct.
- `git diff --check`: PASS. Backend/Electron/256 MiB were not repeated because their boundary did not change.
- Known risk remains real mapped/offline SMB behavior, unavailable on this host.
- Detailed evidence: `.agent/handoffs/TASK-SAFETY-001-qa-ui-rework-3.md`.

## Final UI REVIEW 3 result (2026-08-16)

- Verdict: `UI_REVIEW_PASS`.
- The sole UI REVIEW 2 finding is closed: `isolation-failed`, restored/staged `delete-stop-requested`, adjacent reachable outcomes, and unknown terminal failures now use stable Chinese no-delete/authorization-invalidated/recovery-or-reverification guidance.
- Terminal non-deletion rows do not expose raw backend messages or retain the misleading `完整哈希相同` prefix; successful `deleted` remains explicit.
- Final focused renderer and LibraryShell rerun: 4 files, 81/81 PASS; task panel 17/17 PASS; no React `act(...)` warnings.
- The previously accepted 900 px screenshot evidence gap and real mapped/offline SMB evidence gap remain non-blocking known risks.
- Detailed evidence: `.agent/handoffs/TASK-SAFETY-001-ui-review-3.md`.

## Git delivery and remote verification (2026-08-16)

- Verified implementation commit: `853c0fb3d6b84a90448d25293ed502768f3338ca`.
- Branch `ai/duplicate-sha256-safety` and `main` were pushed to the verified implementation commit.
- GitHub Windows CI run `31956117214`: PASS.
- Electron native and main-process smoke: PASS.
- Node tests and Windows file safety release regression gate: PASS.
- This task is verified and archived. This is not a formal Windows release approval: real mapped/offline SMB behavior remains an evidence gap.

## Recommended question for Web Advisor

The current pushed 映匣 baseline intentionally treats duplicates as candidates using cached exact size + duration, performs no content hashing when opening the page, and checks existence + size + mtime before permanent deletion. This protects low-bandwidth mapped drives but cannot prove byte identity. However `docs/windows-release-checklist.md` still requires a full SHA-256 check before duplicate deletion.

Please decide which product safety contract should govern permanent duplicate cleanup:

1. keep the current low-bandwidth contract and correct the release checklist/UX guarantee;
2. require full hashes only after explicit final confirmation, accepting network-read cost;
3. use a staged or opt-in verification model.

Please evaluate irreversible-deletion risk, network/NAS cost, user expectations, failure/cancellation behavior, implementation complexity, and what must block a formal release. Also specify the exact UX promise and minimum QA evidence.

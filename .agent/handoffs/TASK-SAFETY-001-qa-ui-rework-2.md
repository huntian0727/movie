# Agent Handoff — UI REWORK 2 focused QA

- Task ID: TASK-SAFETY-001
- From: QA Agent
- To: Local Project Manager
- Status: QA_PASS
- Verdict: `PASS_WITH_KNOWN_RISKS`
- Branch: `ai/duplicate-sha256-safety`
- SHA: `2bc1359975fc6098dd8663043f00a36cb6203ab0` plus uncommitted TASK-SAFETY-001 changes
- Changed Files: QA added this handoff and updated task/state/delivery records only. QA did not modify production code or tests.
- Next Actor: Local Project Manager routes UI_REVIEW 2, then normal delivery.

## Conclusion

UI REWORK 2 passes focused independent regression. No main-process, preload, shared-contract, migration, or duplicate-deletion safety implementation file was modified after the prior REWORK 1 QA handoff. The original two P0 regressions, staged-delete recovery coverage, and scan-failure fail-closed guards remain green.

The candidate workflow does not promise duplicate identity or deletion before complete verification. Verification/review controls are neutral; only the final authorized permanent-delete button uses the danger treatment. Exact case-sensitive, untrimmed `DELETE` remains required. Focus-visible behavior, exact opener restoration, verification-cancel versus deletion-stop wording, stable version/isolation/authorization messages, named progress, throttled `aria-live`, reduced motion, and the isolated 900 px DOM/CSS layout gate all pass.

The verdict remains `PASS_WITH_KNOWN_RISKS` only because the host still has no disposable mapped/SMB drive. Real SMB disconnect, offline recovery, server-specific identity, and server-specific atomic same-directory rename behavior remain unverified. No new local P0 or P1 was found.

## Production-diff boundary

The previous independent REWORK 1 QA handoff was written at `2026-08-16T22:48:56+08:00`. All currently modified safety/backend files predate it:

- `src/main/db/database.ts` and `duplicateCleanupRepository.ts`: 22:29
- `src/main/db/migrations/index.ts`: 21:38
- `src/main/files/scanFailureActions.ts` and `src/main/ipc.ts`: 22:27
- `src/main/media/duplicateCleanupService.ts`: 22:29
- `src/main/media/duplicateResolveSafety.ts`: 21:49
- `src/main/preload.cts`: 21:46
- `src/shared/videoTypes.ts`: 22:30

The UI REWORK 2 production delta is confined to renderer components and CSS. Because no backend/native boundary changed, QA did not repeat the isolated Electron ABI smoke or 256 MiB real-file cancellation run; the prior REWORK 1 evidence remains applicable.

## Independent evidence

Fixed runtime:

- Node `22.23.1`
- npm `10.9.8`
- Node ABI `127`

Focused backend safety run:

- `tests/main/duplicateCleanupJobs.test.ts`
- `tests/main/scanFailureReview.test.ts`
- Result: 2 files, 33/33 PASS.

This preserves the original two P0 assertions and covers same-size/same-mtime replacement blocking, complete rehash/strong identity, staged rename/recovery failure paths, path-swap resistance, and scan-failure single/batch/helper fail-closed guards.

Focused renderer/integration run:

- `tests/renderer/DuplicateGroupsPage.test.tsx`: 16/16 PASS
- `tests/renderer/DuplicateCleanupTasksPanel.test.tsx`: 16/16 PASS
- `tests/renderer/duplicateSafetyStyles.test.ts`: 3/3 PASS
- `tests/renderer/LibraryShell.test.tsx`: 45/45 PASS
- Result: 4 files, 80/80 PASS; no React `act(...)` warning was emitted.

Static and DOM assertions verify:

- Candidate browsing says candidate group/item, planned keep, candidate removal, and candidate reclaimable space; it rejects premature duplicate/delete wording.
- The workflow explicitly says candidate browsing uses cached metadata and does not read video content.
- Verification and review openers are non-danger controls; the final permanent-delete action remains danger-styled.
- `delete`, leading/trailing spaces, and other non-exact values cannot enable confirmation; exact `DELETE` is passed with the current verification revision.
- Escape, header close, and backdrop close restore focus to the exact task-center opener; the nested confirmation restores focus to its trigger.
- Verification cancellation and stopping remaining deletions have distinct, irreversible-state-aware copy.
- Version change, isolation recovery, and authorization rejection use stable guidance and hide raw internal errors; the staged recovery path remains visible.
- Progress has an accessible name and a polite, atomic, 500 ms throttled live status.
- Workflow controls have shared `:focus-visible`; reduced-motion disables workflow animation.
- At the isolated 900 px fixture, the task center preserves both DOM columns and its close control; static CSS retains the two-column gate until the 760 px collapse breakpoint.

`git diff --check`: PASS.

## Not repeated / known risk

- Isolated Electron 33.4.11 ABI 130 smoke: NOT REPEATED because no backend/preload/native boundary changed; prior REWORK 1 PASS remains applicable.
- Real disposable 256 MiB streaming cancellation and preservation: NOT REPEATED because hashing/deletion code did not change; prior REWORK 1 PASS remains applicable.
- Real mapped/offline SMB: NOT RUN because the host has no suitable mapped/network drive; remains the sole material known risk.


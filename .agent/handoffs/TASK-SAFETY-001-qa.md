# Agent Handoff

- Task ID: TASK-SAFETY-001
- From: QA Agent
- To: Local Project Manager
- Status: QA_FAILED
- Branch: `ai/duplicate-sha256-safety`
- SHA: `2bc1359975fc6098dd8663043f00a36cb6203ab0` plus uncommitted implementation and QA regressions
- Changed Files: QA added focused regressions in `tests/main/duplicateCleanupJobs.test.ts` and `tests/main/scanFailureReview.test.ts`, and updated this handoff plus task/delivery/state records. QA did not modify production code.
- Evidence: Fixed Node 22.23.1 / npm 10.9.8 focused execution produced 17 PASS / 2 FAIL. Both failures are P0 permanent-deletion safety violations with real temporary files and injected delete spies.
- Risks: Full release gate, isolated Electron ABI smoke, real large-file cancellation, and mapped/offline-drive validation were not run after the P0 release blockers were reproduced. The host has no DriveType 4 volume or SMB mapping available.
- Requested Action: Local PM must return the task to Developer. Preserve both failing QA regressions. Do not request another QA pass until both P0 paths are closed without weakening the binding contract.
- Next Actor: Local Project Manager

## Verdict

`FAIL`

## P0-1 — Same-size, same-mtime content replacement is deleted

### Reproduction

`tests/main/duplicateCleanupJobs.test.ts` now verifies identical files, waits for `awaiting_confirmation`, replaces the target bytes with different content of the same length, restores the exact indexed mtime, and then submits the valid second confirmation.

Expected:

- the post-verification change invalidates authorization;
- `successItems = 0`, `skippedItems = 1`;
- zero permanent-delete calls;
- the changed target remains on disk.

Actual:

- job finishes as `completed`;
- `successItems = 1`, `skippedItems = 0`;
- the permanent-delete dependency is called and the changed target is removed.

### Root cause

`DuplicateCleanupService.hashExpected` records a full SHA-256 but the later deletion phase never revalidates that content hash. `processAuthorizedDelete` calls `inspect` twice for keep and target, while `inspect` considers a path current using only managed-root membership, file type, size, and mtime. Content replacement with restored size/mtime therefore retains stale authorization.

This fails the binding promise that a post-verification file change blocks deletion. It is not merely an untested theoretical race: the QA fixture permanently reaches the delete call.

### Required correction

The deletion boundary must detect content/identity replacement even when size and user-visible mtime are preserved, for both the keep file and every target. The correction must bind the irreversible operation to the same verified file identity/content and make the new regression pass. Rehashing immediately before deletion and comparing the persisted complete SHA-256 is one conservative option, but the final design must also address the check-to-delete identity race rather than relabelling size+mtime as proof of no change.

## P0-2 — Scan-failure permanent delete bypasses duplicate authorization

### Reproduction

`tests/main/scanFailureReview.test.ts` indexes two current videos with the same size and duration, creates a confirmed-corrupt scan-failure record for one candidate, then invokes the scan-failure permanent-delete path.

Expected:

- the candidate is rejected with the full SHA-256 requirement;
- zero delete calls;
- the video row remains.

Actual:

- `deleteScanFailureFile` resolves `{ deleted: true, videoId }`;
- the permanent-delete dependency is called;
- the candidate video row is removed.

### Root cause

The IPC handlers for `scan-failure-review:delete` and permanent-delete cleanup call `duplicateCleanup.assertVideosAvailable`, which checks only active reservations. They do not call the new duplicate-candidate guard. The flow then reaches `deleteScanFailureFile` → `permanentlyDeleteFile` → `VideoRepository.removeVideo` without full SHA-256 verification or the separate `DELETE` confirmation.

### Required correction

Every scan-failure path capable of permanent media deletion must pass through the centralized duplicate-candidate policy before any delete call. Both single and batch cleanup require regression coverage. A direct service/helper call must not remain an alternate unguarded route if it is reachable from application code.

## Permanent-delete and row-removal call graph audited

1. Verified duplicate workflow: `DuplicateCleanupService.processAuthorizedDelete` → injected `deleteFile` / `permanentlyDeleteFile` → `VideoRepository.removeVideo`. SHA authorization is present, but P0-1 bypasses post-verification change detection.
2. Pending-delete clear and generic batch delete: IPC → `assertGenericPermanentDeleteAllowed` → `permanentlyDeleteVideos` → `permanentlyDeleteFile` → `removeVideo`.
3. Generic single-video delete: IPC → `assertGenericPermanentDeleteAllowed` → `permanentlyDeleteFile` → `removeVideo`.
4. Scan-failure single delete: IPC → reservation-only `assertVideosAvailable` → `deleteScanFailureFile` → `permanentlyDeleteFile` → `removeVideo`. P0-2 bypass.
5. Scan-failure batch permanent cleanup: IPC → reservation-only `assertVideosAvailable` → `cleanupScanFailures` → `deleteScanFailureFile` → `permanentlyDeleteFile` → `removeVideo`. Same P0-2 bypass.
6. Retired `duplicate:resolve`: removed from channel/preload/API; `resolveDuplicatePlanSafely` now hard-fails.
7. Candidate-card single delete: removed from the renderer.
8. Cache-manager deletes target owned derived cache paths, not source media. `video:forget` removes a library record but does not permanently delete the source file.

## Focused fixed-environment evidence

Runtime:

- Node: `22.23.1`
- npm: `10.9.8`
- native ABI: Node ABI 127

Command:

```powershell
& 'C:\Users\test\AppData\Local\npm-cache\_npx\ed214ae0ceb6e0e4\node_modules\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run tests/main/duplicateCleanupJobs.test.ts tests/main/scanFailureReview.test.ts
```

Result:

- Test files: 2 failed
- Tests: 17 passed, 2 failed
- P0-1 actual: expected zero/blocked; received `status: completed`, `successItems: 1`.
- P0-2 actual: expected rejection; received `{ deleted: true, videoId }`.

An earlier invocation under the terminal-default Node 24.14.0 failed only with the expected ABI 137/127 mismatch. It was discarded as environment evidence and was not used for the verdict.

## Baseline 441 → Developer 436 coverage audit

The five-test net reduction is not accepted as evidence-neutral merely because 436/436 passed. The replacement suites add the core staged-verification cases, but they also remove or collapse prior coverage including the 500-item database-only plan, multi-job serialization, terminal-record clearing, several task-panel refresh/error/selection states, and duplicate-page missing-check/error/detail states. These are secondary restoration gaps, not the reason for the P0 verdict, but the next Developer handoff must give an explicit retained/replacement mapping rather than citing only the new total.

## Evidence not run after blocking result

- Full fixed-Node `npm run test:release-gate`: NOT RUN; the two checked-in QA regressions already make the focused gate fail.
- Isolated Electron ABI smoke: NOT RUN after P0 stop decision.
- Real large-file cancellation: NOT RUN after P0 stop decision.
- Mapped/offline drive: NOT RUN; no mapped/network drive is available on this host.
- v9→v10 active legacy task: reviewed statically and covered by the Developer migration test, but not promoted to a QA PASS because the task as a whole is blocked.

No release or local acceptance is permitted while either P0 regression fails.

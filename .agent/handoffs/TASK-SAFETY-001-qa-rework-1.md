# Agent Handoff — REWORK 1

- Task ID: TASK-SAFETY-001
- From: QA Agent
- To: Local Project Manager
- Status: QA_PASS
- Verdict: `PASS_WITH_KNOWN_RISKS`
- Branch: `ai/duplicate-sha256-safety`
- SHA: `2bc1359975fc6098dd8663043f00a36cb6203ab0` plus uncommitted REWORK 1 changes
- Changed Files: QA updated this handoff and task/delivery/state records only. The two prior QA P0 tests remain in their original test files with their original failure assertions. QA did not modify production code.
- Evidence: Original P0 suite 33/33 PASS; focused safety/migration/restored-coverage suite 92/92 PASS; fixed Node release gate PASS with 46 files/459 tests; isolated Electron 33.4.11 ABI 130 smoke PASS; main checkout remained Node ABI 127; real 256 MiB streaming cancellation/preservation test 1/1 PASS; `git diff --check` PASS.
- Risks: No mapped drive, SMB mapping, or DriveType 4 volume exists on this host. Real SMB atomic rename, disconnect-during-hash, offline recovery, and server-specific identity behavior remain NOT RUN. This environmental gap does not hide any failing local P0.
- Requested Action: Local PM may accept the independent QA stage, route final UI review if still required, then perform normal Git delivery and remote Windows CI verification. Preserve the recovery and P0 regression tests.
- Next Actor: Local Project Manager

## Verdict rationale

REWORK 1 closes both previously reproduced P0 failures without weakening their assertions:

1. A target replaced after verification with different same-size content and restored mtime is blocked; no permanent-delete call occurs and the actual file remains.
2. Scan-failure permanent deletion fails closed without a trusted generic-deletion guard; single and batch paths reject current duplicate candidates.

The local safety matrix, full release gate, actual-file recovery paths, and isolated Electron smoke all pass. The only material unverified requirement is real mapped/offline SMB behavior, which is unavailable in this environment and is therefore a known risk rather than a hidden PASS.

## Independent automated evidence

### Preserved P0 and staged recovery suites

Fixed runtime:

- Node `22.23.1`
- npm `10.9.8`
- Node native ABI `127`

Results:

- `tests/main/duplicateCleanupJobs.test.ts` + `tests/main/scanFailureReview.test.ts`: 2 files, 33/33 PASS.
- Five-file safety/migration/UI restoration run: 5 files, 92/92 PASS.
- The five files were `duplicateCleanupJobs`, `scanFailureReview`, `databaseMigrations`, `DuplicateGroupsPage`, and `DuplicateCleanupTasksPanel`.

The 92 tests cover:

- identical, same-metadata-different-content, unreadable/read-failure, and verification cancellation outcomes;
- target and keep same-size/same-mtime replacement after verification;
- strong identity plus complete rehash, including target path swap after the first pre-delete hash;
- post-isolation keep mutation;
- isolated-target hash mismatch and read failure;
- deletion-phase cancellation and actual target restoration;
- delete failure followed by actual same-directory restoration, re-verification, and reconfirmation;
- isolation rename failure with zero deletion;
- occupied original-path conflict preserving both files and the staged recovery path;
- startup restoration and startup conflict evidence;
- restart/resume/retry authorization invalidation;
- direct authorization rejection and legacy direct-resolve removal;
- scan-failure direct helper, single and batch fail-closed guards;
- 500-item metadata-only planning, serial jobs, and terminal clear behavior;
- restored task-panel selection/error/refresh and duplicate-page missing/error/detail coverage;
- v9→v10 active legacy task cancellation, cleared SHA/identity/authorization, and released reservation.

### Fixed Node release gate

`npm run test:release-gate`: PASS.

- lint/typecheck: PASS
- production build: PASS
- Windows file gate: 37/37 PASS
- migrations: 32/32 PASS
- release performance: 21/21 PASS
- Node native smoke: ABI 127 PASS
- complete Node suite: 46 files, 459/459 PASS

The takeover baseline was 46 files/441 tests. REWORK 1 is 46 files/459 tests, a net increase of 18 tests. The prior five-test reduction is no longer present: 500-item planning, multi-job serialization, terminal clear, task-panel selection/error/refresh, and duplicate-page missing/error/detail cases have explicit restored coverage in addition to the new destructive-safety cases.

Renderer runs still emit non-failing React `act(...)` warnings during asynchronous task-detail refresh. Assertions pass; this is a P2 test-hygiene issue, not a safety bypass.

## Staged rename and recovery audit

The deletion boundary now follows this order:

1. Rehash keep and target against persisted complete SHA-256 and strong identity/version evidence.
2. Persist a random same-directory isolation path while authorization is still current.
3. Atomically rename the target to that path.
4. Rehash the isolated object and compare size, stable identity, and complete SHA-256.
5. Rehash keep again.
6. Atomically claim the authorized item, then call permanent deletion only on the isolated path.

Every examined failure before the irreversible call invokes no delete. Recovery never overwrites an occupied original path. If automatic restoration cannot safely occur, the staged path remains persisted and visible; clear/retry is rejected until recovery is resolved. Startup interrupts authorization before recovery and forces re-verification after a successful restore.

No new P0 or P1 finding was reproduced in the local matrix.

## Isolated Electron ABI evidence

QA created a detached temporary worktree under the Windows temporary directory, copied the current `src` and `tests` trees, and installed an independent dependency tree. The main checkout's `node_modules` was never rebuilt for Electron.

In the temporary checkout:

- fixed Node/npm environment verification: PASS;
- production build: PASS;
- Electron native rebuild: PASS for Electron `33.4.11`;
- Electron native smoke: ABI `130` PASS;
- Electron main-process/app-ready smoke: PASS;
- full `test:electron-smoke`: PASS.

Afterward, the main checkout independently passed `Native smoke OK: target=node, ABI=127, Electron=none`. The detached temporary worktree and its disposable dependency tree were safely removed after verification; no user data or project source was removed.

## Real temporary large-file evidence

QA temporarily added and then removed a dedicated test that:

1. created an expendable, non-sparse 256 MiB file in the OS temporary directory;
2. completed one full project `buildFullContentHash` read;
3. started another real streaming SHA-256 read and aborted it during the measured read window;
4. asserted an `AbortError`;
5. confirmed the file remained exactly 256 MiB;
6. completed a final full SHA-256 and matched the original hash.

Result: 1/1 PASS in 927 ms. The test fixture was automatically deleted and the temporary QA test file was removed, leaving the official 46-file/459-test release-gate count unchanged.

Actual restoration is additionally exercised by the focused staged-deletion tests using real temporary files and the default same-directory `rename`; injected hash/delete failures verify that the original path and bytes remain accessible.

## NOT RUN / known risk

- Real mapped-drive or UNC SMB verification: NOT RUN; no mapped/network drive is present.
- Disconnecting a real SMB share during hash or staged rename: NOT RUN.
- Server-specific inode/file-ID stability and atomic same-directory rename semantics: NOT RUN.

These cases remain required release/manual evidence when suitable disposable SMB storage is available. They do not change the local QA result because all available P0 paths and injected offline/rename/recovery failures pass fail-closed.

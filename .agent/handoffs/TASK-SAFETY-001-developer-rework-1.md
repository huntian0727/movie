# Agent Handoff — REWORK 1

- Task ID: TASK-SAFETY-001
- From: Developer Agent
- To: Local Project Manager / independent QA
- Status: DEV_COMPLETE
- Branch: `ai/duplicate-sha256-safety`
- Base SHA: `2bc1359975fc6098dd8663043f00a36cb6203ab0`; all task changes remain uncommitted
- Requested Action: Re-run independent QA without changing the two QA P0 regressions. Use a separate Electron ABI checkout for desktop smoke.

## P0 corrections

1. Full SHA-256 and strong identity are persisted for keep and every target. Deletion rehashes both, persists an isolation path before rename, atomically isolates the target, rehashes the isolated stable identity/content, then rehashes keep before the guarded claim and permanent deletion. Same-size/same-mtime replacement and path swaps fail closed.
2. Scan-failure single/batch permanent cleanup receives `assertGenericPermanentDeleteAllowed` at IPC. The helper itself rejects indexed-file permanent deletion when no trusted guard capability is supplied, closing direct-call bypasses.

## Isolation and recovery contract

- Hash mismatch, read failure, cancellation, or delete failure restores the original path when it is free and clears the isolation record.
- Same-volume/SMB rename failure invokes no permanent delete and leaves the original intact.
- The isolation path is stored before rename. Startup interrupts authorization and restores recorded staged media before processing jobs.
- If the original path is occupied, recovery never overwrites it. Both files remain, the staged path is exposed in task evidence, and clear/retry is rejected.
- If neither recorded path exists, the item is marked for manual recovery and is not treated as successfully deleted.

## Regression evidence

- QA P0 reproductions retained unchanged and passing.
- Added keep/target same-metadata replacements, check-to-delete path swap, post-isolation keep mutation, isolated hash mismatch/read failure/cancel, delete-failure restore, rename failure, occupied-path evidence, and startup recovery tests.
- Added scan-failure batch guard coverage.
- Restored 500-item database-only submission, multi-job serialization, terminal clear, task-panel selection/error/refresh, and duplicate-page missing/error/detail cases.
- Focused fixed-Node run: 5 files, 92/92 PASS.
- Full Developer gate: `DEV_GATE_PASS`; Node 22.23.1/npm 10.9.8, typecheck/build/Node ABI smoke PASS, 46 files, 459/459 tests PASS.
- `git diff --check`: PASS.

## Remaining independent QA

- Real large-file cancellation and bandwidth behavior.
- Mapped/offline drive and real SMB rename/recovery behavior.
- Real Windows same-volume isolation, locked/occupied paths, and crash/restart recovery.
- Electron desktop smoke from an isolated Electron ABI checkout.

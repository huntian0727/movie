# Agent Handoff

- Task ID: TASK-SAFETY-001
- From: Developer Agent
- To: Local Project Manager
- Status: DEV_COMPLETE
- Branch: ai/duplicate-sha256-safety
- SHA: 2bc1359975fc6098dd8663043f00a36cb6203ab0 (implementation and records are uncommitted)
- Changed Files: `src/main/db/migrations/010-duplicate-sha256-safety.ts`, `src/main/db/migrations/index.ts`, `src/main/db/database.ts`, `src/main/db/duplicateCleanupRepository.ts`, `src/main/media/duplicateCleanupService.ts`, `src/main/media/duplicateResolveSafety.ts`, `src/main/ipc.ts`, `src/main/preload.cts`, `src/shared/videoTypes.ts`, duplicate cleanup renderer components/wiring, and focused main/renderer/IPC tests.
- Evidence: REWORK 1 final `scripts/agent/run-dev-gate.ps1` under Node 22.23.1/npm 10.9.8 returned `DEV_GATE_PASS`; environment check, typecheck, production build, Node ABI smoke, 46 test files, and 459/459 tests passed. Focused safety/migration/renderer restoration suites passed 92/92; `git diff --check` passed.
- Risks: Full hashes intentionally read every selected file and may take substantial time on NAS/mapped drives. Deletion is non-atomic once an authorized multi-file deletion phase begins; “stop remaining deletions” cannot undo an already-started successful delete. Real large-file cancellation, mapped/offline drive behavior, and Electron desktop smoke were not run locally. Electron smoke must use a separate Electron ABI checkout, not this Node ABI checkout. Renderer tests pass with non-failing React `act(...)` warnings from asynchronous task detail refreshes.
- Requested Action: Review the safety invariant and diff, then send to independent QA using `.agent/handoffs/TASK-SAFETY-001-qa-plan.md`. Treat any path that can delete a current duplicate candidate without fresh successful full SHA-256 evidence as a release blocker.
- Next Actor: Local Project Manager, then QA Agent.

## Safety invariant implemented

1. Candidate discovery and normal browsing remain database-only.
2. Submit creates a workflow-v2 verification task and captures path/size/mtime snapshots; it grants no deletion authority.
3. The service computes cancellable full SHA-256 for the keep file and every target in each group, with before/after version checks, then persists `verified-identical`, `content-different`, or `unverifiable`.
4. Only a fresh persisted identical result can be confirmed. Renderer requires exact case-sensitive, untrimmed `DELETE`; IPC validates the same literal and current revision.
5. Main process signs eligible rows with a new authorization revision. The guarded SQL claim requires matching job/item authorization, matching verification revision, 64-character hashes, and equal keep/delete hashes.
6. Keep and target are fully rehashed against persisted SHA-256 and strong identity at deletion. The target is then atomically isolated to a persisted same-directory random path, rehashed again by stable identity, and keep is rehashed once more before claim/delete. Startup restores unfinished isolation or retains discoverable recovery evidence without overwriting an occupied original path.
7. Cancellation during verification aborts reads and clears all evidence. Cancellation during deletion stops pending items only. Restart/resume/retry clear authorization and force a new verification revision and a new confirmation.
8. Legacy `duplicate:resolve`, its preload/API exposure, and duplicate-card single-file delete are removed/disabled. Generic and scan-failure single/batch permanent-delete paths reject current duplicate candidates; scan-failure helpers fail closed without a trusted guard.

## Previous-to-current regression mapping

- Request idempotency and reservations: retained in the metadata-only submit test.
- Old immediate background deletion: replaced by proof that verified files remain untouched until the separate confirmation.
- Changed keep/delete version checks: strengthened to mutation after full hashing and before deletion.
- Queued/in-flight cancellation: split into verification abort with zero deletes and deletion-phase stop-remaining behavior.
- Resume/retry: strengthened to require a new verification revision and second confirmation before any remaining/retried delete.
- Failed delete: retained with `EBUSY`, reverify, reconfirm, and successful retry evidence.
- Old direct resolve test: replaced by a hard-fail regression plus absence of the IPC contract.
- Duplicate page sorting, pagination, directory filtering, and missing-file checks remain covered; obsolete one-click and single-card permanent-delete tests are replaced by staged preflight, exact typed confirmation, tri-state result, focus, Escape, and no-bypass tests.

## QA focus

- Validate v9-to-v10 migration on a copy with an active legacy task: task must become `legacy_blocked`/cancelled, reservation released, and zero deletion possible.
- Exercise equal, same-size-different-content, unreadable/offline, cancellation, and post-verification mutation fixtures on Windows.
- Attempt confirm with wrong token/revision, direct IPC calls, generic single/batch/pending clear, resume, and retry.
- Verify focus trap/restoration, Escape, exact `DELETE`, and distinct “取消验证” versus “停止剩余删除” wording.
- Run real large-file and mapped/offline-drive cancellation tests, then run Electron smoke from an isolated Electron ABI checkout.

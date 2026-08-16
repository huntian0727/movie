# Agent Handoff

- Task ID: TASK-SAFETY-001
- From: QA Agent
- To: Local Project Manager
- Status: QA_PLAN_READY
- Branch: `ai/duplicate-sha256-safety`
- SHA: `2bc1359975fc6098dd8663043f00a36cb6203ab0` plus in-progress task changes
- Changed Files: `.agent/handoffs/TASK-SAFETY-001-qa-plan.md` only from QA
- Evidence: QA reviewed the binding Web Advisor decision, active task packet, UI design handoff, ADR-002, current IPC/preload entry points, duplicate cleanup service/repository/migration design, and the existing duplicate resolve, durable cleanup, content fingerprint, renderer, and migration test inventories.
- Risks: This is a pre-implementation QA plan, not an acceptance result. No PASS/FAIL verdict is assigned. Existing metadata-only deletion entry points are recorded only as paths that the completed implementation must close and the tests must challenge.
- Requested Action: Developer should map each implementation path to the matrix below and provide focused test evidence. Local Project Manager should route the completed diff back to independent QA for execution of every P0 case and the release gates.
- Next Actor: Developer Agent, then QA Agent

## 1. Non-negotiable QA oracle

A permanent duplicate deletion is authorized only when one continuous, non-bypassable chain proves all of the following:

1. Candidate discovery and ordinary browsing used metadata only and did not open or read media content.
2. A separately initiated read-only verification fully consumed every byte of the selected keep file and every candidate file in the group.
3. Complete SHA-256 values match for the whole group. Sampled fingerprints, size, duration, cached metadata, partial hashes, or a hash interrupted before EOF never qualify.
4. Verification evidence is bound to the exact group, keep/delete roles, video IDs, normalized paths, sizes, modification times, and complete hashes that were checked.
5. The user completed the separate second permanent-delete confirmation for exactly those verified items.
6. The main process performed an immediate final version check before each irreversible deletion and rejected stale evidence.

Every cancellation, offline transition, missing file, permission/read error, content mismatch, partial read, stale version, invalid/expired/replayed token, restart ambiguity, migration ambiguity, or unexpected service failure must result in zero deletion calls for the affected scope. Any path that can permanently delete a duplicate without a successfully completed full SHA-256 verification is a Windows release blocker.

## 2. Test instrumentation rules

All automated destructive-flow tests must inject both the file reader and permanent-delete dependency. Assertions must cover more than a returned status:

- `deleteFile`/`permanentlyDeleteFile` call count and arguments;
- every fixture file still exists and remains byte-for-byte unchanged when deletion is forbidden;
- no video row is removed and no cache/domain event claims removal;
- no reusable verification authorization is persisted or returned after a non-qualifying outcome;
- job/item/reservation state cannot later resume into deletion without a new successful verification;
- read streams are closed or destroyed on cancellation/error, and no further chunks are consumed after cancellation acknowledgement;
- a success authorization is issued only after EOF, post-read version validation, complete 64-character lowercase SHA-256 values, and whole-group equality.

Use deterministic chunked-reader barriers and injected failures for unit/integration tests. Keep real Windows local-media and mapped-drive exercises as a separate manual/Electron gate; do not make the main Node suite depend on a network share.

## 3. P0 automated matrix

| ID | Layer / entry | Setup and action | Required assertions |
| --- | --- | --- | --- |
| P0-01 | Candidate repository, IPC, preload, renderer | Open, page, sort, filter, refresh, change keep choice, and browse a 500-item/large candidate page. Inject spies that fail on `open`, `createReadStream`, full-hash, and delete calls. | Candidate browsing completes from database metadata; zero media opens/reads/hashes/deletes; copy says candidate/待验证 rather than identical/待删除. |
| P0-02 | Full verifier, identical group | Keep plus two byte-identical files, including content whose sampled fingerprints collide with a different fixture. Start explicit verification. | Every byte of all three files is read; all complete SHA-256 values are equal; eligibility appears only after EOF and post-read version check; no deletion occurs during verification. |
| P0-03 | Full verifier, mismatch | Same size/duration/mtime candidates with one byte changed outside sampled regions. | Result is whole-group `内容不同`; no item in that group is eligible; no token/authorization and zero delete calls. |
| P0-04 | Full verifier, unverifiable matrix | Inject keep/candidate `ENOENT`, `EACCES`, `EPERM`, `EBUSY`, `EIO`, stream error, timeout, not-a-file, offline parent, and disconnect after open. | Result is `无法验证` with a safe concrete reason; affected group has no authorization; zero delete calls and all remaining files/rows are preserved. Keep-file failure blocks the whole group. |
| P0-05 | Cancellation before and during hashing | Cancel before first open, during keep read, during each candidate read, between files, and after all bytes but before verification commit. Use a chunk barrier and observe the abort signal. | UI/service enters cancelling until acknowledgement; stream stops and closes; partial/full-but-uncommitted hashes are unusable; no authorization; zero delete calls; retry starts new full reads from byte zero. |
| P0-06 | Verification race: target changes | After successful hash, mutate a delete target before confirmation and between confirmation/final check. Test size, mtime, path/identity, and content changes. | Final check blocks that target, reports stale verification, performs no delete for it, and requires new full verification. No stale token reuse. |
| P0-07 | Verification race: keep changes | After successful group hash, mutate, replace, rename, remove, make unreadable, or move the keep file before deletion. | Whole group becomes ineligible; every candidate is preserved; zero group delete calls; new verification is required. |
| P0-08 | Adversarial same-size/same-mtime replacement | After verification, replace keep and target contents while restoring size and mtime; include same-path replacement and file-identity change. | The implementation must satisfy the task promise that any post-verification change blocks deletion. If its final-version model cannot detect this class, QA escalates it as a P0 contract gap rather than silently accepting size+mtime alone. |
| P0-09 | Second confirmation | Reach an identical result, then close/Escape/cancel; submit blank, whitespace, `delete`, `DELETE `, and finally exact `DELETE`. Attempt direct UI event dispatch while disabled. | Before exact `DELETE`, zero delete requests; exact text enables only the separately rendered danger action; cancel/close deletes nothing; confirmed request contains only currently eligible groups. |
| P0-10 | Direct legacy resolve IPC | Invoke `duplicate:resolve` directly with a valid metadata plan, a forged plan, and renderer-bypassing calls. | Handler cannot reach permanent deletion without fresh complete verification evidence plus the required second-confirmation authorization; schema rejection or safe non-destructive response; zero delete calls. |
| P0-11 | Background submit IPC/service | Invoke `duplicate-cleanup:submit` and service/repository methods directly with metadata-only plans, forged verification fields, or omitted authorization. | Submission cannot queue deletable work without server-trusted full-verification evidence and confirmation; no public service method accepts a plan alone as deletion authority. |
| P0-12 | Token/authorization binding | Replay a valid authorization for another job/group/video/path/keep choice, swap roles, add a target, omit a target, alter path case/normalization, change request ID, reuse after cancellation/failure/success, and tamper with persisted fields. | Every mismatch is rejected before deletion; authorization is single-use or otherwise replay-safe; no cross-group/job privilege; zero unauthorized delete calls. |
| P0-13 | Restart during verification | Stop after partial keep/candidate reads and restart service/app. Exercise constructor recovery and repository `interruptActiveJobs`. | Partial progress never becomes verified; no automatic delete; resume is labelled/implemented as reverify and rereads all required bytes. |
| P0-14 | Restart after verification / before confirmation | Persist or lose the verification result, restart, then attempt confirmation/resume. | Missing/stale evidence cannot authorize deletion. If evidence is deliberately durable, all exact bindings and freshness rules survive and are independently revalidated; otherwise a new full verification is mandatory. |
| P0-15 | Resume/retry bypass | Exercise `duplicate-cleanup:resume`, `duplicate-cleanup:retry`, repository `resume`/`retry`, task-center actions, app startup recovery, and repeated request IDs for interrupted/cancelled/failed items. | None retries deletion directly. Each affected item/group returns to full verification; previous partial, failed, cancelled, or stale evidence is invalidated; zero deletion until a new successful verification and confirmation. |
| P0-16 | Single-item entry | Invoke candidate-card trash callback, any retained `onDelete`, application delete adapter, and direct single-item IPC/service route. | Candidate UI exposes no direct permanent trash action, or routes it through the identical full verification plus second-confirmation chain; direct callback/IPC cannot delete. |
| P0-17 | Mixed multi-group verification | One identical group, one mismatch, one unreadable/offline group, and one keep-changed group in one run; vary ordering and failures before/after identical groups. | Results are isolated by group; only the fully identical group can enter confirmation; no token leakage; ineligible groups remain byte-for-byte intact. Global verifier failure/cancellation produces zero deletion for the run. |
| P0-18 | Mixed deletion final checks | Confirm multiple verified groups, then change one keep, change one target, and make one target offline immediately before its turn. | Only still-current, fully authorized items may delete; changed keep blocks its whole group; blocked/failed/skipped/deleted counts and events are exact; no success claim for blocked items. |
| P0-19 | Stop remaining deletion | Block the first injected delete call, request stop, release it, and include multiple remaining items. | The in-flight irreversible operation has honest semantics; already completed deletion is not rolled back or reported as cancelled; no not-yet-started item is deleted after stop acknowledgement. This behavior is distinct from verification cancellation, which always deletes zero. |
| P0-20 | v9 to new schema migration | Build a real v9 fixture containing queued/running/cancelling/interrupted/completed-with-errors cleanup jobs and reservations, plus video/user state; upgrade to the new schema. | Upgrade backs up and preserves user/media metadata, creates and validates all verification fields/tables/constraints, and never resumes legacy unverified work into deletion. Active legacy jobs are safely invalidated/interrupted/reverification-required and reservations are coherent. Migration performs zero media reads/deletes. |
| P0-21 | Migration failure/reopen/idempotence | Inject failure at new migration, validate rollback and backup, reopen successfully, open latest DB twice, and include committed WAL content and a 10,000-video v9 fixture. | Original v9 DB and WAL-backed data remain intact on failure; `user_version` changes atomically; retry and latest reopen are idempotent; no duplicate rows/indexes; no queued full-library hashing or deletion. |
| P0-22 | Permanent-delete call graph | Enumerate/import every duplicate-related call site reaching `permanentlyDeleteFile`, injected `deleteFile`, video-row removal, and removal events. Add architecture/contract tests for IPC, foreground resolve, background jobs, resume/retry, and single-item routes. | Each duplicate permanent-delete edge requires a server-created complete-verification authorization and final version check. Any reachable edge without full SHA-256 is a release blocker even if renderer buttons hide it. |

## 4. P1 renderer, state, and robustness matrix

| ID | Scenario | Required assertions |
| --- | --- | --- |
| P1-01 | Verification preflight | No full-read call occurs before `开始验证`; file count and byte volume are accurate; action is non-danger; return/Escape restores invoking focus. |
| P1-02 | Progress and cancellation honesty | Current file, file count, bytes/percentage where known, elapsed time, and read-only promise are visible; `正在取消验证` persists until the stream has actually stopped. |
| P1-03 | Result tri-state | `完全相同`, `内容不同`, and `无法验证` include text/icon/reason and do not rely on color; mismatch/unverifiable groups have no enabled delete action. |
| P1-04 | Focus/accessibility | All dialogs trap focus, background is inert, initial focus follows the UI handoff, Escape semantics are stage-correct, focus restores exactly, progress is accessibly named, and live announcements are throttled. |
| P1-05 | State transition abuse | Double-click start/confirm/cancel, rapid close/reopen, stale async completion after navigation, page refresh during validation, and two renderer windows issuing the same request. | At most one authoritative run/confirmation is accepted; stale callbacks cannot advance to deletion; idempotency does not weaken authorization. |
| P1-06 | Low-bandwidth promise | Verification is opt-in and reads groups serially or with documented bounded concurrency; cancellation remains responsive on slow storage; browsing still reads zero content. |
| P1-07 | Result accounting | Counts and reclaimable bytes distinguish candidate estimate, eligible verified bytes, successfully deleted bytes, blocked, failed, skipped, and stopped items. |
| P1-08 | Trusted IPC boundary | Main-window sender validation remains active; player/untrusted roles cannot call verify, confirm, resume, retry, or delete channels; malformed/oversized payloads fail safely. |
| P1-09 | Path safety | Symlink/junction/reparse-point changes, case variants, UNC paths, mapped drives, trailing-dot/space aliases, and movement outside managed roots cannot redirect an authorized delete. |
| P1-10 | Resource limits | Very large sparse/local file, 500-item page, empty/zero-byte files, multi-terabyte reported size, long paths, Unicode names, and low-memory conditions do not buffer entire media in memory or wrap progress counters. |

## 5. P2 compatibility and presentation matrix

| ID | Scenario | Required assertions |
| --- | --- | --- |
| P2-01 | Screenshot review | Capture candidate, preflight, progress, cancelling, all three results, typed confirmation, final-check block, and mixed result at 1280x720 and 900x700. |
| P2-02 | Copy regression | No pre-verification `待删除`, `重复文件`, or already-reclaimable claim; permanent deletion warnings and exact `DELETE` instruction match the approved UI contract. |
| P2-03 | Reduced motion/keyboard | Spinners respect reduced motion; every operation remains possible by keyboard without focus escape or hidden status. |
| P2-04 | Diagnostics/privacy | Logs include safe job/group/outcome identifiers and error codes without exposing unnecessary full paths or hash material; raw Electron errors are not shown to users. |

## 6. Existing coverage to retain and extend

The current suites provide useful regression scaffolding but are not acceptance evidence for the new safety contract until rerun against the completed implementation:

- `tests/main/duplicateResolveSafety.test.ts`: metadata preflight, changed/missing/unreadable files, stale-plan refresh, bounded version reads, and final size/mtime checks.
- `tests/main/duplicateCleanupJobs.test.ts`: transactional reservation/idempotency, queued/in-flight cancellation, keep/target changes, serial jobs, resume/retry, and 500-item database-only planning.
- `tests/main/contentFingerprint.test.ts`: sampled-fingerprint collision demonstration, streaming full hash, and file-version mismatch.
- `tests/renderer/DuplicateGroupsPage.test.tsx`: current-page confirmation/preflight, stale refresh, sorting, missing check, and the legacy single-item delete behavior that must be removed or rerouted.
- `tests/renderer/DuplicateCleanupTasksPanel.test.tsx`: cancel/resume/retry/clear controls that must acquire the new reverify semantics.
- `tests/main/databaseMigrations.test.ts`: backup, rollback, WAL, 10,000-row performance, idempotence, and schema validation patterns for the required v9 upgrade coverage.

New tests should avoid weakening old metadata candidate tests: `buildContentFingerprint` remains a sampled discovery aid and must never be renamed or asserted as deletion-grade SHA-256 proof.

## 7. Real Windows / Electron gate

Run only after focused and full automated gates pass, using expendable fixtures and a separately isolated checkout/runtime where required:

1. Local identical large media: observe complete read volume, verify, exact `DELETE`, final check, and expected deletion only.
2. Same-size sampled-fingerprint collision: full SHA mismatch, zero deletion.
3. Large-file cancellation during keep and candidate reads: wait for cancellation acknowledgement, zero deletion, retry rereads from the beginning.
4. Mapped-drive/UNC slow verification: browse with zero content reads, then verify with honest progress and bounded load.
5. Drive disconnect/offline transition and reconnect: unverifiable, zero deletion, explicit reverify required.
6. ACL/read-error fixture: concrete error, no token, zero deletion.
7. Mutate keep and target after hashing and immediately before delete: deletion blocked and files preserved.
8. Restart during hashing, after verification, and before/while deletion: no automatic unverified deletion; resume/retry semantics match the state contract.
9. Mixed eligible/ineligible groups and stop-remaining-deletion behavior.
10. Keyboard/focus/accessibility and the required screenshot set at both target window sizes.

Record media sizes, expected/actual bytes read, exact app/build SHA, Node/Electron environment, drive type, timestamps, final file existence/hashes, job/item database state, and screenshots. Never use non-expendable user media for destructive validation.

## 8. Acceptance execution order

1. Review completed diff and enumerate all permanent-delete call sites and IPC/preload/service entry points.
2. Run focused verifier, duplicate cleanup, renderer, IPC/security, and v9 migration suites in the fixed Node 22.23.1/npm 10.9.8 environment.
3. Run `git diff --check`, lint/build, Windows file-safety tests, migration tests, release-performance tests, and the complete `npm run test:release-gate`.
4. Run isolated Electron smoke and the real Windows/local-media/mapped-drive matrix.
5. Compare renderer screenshots and keyboard behavior against the UI design handoff.
6. Assign a verdict only after all P0 evidence is available. Any P0 bypass or deletion without a complete SHA-256 authorization yields `FAIL` and blocks release; unavailable mapped-drive evidence may be reported as a known environmental risk only if all automated P0 gates and local real-media safety tests pass and no bypass is known.

## 9. Evidence required in Developer handoff

- Source-to-test mapping for every entry named in P0-10 through P0-22.
- Focused command lines and complete pass counts, not screenshots alone.
- Proof that candidate browse paths never call full readers.
- Proof of zero delete calls and preserved fixture hashes for every non-identical, cancelled, offline, unreadable, stale, forged, replayed, restarted, resumed, retried, and migrated-legacy case.
- Schema migration fixture description and legacy-job disposition.
- Manual test fixture provenance confirming expendable media.
- Explicit disclosure of any unexecuted real-device/network-drive case.

No QA verdict is issued by this planning handoff.

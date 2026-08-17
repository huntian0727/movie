# TASK-DUPDIR-001 QA handoff

- Date: 2026-08-18
- Verdict: PASS
- Status: QA_PASS

## Acceptance evidence

- Candidate-row shortcut passes the exact containing directory to the page filter and does not call cleanup submission.
- Active selection resets pagination to page 1 and is removable through a directly visible clear action.
- Preferred-directory query always includes descendants and does not match sibling path prefixes.
- Every returned candidate group still contains its complete cross-directory membership.
- An explicit per-group keep choice remains authoritative when a directory reload changes the server recommendation.
- The removed `preferredDirectoryScope` field is absent from renderer, shared contract, IPC validation, repository, and tests; exact-only mode is no longer reachable.
- Existing duplicate SHA-256 authorization, scan-failure guard, migration, and recovery regressions pass in the full gate.

## Runs

- Focused contract/renderer/repository/safety suite: 6 files, 119/119 PASS.
- Full fixed-environment Developer Gate: 47 files, 472/472 PASS; build and Node ABI 127 smoke PASS.
- Final renderer delta rerun: 2 files, 64/64 PASS.
- `git diff --check`: PASS.

## Risk assessment

- No new permanent-delete path or file-read path was introduced.
- Real mapped/offline SMB evidence remains a broader release risk inherited from the project; this metadata-only shortcut does not add network I/O.

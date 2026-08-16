# Web Advisor Handoff

Task: TASK-SAFETY-001 — Reconcile duplicate-deletion safety contract
Reason for Review: Permanent deletion safety and low-bandwidth network-drive performance require a product/architecture decision beyond local implementation authority.
Current Status: WEB_REVIEW_PENDING; no hashing or deletion behavior change has started.
Current GitHub SHA: 7506da518e5a404d542072ff4d26cc717321c2d9
PR / Branch: main
What Changed: No relevant product code changed during takeover; the audit discovered a contract conflict in the pushed baseline.
Key Product Decision: Decide what guarantee the product makes before permanent duplicate deletion.
Key Architecture Decision: Decide whether verification remains metadata-only, performs full hashing after confirmation, or uses a staged/opt-in model.
Changed Files: No code changes for this decision; review the existing files listed below at the recorded SHA.
Important Documents: `docs/decisions/ADR-002-low-bandwidth-duplicates.md`, `README.md`, `docs/ai/KNOWN_RISKS.md`, `docs/windows-release-checklist.md`, `src/main/db/README.md`.
QA Result: PASS_WITH_KNOWN_RISKS for takeover baseline; formal release remains blocked.
Local Validation: Confirmed current duplicate grouping uses cached size+duration and current pre-delete checks use existence+size+mtime; release checklist line 46 requires full SHA-256.
Open Risks: Metadata-only verification can present false candidates; full hashing can read entire large NAS/SMB files and may be slow or fail mid-operation; deletion is permanent.
Questions for Web Advisor: Choose between the current low-bandwidth contract, confirmation-time full hashing, or a staged/opt-in model; define the UX promise, blocking failures, cancellation semantics, and minimum release evidence.
Recommended Local Next Step: Pause all decision-dependent hashing/deletion changes; continue the independent CI repair and non-destructive validation work.

## Recommended review scope

1. `docs/decisions/ADR-002-low-bandwidth-duplicates.md`
2. `README.md` duplicate-item behavior
3. `docs/windows-release-checklist.md` line 46
4. `src/main/db/README.md` duplicate cleanup flow
5. Duplicate cleanup and file-operation tests under `tests/main/`

## Copyable question

The current pushed 映匣 baseline intentionally treats duplicates as candidates using cached exact size + duration, performs no content hashing when opening the page, and checks existence + size + mtime before permanent deletion. This protects low-bandwidth mapped drives but cannot prove byte identity. However `docs/windows-release-checklist.md` still requires a full SHA-256 check before duplicate deletion.

Please decide which product safety contract should govern permanent duplicate cleanup:

1. keep the current low-bandwidth contract and correct the release checklist/UX guarantee;
2. require full hashes only after explicit final confirmation, accepting network-read cost;
3. use a staged or opt-in verification model.

Please evaluate irreversible-deletion risk, network/NAS cost, user expectations, failure/cancellation behavior, implementation complexity, and what must block a formal release. Also specify the exact UX promise and minimum QA evidence.

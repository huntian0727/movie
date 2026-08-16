# TASK-SAFETY-001 — Reconcile duplicate-deletion safety contract

- Task ID: TASK-SAFETY-001
- Title: Decide and align the duplicate-deletion verification contract
- Priority: P0
- Owner: Local Project Manager (planning); User/Web Advisor (decision)
- Background: `docs/windows-release-checklist.md` requires full SHA-256 before duplicate deletion, while ADR-002, README, known risks, and current implementation intentionally avoid content hashing and use size+duration candidates plus size+mtime pre-delete checks.
- User Goal: Know exactly what safety guarantee the product provides before any release or destructive-operation change.
- Product Goal: Balance irreversible deletion safety against low-bandwidth network-drive performance without contradictory promises.
- Scope: Independent product/architecture review; choose the safety contract; then align ADR, UX wording, implementation, tests, and release checklist in a later approved task.
- Out of Scope: Immediate hashing rollout, immediate weakening of release criteria, or any deletion of user files.
- Technical Constraints: Source media is the truth; deletion is permanent; page browsing must not unexpectedly read whole network files; current candidate grouping does not prove identical content.
- Acceptance: User-approved decision with explicit guarantee, bandwidth cost, failure semantics, UX confirmation, implementation impact, and migration/release evidence plan.
- Automated Tests: NOT APPLICABLE before decision.
- Local Validation: Review ADR-002, README duplicate semantics, release checklist row, duplicate cleanup code/tests, and real network-drive constraints.
- QA Required: YES after implementation
- UI Required: YES if confirmation or warning UX changes
- Web Advisor Review Required: YES
- Web Advisor Review Stage: BEFORE_ARCHITECTURE_DECISION
- Git Requirements: Base all review claims on pushed GitHub SHA and list the exact review files.
- Status: WEB_REVIEW_PENDING
- Next Actor: User sends the prepared question to Web Advisor.

## Recommended question for Web Advisor

The current pushed 映匣 baseline intentionally treats duplicates as candidates using cached exact size + duration, performs no content hashing when opening the page, and checks existence + size + mtime before permanent deletion. This protects low-bandwidth mapped drives but cannot prove byte identity. However `docs/windows-release-checklist.md` still requires a full SHA-256 check before duplicate deletion.

Please decide which product safety contract should govern permanent duplicate cleanup:

1. keep the current low-bandwidth contract and correct the release checklist/UX guarantee;
2. require full hashes only after explicit final confirmation, accepting network-read cost;
3. use a staged or opt-in verification model.

Please evaluate irreversible-deletion risk, network/NAS cost, user expectations, failure/cancellation behavior, implementation complexity, and what must block a formal release. Also specify the exact UX promise and minimum QA evidence.

# TASK-SAFETY-001 Web Advisor Decision Handoff

- From: User / Web Advisor
- To: Local Project Manager
- Date: 2026-08-16
- Status: WEB_REVIEWED
- Decision: Option 3 — staged content verification with non-bypassable full SHA-256 before permanent duplicate deletion.

## Binding directive

1. Cached file size, duration, and other metadata continue to provide fast duplicate candidates. Normal duplicate-page browsing must not read complete files.
2. A permanent-cleanup request first enters an independent, read-only SHA-256 verification stage covering the candidate and keep files.
3. Results must distinguish verified-identical, content-different, and unverifiable.
4. Verification is cancellable. Cancellation, failure, offline state, or read error must delete nothing.
5. Only verified-identical files may enter a second permanent-delete confirmation.
6. Immediately before deletion, recheck file version information. Any post-verification change blocks deletion.
7. Fast/low-bandwidth mode may support candidate discovery or recoverable actions, never a permanent-delete verification bypass.
8. Any permanent duplicate-delete path that can execute without successful complete SHA-256 verification is a Windows release blocker.

## PM routing

- First: UI/UX Designer defines the minimal two-stage states, wording, focus, cancellation, and confirmation behavior.
- Second: Developer implements the design and safety invariant with automated tests.
- Third: QA independently attempts bypass, cancellation, failure, offline, mutation, restart, and direct IPC/service paths.
- Fourth: UI/UX Designer verifies the implementation before Local PM acceptance.

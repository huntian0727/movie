# Current Task

- Task ID: `TASK-DUPDIR-001`
- Title: One-click recursive preferred directory for duplicate candidates
- Status: `LOCAL_ACCEPTED`
- Owner: Local Project Manager
- Branch: `ai/duplicate-preferred-directory-shortcut`
- Base SHA: `dbb843167f7e52d41d255b3bde0f7a2ffacf1ac3`
- Reviewed Baseline SHA: `7506da518e5a404d542072ff4d26cc717321c2d9`
- Next Actor: Local Project Manager performs Git delivery and remote Windows CI verification.
- Blocking: Git delivery and remote CI remain.
- Binding Decision: Metadata-only candidate discovery; cancellable read-only full SHA-256 verification; only verified-identical items may reach a second permanent-delete confirmation; final version recheck is mandatory; permanent deletion without successful verification is a release blocker.
- Feature Decision: A preferred directory always includes all descendant directories; the row-level shortcut changes only metadata-backed filtering and plan recommendations.

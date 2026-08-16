# Current Task

- Task ID: `TASK-SAFETY-001`
- Title: Reconcile duplicate-deletion safety contract
- Status: `LOCAL_ACCEPTED`
- Owner: Local Project Manager
- Branch: `ai/duplicate-sha256-safety`
- Current Main SHA: `2bc1359975fc6098dd8663043f00a36cb6203ab0`
- Reviewed Baseline SHA: `7506da518e5a404d542072ff4d26cc717321c2d9`
- Next Actor: Local Project Manager performs normal Git delivery and remote Windows CI verification.
- Blocking: Git delivery and remote CI remain; real mapped/offline SMB evidence remains a known risk.
- Binding Decision: Metadata-only candidate discovery; cancellable read-only full SHA-256 verification; only verified-identical items may reach a second permanent-delete confirmation; final version recheck is mandatory; permanent deletion without successful verification is a release blocker.

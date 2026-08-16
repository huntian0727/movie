# Project State

- Current Main SHA: `2bc1359975fc6098dd8663043f00a36cb6203ab0`
- Current Schema: `10`
- Current Milestone: Staged duplicate-content verification
- Active Task: `TASK-SAFETY-001`
- Current Stage: `LOCAL_ACCEPTED`
- Current Owner: Local Project Manager
- Open P0: None reproduced after TASK-SAFETY-001 REWORK 1; both prior permanent-deletion bypass regressions now pass.
- Open P1: Real SMB/offline codec-probe behavior, real legacy-database recovery, multi-window stress, physical file-operation faults, and broad media compatibility remain incompletely evidenced.
- Blocking: Git delivery and remote Windows CI remain; real mapped/offline SMB behavior remains a known-risk evidence gap.
- Next Actor: Local Project Manager performs normal Git delivery and remote CI verification.
- Recent Decisions: Desktop-only product; source media is truth; low-bandwidth duplicate candidates; permanent duplicate deletion requires non-bypassable full SHA-256 verification; safe main backup delivery; codec-aware conservative playback routing; Local PM operating model verified.
- Next Recommended Work: Complete normal Git delivery, then use remote Windows CI and later real mapped/offline SMB access to extend release evidence.
- Needs Web Advisor Review: NO (completed for the architecture decision)
- Web Advisor Review Reason: User returned the option 3 directive; implementation must preserve its non-bypassable SHA-256 guarantee.

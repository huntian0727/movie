# Project State

- Verified Implementation SHA: `853c0fb3d6b84a90448d25293ed502768f3338ca`
- Current Schema: `10`
- Current Milestone: Duplicate cleanup workflow usability
- Active Task: `TASK-DUPDIR-001`
- Current Stage: `LOCAL_ACCEPTED`
- Current Owner: Local Project Manager
- Open P0: None reproduced after TASK-SAFETY-001 REWORK 1; both prior permanent-deletion bypass regressions now pass.
- Open P1: Real SMB/offline codec-probe behavior, real legacy-database recovery, multi-window stress, physical file-operation faults, and broad media compatibility remain incompletely evidenced.
- Blocking: Git delivery and remote Windows CI remain; formal Windows release still lacks real mapped/offline SMB evidence and other checklist evidence outside this task.
- Next Actor: Local Project Manager performs Git delivery and remote CI verification.
- Recent Decisions: Desktop-only product; source media is truth; low-bandwidth duplicate candidates; permanent duplicate deletion requires non-bypassable full SHA-256 verification; safe main backup delivery; codec-aware conservative playback routing; Local PM operating model verified.
- Next Recommended Work: Complete `TASK-DUPDIR-001`, then retain real SMB/mapped-drive validation as a formal-release follow-up.
- Needs Web Advisor Review: NO (completed for the architecture decision)
- Web Advisor Review Reason: User returned the option 3 directive; implementation must preserve its non-bypassable SHA-256 guarantee.

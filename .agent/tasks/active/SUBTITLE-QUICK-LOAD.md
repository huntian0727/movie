# SUBTITLE-QUICK-LOAD

- Workflow: FULL; Owner: movie-developer; Status: IN_PROGRESS.
- Authorization: user approved quick search, compact loading panel, result cache and immediate timing controls; real-film acceptance remains USER_OWNED.
- Base: 160daf7de3ddd3ab8fa34b7a78aea83c42c6aa37; branch ai/subtitle-quick-load.
- Backup: 2026-10-05_15-06-45-615_subtitle-quick-load; checkpoint-20261005-230641-160daf7-subtitle-quick-load; SQLite quick_check ok, 345479 records.
- Scope: explicit click starts search; top three candidates in a reserved side panel; advanced existing controls; remembered language/source/query; bounded short-lived search cache; saved download reuse; immediate +/- 0.5 second, switch and off controls.
- Constraints: no network on video open; no auto-pick of unfamiliar subtitle; native video remains visible in quick mode; preserve file identity/session guards, provider security, saved state and external export.
- Out of scope: same-directory subtitle discovery, streaming provider aggregation, batch downloading, AI subtitle generation.
- Verification: focused renderer/main regressions, full release gate, isolated Electron/package smoke, fresh desktop package and original shortcut entry verification. Real-film synchronization and usability acceptance: USER_TEST_PENDING.

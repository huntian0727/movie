# SUBTITLE-FREE-SOURCES-V1

- Workflow: FULL
- Owner: movie-developer; local PM routing in this chat.
- Status: USER_TEST_PENDING
- Risk: unauthenticated network/HTML inputs, persistent subtitle provider contract and desktop package.
- Authorization: user requests implementation based on 115Master analysis and explicitly takes ownership of real-film testing.
- QA/UI acceptance: USER_OWNED, PENDING; no independent agent acceptance requested. Developer runs necessary deterministic contract/technical gates and startup checks, not final subtitle quality acceptance.
- Base: 259049a0845ff34a83396333b9e631508f2367fc; branch ai/subtitle-free-sources-v1.
- Backup: 2026-10-05_14-07-55-576_subtitle-free-sources-v1; checkpoint-20261005-220751-259049a-subtitle-free-sources-v1; Verify PASS, SQLite quick_check ok, schema 14, 345479 records.
- Scope: no-key Thunder source by default; optional Subtitle Cat explicitly selected; source list/attribution/setup guidance; on-demand candidate download integrated with existing saved subtitles and playback.
- Constraints: no account changes, no AI generation/translation, no 115 login integration or CloudDrive changes; no eager downloading all candidates; no language guarantees from unknown metadata; fixed provider URLs/HTTPS redirect checks, finite response sizes and concurrency; keep real verification separate from mocks and user acceptance.
- Acceptance: Thunder works without credentials; optional Cat works with ordinary film names as well as identifiers; source failure differs from no matches; files/version/session guards and existing source configuration preserved.
- Implementation Commit: fc9ad08ec925f8755b142a00161ad4faf4582259; Developer DEV_COMPLETE, user acceptance pending.
- Technical gates: focused 47 PASS; release gate 112 suites / 972 PASS; isolated Electron build/main/native smoke PASS. Final package/artifact/packaged smoke, original shortcut/Commit/app.asar and entry availability are Local PM delivery checks recorded in .tmp/free-subtitle-desktop-proof.json.
- Next: Developer handoff DEV_COMPLETE then USER_TEST_PENDING.

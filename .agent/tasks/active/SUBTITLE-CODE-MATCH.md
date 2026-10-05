# SUBTITLE-CODE-MATCH

- Workflow: FULL; Owner: movie-developer; Status: USER_TEST_PENDING.
- Authorization: user reports a wrong subtitle match and explicitly identifies the correct keyword SSIS-570. Real-film acceptance remains USER_OWNED.
- Base: b2ce600fa4fcba46af5a56fad7cdb7bfff4bb8fb; branch ai/subtitle-code-match.
- Backup: 2026-10-05_15-36-44-776_subtitle-code-match; checkpoint-20261005-233641-b2ce600-subtitle-code-match; SQLite quick_check ok, 345479 records.
- Scope: shared conservative release-code extraction; renderer/main/provider use the same keyword; Thunder must not substitute full filenames for code queries; all service sources require exact code metadata; visible actual keyword and distinct no-exact-match message.
- Constraints: no automatic downloads or selection, no content generation; ordinary movie/year/episode search preserved; manual query override preserved; no file, player architecture or credential changes.
- Verification: extraction cases and boundaries, Thunder actual name parameter, service wrong/unknown code rejection, renderer automatic keyword and manual field; full release gate, Electron/package and original-shortcut entry checks. User owns film timing acceptance.
- Implementation: 11aa7bb8fe46af95d32db386db8450f1f7b725b0; Developer DEV_COMPLETE. Focused 49 PASS, stable final-source release gate 114 suites / 991 PASS, isolated Electron build/main/native PASS. SSIS-570-only live anonymous Thunder query: 20 returned / 18 code-matching; no download. Final desktop proof .tmp/code-match-desktop-proof.json.

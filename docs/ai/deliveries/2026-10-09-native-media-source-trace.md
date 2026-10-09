---
date: 2026-10-09
branch: ai/public-release-audit
type: test
status: partial
---

# Native media upstream recipe and license trace on home B5

## Context

Resumed **home computer MP2T8QB5 only** after a temporary terminal safety blocker. User explicitly prohibited any further use of office computer D200707 for this private project. Reconfirmed local home source clean at `db8d61908008a1e9d940ce9cef7039d06e346d6d`, same remote PR #24 Draft, main `807c49585d18c901b199fe0d3d8b0dbf31eb4114`.

Required before-edit checkpoint PASS: `checkpoint-20261009-141142-db8d619-release-licensing-source-closure-20261009` pushed, snapshot `2026-10-09_06-11-47-623_release-licensing-source-closure-20261009`; database 0.87 GB, 345892 videos, SQLite `quick_check=ok`. User videos and original production installation untouched.

## Changes

- Added `scripts/audit-native-media-recipes.mjs`: read-only verification of **pinned** BtbN build source TAR digest; parses the explicitly listed FFmpeg native recipe files for exact Git commit/SVN revision, upstream source repository, simple direct dependencies, patch references and their SHA-256. No arbitrary upstream Bash execution. Every source and distribution approval stays `false`.
- Generated `docs/legal/native-media-recipe-evidence.json`: 43 enabled libraries; 44 recipe candidates; 43 Git SHA pinned and one SVN revision 6835; 42 distinct source repositories; simple dependency hints in 16 recipes representing 18 dependency names; four patched files in two recipes. Direct `echo` discovery cannot prove complete transitive build closure.
- Added `tests/scripts/nativeMediaRecipeAudit.node-test.mjs`: 7 tests covering pinned reference parsing, false approval, archive-hash rejection and path traversal. Appended the tests to `test:media-candidate-contract` without dropping prior 5 tests or weakening existing release gate.
- Independently fetched exact `COPYING` texts from GitHub commit-pinned **opus** and **libass** on B5 and hashed them. Stored solely in `D:/CodexReleaseAudit/media-candidate-20261008/source-evidence/exact-component-sources`. The first attempt to download full source tarballs on B5 did not finish (NOT_VERIFIED), so no full source archive or corresponding-binary approval is claimed.
- Updated legal/source review docs, risk report, changed-files list. No FFmpeg EXE replacement, code-signing, product UI or installer modification.

## Verification

- Initial source archive input SHA verified to `27dca8db7b2466b6f5145168721264de91dc9b56f50bebc441249f92e4acf548`. Recipe manifest tool PASS; 43 library entries all resolved, statuses unapproved.
- On B5, Opus COPYING SHA-256 `01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551`; libass COPYING SHA-256 `f7e30699d02798351e7f839e3d3bfeb29ce65e44efa7735c225464c4fd7dfe9c`. Legal status remains P1 source review.
- `npm run test:media-candidate-contract`: PASS (12 tests, no skips) in Node22.23.1.
- `npm run test:release-gate`: **PASS (exit 0)** on B5, 132 Vitest files / 1182 tests without skips, plus 12/12 native-media candidate/recipe Node tests; lint/typecheck/build, original Windows files, migrations, 320k-item performance gates and Node ABI checks preserved. Vitest stage 179.29 seconds; complete gate runtime 238.16 seconds. Raw log kept in ignored `.tmp/native-media-source-trace-gate.log`.
- `test:electron-smoke`: **PASS / exit 0**, Electron44.7.0 ABI149, main/preload/DPAPI smoke. `test:renderer-security-smoke`: **PASS / exit 0**, protocol/security smoke. Logs: `.tmp/native-media-source-electron-smoke.log`, `.tmp/native-media-source-renderer-security.log`.
- `dist:win`, `verify:artifact`, `release:metadata`, `test:packaged-smoke`, `test:installer-smoke`: **NOT_RUN this iteration**, because this change only adds a source-audit script, Node-only tests and legal documentation; no Electron runtime, native EXE or installer input changed. Historical `db8d619` build and SHA stay the only tested unsigned installer, no new desktop delivery claimed.
- Clean stable Windows 11 machine without Node/tools, actual prior signed upgrade, formal code signing and external component full corresponding-source/copyright review: NOT_RUN.

## Risks and follow-up

- Identifying a pinned recipe and exact Git/SVN commit is not proof of binary/source correspondence or that license conditions are satisfied; 43 enabled external libraries can have many transitive dependencies. Static LGPLv3 relinking obligations and all third-party notices remain to be analyzed before public binary distribution.
- Candidate daily build's long-term retention, author ownership and application license choice, second GitHub release reviewer, public-release environment and signed Clean Win11 test remain open. No owner approval status was changed.
- `main`, formal tags and public Releases remain unchanged; PR #24 Draft. Current conclusion **engineering PASS_WITH_RISKS; public release FAIL**.

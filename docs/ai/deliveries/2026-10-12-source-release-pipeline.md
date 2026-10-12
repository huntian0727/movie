# Source runtime release preparation

## Context

The source-built player and shared FFmpeg tools already passed local playback and packaged-media checks. The user authorized continuing GitHub release preparation and wants subsequent application updates to reuse reviewed native inputs. Public release still requires the final explicit owner decision after stable Windows QA.

Pre-change snapshot: `2026-10-11_16-39-14-561_source-release-pipeline`; checkpoint: `checkpoint-20261012-003909-e1ef20a-source-release-pipeline`. Backup retention maintenance succeeded before editing. Branch: `ai/source-release-pipeline`.

## Changes

- Added private `unsigned-community-qa` ZIP identity. It has a QA filename and visible unpublished window title, while using the final community AppData profile. The legacy desktop/test profiles stay separate. This class cannot produce an NSIS installer.
- Added separate `build/native-source-approval.json`: exactly 39 distributed PE paths (14 media tools/dependencies, 24 player DLLs, NativeHost). Every approval remains false. Formal source packaging requires the main owner/license/Windows approval AND this exact source approval, retained source ZIP, both pinned locks, per-file hashes and reviewed evidence. Mixed source/legacy formal variants remain blocked. The existing Lite/signed flow keeps its gates.
- Added retained-input acquisition with exact ZIP lengths/SHA-256, private draft identity checks, bounded download, checked local paths and refusal to overwrite modified cached inputs. GitHub authorization is removed before following the signed asset-storage redirect.
- Prepared GitHub draft input storage on the already existing checkpoint tag, without creating a version tag or publishing a product release. Anonymous API and draft-page access returned HTTP 404 before uploading native inputs. Private input draft ID: `409795833`; producer run remains `38134981406`, with its original FAIL/closure-false evidence unchanged.
- Added manual input-transport probe and manual source-community ZIP workflow. They upload verification JSON/checksums and optionally RSA/AES encrypted delivery only; no plaintext program ZIP or private key is uploaded to public Actions artifacts. The final formal class still needs the exact version tag and all owner approval variables/records.
- Fixed release metadata to independently bind source lock hashes and workspace cleanliness; added portable metadata requiring prior matching extraction/packaged-smoke evidence.

## Verification

- Locked Node 22.23.1/npm 10.9.8: lint, typecheck, build, Electron smoke PASS.
- Full Vitest run: 136 files / 1235 tests PASS. Subsequent source-pipeline/workflow targeted run: 27 tests PASS; workflow tests were added after the full test enumeration. Five release/runtime/identity files: 78 targeted tests PASS earlier.
- Actual Electron SQLite/DPAPI smoke PASS: four build classes, three profiles, moved-folder reopen, QA-to-community persistence and no cross-profile overwrite.
- Media candidate contract: 65 PASS; native source-build Python tests: 12 PASS. Linux cold compilation / bit-identical rebuild were NOT RUN. No E2E script is declared (not applicable).
- `git diff --check` PASS (ordinary autocrlf notices only).
- Exact-commit CI prerequisite: 36 source/CI/workflow targeted tests PASS, including wrong SHA/repository/branch, pending/missing CI, all failed/skipped/cancelled outcomes and refusing an older pass when the latest run failed. Actual local API verification PASS against both completed main checks for `81a4ad4`.
- Fresh `dist:zip`, `verify:zip`, and `release:metadata -- --portable` PASS from clean code checkpoint `c67a5c3`. The private ZIP is `release/unsigned-community-qa/拉面影视-0.1.15-x64-community-qa-Portable.zip`; app ASAR SHA-256 `cb4dceb5693700f001e6a1bd7edaee0703f91f27594ab94e3cd98b10b627ef80`. Windows app/NativeHost are explicitly NotSigned; public approval is false. Extracted files match unpacked inputs and actual packaged database/scan/renderer/thumbnail/cache/reopen smoke passed.
- Both private input ZIP uploads completed: GitHub-reported lengths and SHA-256 digests match the pinned originals. The first real read-only workflow probe (`38232265620`) failed HTTP 403 reading the private draft. The two manual input-consuming jobs now request Contents write because draft visibility requires that access; the download script performs GETs only, and the token is passed as an environment variable only to that download step. No release/tag-writing command or plaintext program artifact upload was added. Second real probe `38232571146`: PASS, downloaded and verified both exact archives on a fresh runner. Its downloaded JSON matches both pins. Post-upload anonymous API and both download URLs still return 404. Local cached-input/API identity verification also PASS.
- Main Windows CI `38232549884` and security audit `38232549882` PASS for `0db50e0`; main Windows CI `38234184402` and security `38234184389` also PASS for `81a4ad4`. The first duplicate full source ZIP gate `38232742502` hit the unchanged 60s 320k fixture timeout; the follow-up `38234323520` with main CI's scratch settings hit an unrelated unchanged 15s incremental-scanner timeout. Both exact commits passed their complete primary Windows CI. Replaced duplicate full-suite execution in packaging with a strict current-commit prerequisite: the latest push-to-main run in this repository must succeed for BOTH Windows CI and security audit. A failure/cancellation/pending result cannot fall back to an older pass or another SHA/repository/branch. Packaging still independently builds and runs actual Electron/renderer-security/ZIP packaged smoke. No test timeout, query budget, retry or exclusion is changed. Full cloud ZIP delivery remains pending an actual successful run of this final workflow.

## Risks and follow-up

All real approval records remain false; no version tag or public product release was created. This changes engineering gates, not legal approval. The original producer CI failure is retained, with the earlier local import-closure verification documented separately. GitHub workflow-token access to private drafts must be tested before calling cloud input reuse complete.

Stable isolated Windows 11 community-profile acceptance and the final human public-release decision remain required. The daily desktop shortcut has not been replaced: **桌面版本尚未交付**. A private QA ZIP does not replace that desktop delivery.

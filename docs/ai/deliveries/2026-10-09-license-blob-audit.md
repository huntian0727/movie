---
date: 2026-10-09
branch: ai/public-release-audit
type: test
status: partial
---

# Pinned third-party GitHub license blob audit (home B5)

## Context

Resumed existing `ai/public-release-audit` at `d3a81c6826f503173ad51769e32db86404475eb9` with clean worktree. Draft PR #24 and `main=807c49585d18c901b199fe0d3d8b0dbf31eb4114` unchanged. Entire task executed only on home computer MP2T8QB5, never office D200707. Mandatory pre-edit backup passed: `2026-10-09_06-32-18-429_ffmpeg-upstream-source-availability-20261009`, checkpoint `checkpoint-20261009-143215-d3a81c6-ffmpeg-upstream-source-availability-20261009` pushed. SQLite quick_check OK, 345892 videos in 0.87-GB indexed database; real files/production install untouched.

## Changes

1. Added `scripts/audit-native-media-licenses.mjs`: consumes only the existing fixed-commit recipe manifest. Queries exact GitHub Git tree at each immutable commit; accepts only root-level LICENSE/COPYING/COPYRIGHT/NOTICE/AUTHORS-like Git blob names. Every downloaded text blob is validated against its *actual Git blob object SHA-1*, independently hashed SHA-256 and archived to private `D:/CodexReleaseAudit/media-candidate-20261008/source-evidence/pin-license-texts/`. Refuses overwrite conflict or non-regular target. GitHub API failure, hash mismatch or unsupported source is never classified as verified. No upstream code executed, no private credentials in Git.
2. Added `tests/scripts/nativeMediaLicenseAudit.node-test.mjs`: six new Node contract tests for pinned source URLs, unsafe file names, deduplication, SHA integrity, timeout/fail closure, missing root files, and withholding approval. Added to `test:media-candidate-contract`; preserved all 12 prior contract tests.
3. Actual successful Github source audit on B5: for **43 enabled libraries / 42 distinct source repos**, **29 GitHub repos** have pinned root license/notice/author files archived; **49** such files were independently verified and saved only on B5. All GitHub targets responded and passed object hash verification. **13 non-GitHub source locations** are not covered by this tool; they remain unverified. Results at `docs/legal/native-media-license-availability.json`; all distribution and license review statuses are false.
4. Added `docs/legal/NATIVE-MEDIA-LICENSE-EVIDENCE.md`, updated `FFMPEG-SOURCE-CANDIDATE.md`, `RELEASE-COMPLIANCE.md`, `public-release-audit.md`, `public-release-changed-files.md`. Examples reveal GPL license text can coexist with LGPL/MPL text in the same distribution: do not classify GPL-only based on substring; manual per-file licensing is still required.

## Verification

- `npm run test:media-candidate-contract`: PASS **18/18** (12 existing + 6 new), no skips.
- Exact GitHub upstream license text audit: PASS **29/29 eligible repositories**, 49 root evidence blobs verified, zero API/hash failures. Archive state and SHA-256 in machine JSON; not a legal or binary correspondence PASS.
- `npm run test:release-gate`: **PASS / exit 0** on B5; retained full log in ignored `.tmp/ffmpeg-license-availability-release-gate.log`. Vitest **132 files / 1182 tests** without skipping; Node native-media contracts **18/18**. Preexisting lint/typecheck/build, Windows file, migrations, 320k performance and native ABI gates remain enforced, no budgets were relaxed. Full gate runtime **211.00 seconds**.
- `test:electron-smoke`: **PASS / exit 0**, genuine Electron44.7.0 / ABI149, main/preload/safeStorage and sandbox. `test:renderer-security-smoke`: **PASS / exit 0**, external resource access and protocol/IPC controls. Exact logs kept in ignored `.tmp/ffmpeg-license-electron-smoke.log` and `.tmp/ffmpeg-license-renderer-smoke.log`.
- New `dist:win`, `verify:artifact`, `release:metadata`, `test:packaged-smoke`, `test:installer-smoke`: NOT_RUN this iteration; no binary/installer/frontend/application code touched. Historical unsigned setup SHA still belongs to prior commit; new desktop delivery is **NOT_DELIVERED**.
- Real stable clean Win11 without tools, history signed upgrade, source binary reproducible build and full legal compliance: NOT_RUN.

## Risks and follow-up

- Root legal texts are not complete source archives or complete nested source notices; only 2/43 full external library source TARs independently archived previously. 13 non-GitHub repos and the entire transitive dependency graph remain unsatisfied.
- Certain roots contain GPL/LGPL/MPL texts: exact applicability depends on build configurations and source-file ownership and needs manual review. No license choice, legal authorization or public binary distribution was granted. Static LGPL relinking and independently verifiable source-binary relationship remain P1 block.
- Daily FFmpeg build retention, project code+assets rights, formal certificate and protected environment, independent QA Win11 and signed historical upgrade, and private-history publication scope remain open. Release gate remains FAIL; Draft PR #24 stays open; no main/tag/public Release changes.

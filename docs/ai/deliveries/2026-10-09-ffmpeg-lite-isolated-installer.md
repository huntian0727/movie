---
date: 2026-10-09
branch: ai/public-release-audit
type: feat
status: PASS_WITH_RISKS
---

# FFmpeg Lite selectable internal Windows package and installer QA

## Context

User approved free MIT-source sharing and first Windows installer without purchasing a code signing certificate. Release goal is simple; never bypass FFmpeg native-binary redistribution rights, user video or SQLite protection, or public-release authorization. Latest starting commit: `94d93136e42ab5297e1254788f48c7d17b4f9b5f`; GitHub Windows CI 37905028671 and Security audit 37905028622 **SUCCESS**. PR #24 Draft; main `807c49585d18c901b199fe0d3d8b0dbf31eb4114` unchanged.

All commands run exclusively on **home MP2T8QB5**. Never touched office D200707. Required checkpoint before source edit: `checkpoint-20261009-164344-94d9313-lite-candidate-isolated-packaging-20261009`, home backup `2026-10-09_08-44-08-950_lite-candidate-isolated-packaging-20261009`, SQLite quick_check ok, 345892 videos. No real videos or production data modified.

The previous verified BtbN unsigned-test installer was copied to private HOME `D:\CodexReleaseAudit\ffmpeg-lite-20261009\previous-btbn-unsigned-qa` BEFORE replacing only the ignored disposable build output; no production desktop shortcut was modified.

## Changes

- Pinned upstream `serversideup/ffmpeg-lgpl-builds` Windows FFmpeg/FFprobe 8.1.2 pair: release tag `v8.1.2-27`, archive 27,486,819 bytes, SHA-256 `fb2de01912edb449a5eba1cc487696c7f71ebb7b325e5c5c69434642ec2ba6b0`. All 13 archive file SHA values are in `scripts/native-media-lite.lock.json`; includes **five** runtime DLLs, LGPL license, source and other legal notices. All approvals remain false.
- `scripts/prepare-lite-media.mjs` validates TAR flat filenames before extraction, rejects symlinks and unexpected files, hash-checks source/staging contents, writes QA-only `SOURCE-STATUS.txt` noting explicitly missing GCC runtime exception in upstream package.
- `scripts/prepare-native-media.mjs` and `scripts/media-variant.mjs`: no environment override means **existing BtbN toolchain unchanged**. Exact `MOVIE_MEDIA_VARIANT=lite-candidate` selects ignored `.tmp/native-media-lite-tools` from exact SHA-locked tarball. Reject unknown variants and allow optional external `MOVIE_LITE_MEDIA_ARCHIVE` file ONLY after archive integrity validation.
- `scripts/run-electron-builder.mjs`, `scripts/release-engineering.mjs`: carry explicit mediaVariant into build flavor and select exact allowed native inputs. `lite-candidate` is forbidden for signed or public builds; available **only for isolated unsigned internal QA**. All five DLLs and upstream legal notices go into `resources/media-tools`; no PATH fallback.
- `scripts/verify-packaged-artifact.mjs`: ensure package flavor matches selected variant, PE x64 architecture and exact upstream file hashes for EXE, DLL and LGPL notices. Synthetic installer/SQLite preservation QA remains unchanged.
- New `tests/scripts/mediaVariant.node-test.mjs` with four Node contract tests; included in original release gate (18 -> **22**).
- `docs/legal/FFMPEG-LITE-QA.md` describes actual tests and exact public release limitations.

## Verification

**B5, real Windows processes:**
- Exact tar.gz and 13 input hashes: PASS. Independent isolated MP4/MKV synthetic metadata + JPEG cover/timeline: PASS.
- `npm run test:media-candidate-contract`: PASS **22/22**.
- `MOVIE_MEDIA_VARIANT=lite-candidate npm run prepare:media-tools`: PASS.
- `... npm run package:dir`: PASS, Electron 44.7.0, unsigned isolated identity. `... npm run verify:artifact`: PASS, 3461 app.asar entries, bundled native input SHA matched.
- `... npm run test:packaged-smoke`: PASS, packaged Electron, SQLite quick_check/reopen, one synthetic video and UI/statistics queries.
- `... npm run dist:win`: PASS, genuine NSIS x64 setup. `... npm run release:metadata`: PASS; installer SHA metadata and actual file match. Size: **137,020,508 bytes**, SHA-256 `0314a5f6bcbabe701ac62dad3852f424f7efa0f276de8f4b4c312426e72e175f` (initial pre-commit candidate; if rebuilt after a new commit, regenerate SHA and metadata).
- `... npm run test:installer-smoke`: **PASS**, actual first install, same-version repair, delete-data flag rejected, uninstall, six synthetic video/SQLite sentinels intact, formal production shortcuts/registry unchanged.
- `npm run test:release-gate` (default BtbN compatibility): **PASS / exit 0** on B5, 132 Vitest files / **1,183 tests all pass**, all prior Windows-safety, SQLite migration and 320k performance gates retained; 22/22 additional Node native media contracts. Full run 214.62 seconds; exact log `.tmp/lite-variant-release-gate.log`.
- This iteration's clean stable **Windows 11 without developer tools** and prior signed-release upgrade remain **NOT_RUN**. B5 is Windows Insider with tools, not proof of clean-user system acceptance.

## Risks and follow-up

- Upstream `SOURCE.txt` references `GCC-RUNTIME-LIBRARY-EXCEPTION.txt` but the upstream archived release does NOT contain it. Third-party source correspondence, full permissions/notices, GCC runtime exception and LGPL 2.1 static-link relicensing/relinkability duties are **UNRESOLVED**. This Lite QA package **must not be published**.
- Candidate supports tested MP4 and MKV / thumbnail / metadata, but the whole NAS video codec matrix, performance, older formats and real Windows 11 stable install are NOT_RUN.
- The project MIT grant permits source sharing but cannot relicense FFmpeg or imported third-party code. The unsigned-public-release profile and its compliance/safety gates are **not implemented** in this iteration; existing `unsigned-test-build` is not a public installer.
- The actual desktop install/shortcut of the user was not changed and **桌面版本尚未交付**. Source code modifications and QA builds stay on the PR branch until full approval. No main merge, public tag or GitHub Release.

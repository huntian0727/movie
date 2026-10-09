---
date: 2026-10-09
branch: ai/public-release-audit
type: fix
status: PASS_WITH_OPEN_PUBLISH_BLOCKERS
---

# Windows CI portability fixes and reproducible Lite-native SPDX bill of materials

## Context

User requested to proceed with remaining release readiness work independently on **home computer MP2T8QB5 only**. Never touched unrelated office computer D200707. Starting commit `36a19520ffe2a71211bfa2a9550aa121b1c0a4da` clean on `ai/public-release-audit` with Draft PR #24; `main=807c49585d18c901b199fe0d3d8b0dbf31eb4114` unchanged.

Latest upstream GitHub Windows CI #37913880108 **FAILED** with 1186/1188 Vitest passing (two failures): `agentManagementScripts.test.ts` external PowerShell/Git handoff test exceeded 5s on Windows Actions, and `releaseEngineering.test.mjs` expected the genuine GCC notice SHA-256 `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74` but repository Windows CI checked-out text differed (`90077ba...fa6`) due CRLF/LF conversion. Security audit was successful; Windows installer job was skipped by the failing upstream check.

Before changing any files, created full backup `2026-10-09_10-12-25-539_ci-stability-native-sbom-20261009` and pushed Git checkpoint `checkpoint-20261009-181222-36a1952-ci-stability-native-sbom-20261009`. Actual SQLite quick_check=ok, 345892 existing video index entries. No real media or installed desktop shortcut changed.

## Changes

1. Extend `.gitattributes` with `docs/legal/GCC-RUNTIME-LIBRARY-EXCEPTION.txt -text` to **preserve the original bytes** of this upstream legal notice through Git checkout. Verified staged Git blob SHA-256 equals the exact local archived original, both `9d6b43ce...90f74`; CI test now asserts this attribute is retained. No global normalization or source reset.
2. Give only the slow, subprocess-heavy `writes Web Advisor handoffs only to direct markdown children` integration test a 40,000ms Vitest allowance, retaining PowerShell subprocess's 30,000ms limit and every path, branch, push and validation assertion. Do not alter global Vitest settings or skip any existing tests.
3. Implement `scripts/generate-native-lite-sbom.mjs` which reads only pinned B5 Lite staging, verifies all 13 upstream file hashes plus copied license and status, and emits deterministic `docs/legal/FFMPEG-LITE-SBOM.spdx.json` (SPDX 2.3). Includes **7** hashed native binaries: FFmpeg, FFprobe, oneVPL, OpenH264, winpthreads, libgcc and libstdc++. `licenseConcluded`/`licenseDeclared` deliberately `NOASSERTION`; upstream exact FFmpeg 8.1.2 identified but unknown exact bundled MSYS2 DLL package revisions are **not invented**.
4. Add 3 Node contract tests `tests/scripts/nativeLiteSbom.node-test.mjs`, and `npm run release:sbom-lite`. The script declines unsafe paths, unpinned changes, legal approval flags, or source-file modifications. Existing `test:media-candidate-contract` now includes these tests (22 -> 25). For Lite builds, `scripts/write-release-metadata.mjs` automatically writes the same verified SBOM alongside installer metadata and adds its SHA-256 to `SHA256SUMS.txt`; the installer remains withheld for public distribution.
5. Create `docs/legal/BINARY-SOURCE-MAP.md`, `docs/legal/THIRD_PARTY_NOTICES.md` with each DLL, literal locked source hash and only grounded version clues (e.g. oneVPL PE resource 2.17.0.0 **not exact MSYS2 package version**); identify 5 runtime DLL version/source/build-record gaps and LGPL-related materials outstanding. Raw FFmpeg TAR, build scripts and test-only native binaries continue to live only on B5 isolated D drive, never in Git.

## Verification

- Verified exact **staged Git blob** and source file SHA-256 in same B5 local worktree, both `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74`; was previously a mismatch in Actions due Git checkout, not a fabricated original SHA.
- `npm run release:sbom-lite`: PASS, 7 exact source-matched binary SHA entries. The independently generated Lite NSIS release metadata now automatically contains the same 7-bin SBOM with SHA256 `3bd6555b3ceb7e6756f4a94de6bb272fe30b5d86c8403130f67f58a958e57886` in metadata and SHA256SUMS (two lines: internal unsigned candidate and SPDX). All approval flags remain false.
- `npm run test:media-candidate-contract`: PASS 25/25 (all previous 22 + 3 new).
- Focused `vitest run tests/scripts/agentManagementScripts.test.ts tests/scripts/releaseEngineering.test.mjs` three consecutive runs: **37/37 PASS in each of three runs**, 14.04s, 14.07s and 14.04s. No skipped assertions or external Git/PowerShell tests.
- `npm run test:release-gate`: **PASS / exit 0**, 132 Vitest files, **1,188 / 1,188** test cases passed, plus **25 / 25** Node native media contract tests. Runtime 212.04s on HOME B5; full log `.tmp/ci-sbom-full-release-gate.log`.
- `npm run test:electron-smoke`: **PASS / exit 0** (Electron 44.7.0 ABI149, main/preload/DPAPI); `npm run test:renderer-security-smoke`: **PASS / exit 0** (IPC and external resources denied), B5 logs `.tmp/ci-sbom-electron-smoke.log` and `.tmp/ci-sbom-renderer-smoke.log`.
- Isolated FFmpeg Lite real B5 packaging QA: `npm run dist:win` **PASS**, `npm run verify:artifact` **PASS** (3461 ASAR entries), `npm run release:metadata` **PASS** (7-file SPDX included, exact SHA256 matches `build-metadata.json.materials[0].sha256` and one line of 2-line `SHA256SUMS.txt`), `npm run test:installer-smoke` **PASS**: real NSIS install/repair/uninstall and explicit delete-data flag rejection; all synthetic video/SQLite sentinel hashes remained intact, production registration/shortcuts unchanged. Isolated log files in ignored `.tmp/ci-sbom-lite-*`.
- Latest GitHub CI after this commit: PENDING until workflow status confirmed; old failure is not new success.
- Stable clean Win11 without dev tools, actual community installer installation and manual playback test: NOT RUN. No new packaged desktop output, shortcut or public installer is delivered.

## Risks and follow-up

- An SPDX document with verified hashes is **not** proof of copyright permissions or compliance. Intel oneVPL / Cisco OpenH264 / GCC and mingw-w64 specific MSYS2 package versions, complete corresponding source/build traces, actual GPL runtime exception applicability and LGPL static relinking materials remain unresolved. This is source/provenance cataloging, not a legal release permit.
- Dedicated public unsigned `community` release channel exists but intentionally fails closed: `build/release-approval.json.approved=false`, all native binary source approval false; no public asset may be uploaded.
- Prior unapproved lite installer passed isolated B5 NSIS smoke; it is not a public community build and must not be relabeled. `main`, public tags and Releases unchanged. **桌面版本尚未交付**.

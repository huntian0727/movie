---
date: 2026-10-09
branch: ai/public-release-audit
type: docs
status: PASS_WITH_RISKS
---

# Free personal sharing: MIT source license and no certificate purchase

## Context

The maintainer explicitly requested a **free-to-share personal open-source project**, no future commercialisation plan, minimal launch overhead, and no paid Windows signing certificate for the first public version. Prior GitHub Windows CI and Security audit for baseline `9c8c739260ca9714f3e8c5d6e623bedc7c8acf08` were both SUCCESS. All local project operations were executed **only on home MP2T8QB5**; office D200707 was not used. Existing Draft PR #24 continues without merging `main`.

Before source edits, required project snapshot PASS: `2026-10-09_08-12-41-649_free-sharing-mit-license-20261009` (SQLite 0.87 GB / 345892 videos / quick_check ok), pushed Git checkpoint `checkpoint-20261009-161237-9c8c739-free-sharing-mit-license-20261009`. No production app, real media, SQLite records, shortcut, existing installer binary or main changes.

## Changes

- Replace the placeholder top-level `LICENSE` with the complete standard MIT grant, `Copyright (c) 2026 huntian0727`. Owner's no-commercialisation **intent is not a no-commercial-use restriction**: MIT allows reuse including commercial use, provided notices are preserved.
- Set project `license=MIT` in `package.json` and root lockfile `packages[""].license` while preserving `private:true` (no npm registry publication).
- Set `build/release-approval.json` `applicationLicense=MIT` and pin actual MIT LICENSE SHA-256 `67a5adfb62bada52970413032afa8c5dce450e09c32d5abe99b472c16f2d4e72`. Crucially, `approved:false`, `ownersConfirmed:false`, all native `sourceComplianceApproved:false`, `manualQaApproved:false`, `legacyUpgradeApproved:false` remain unchanged. Owner intent does not license third-party materials or certify the pending executable.
- Update README, legal status, public-release audit and installation instructions: source is MIT and freely shareable; unsigned binary as a *future* option; current `unsigned-test-build` is NOT an approved public installer. Correct README's outdated 6.1.1/4.0.2 and unsafe-fast-delete narrative to the current reviewed branch.
- Add `.gitattributes` to force LF in `LICENSE`, `package-lock.json` and `build/release-approval.json`, preventing Windows Git checkout newline changes from invalidating SHA-256 approval evidence.
- Add an executable release-engineering contract test verifying current repo MIT bytes/manifest alignment and ensuring approvals remain fail-closed.
- Explore externally published reproducible LGPL-only FFmpeg/ffprobe 8.1.2 Windows x64 candidate from `serversideup/ffmpeg-lgpl-builds`, exact release `v8.1.2-27`; checksum manifest SHA `fb2de01912edb449a5eba1cc487696c7f71ebb7b325e5c5c69434642ec2ba6b0`. **Downloaded binary is 0 bytes** due blocked/hung home network; aborted the download and **did not test or integrate the candidate**. This is a *possible simplification*, not a legally/technically approved build.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/scripts/releaseEngineering.test.mjs`: **PASS, 21/21**, including MIT declaration, matching license SHA-256 and binary source approvals remaining false.
- `npm run test:release-gate`: **PASS / exit 0** on B5. Vitest **132 files / 1183 tests PASS**, added MIT invariant included, native media contracts **18/18 PASS**; no failed/skipped tests. Full elapsed **211.12 s**, Vitest stage **176.46 s**. Full log at ignored `.tmp/free-sharing-mit-release-gate.log`.
- Latest baseline CI (prior commit `9c8c739`): Windows CI SUCCESS, Security audit SUCCESS (not claims about this MIT change).
- `npm run test:electron-smoke`: **PASS / exit0** (Electron44.7.0, ABI149, main/preload/DPAPI); `npm run test:renderer-security-smoke`: **PASS / exit0** (sandbox/IPC/protocol restrictions). Full local logs in ignored `.tmp/free-sharing-mit-electron-smoke.log` and `.tmp/free-sharing-mit-renderer-smoke.log`.
- `dist:win`, `verify:artifact`, `release:metadata`, `test:packaged-smoke`, `test:installer-smoke`: NOT_RUN this iteration because application/native tools/installer inputs were not changed. Existing desktop version **NOT_DELIVERED**.

## Risks and follow-up

- MIT is valid for copyrighted work the owner controls; it does not supersede FFmpeg/FFprobe, Electron, NativeHost third-party portions, fonts, icons, or external screenshot asset rights. Do not put the current 43-external-dependency BtbN FFmpeg executable on public GitHub Releases as a "free" installer without its corresponding source/licensing conditions.
- Current tag workflow only supports signed-public builds and isolated unsigned-test builds. A **real** unsigned public build identity and fail-closed compliance/QA checks are needed if no certificate is purchased; never rename the isolated QA artifact into a release.
- Candidate FFmpeg download/network issue and real feature tests remain unresolved. Stable clean Win11 no Node, previous signed version upgrade and actual manual install/launch remain NOT_RUN. No public tag, binary Release or main merge was performed.

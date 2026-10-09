---
date: 2026-10-09
branch: ai/public-release-audit
type: feat
status: PASS_WITH_RISKS
---

# Independent unsigned public release profile prepared, public binary withheld

## Context

Maintainer explicitly selected MIT for owned code, free sharing and no paid Windows code signing cert. Public release must remain blocked until real binary rights and clean Windows QA succeed. Starting commit `b53d0bde9fee785a931813df4355d71664aa8e1b` on clean home worktree; previous commit Windows CI and Security audit both completed SUCCESS. PR #24 Draft, `main=807c49585d18c901b199fe0d3d8b0dbf31eb4114` unchanged.

Worked **only** on HOME computer MP2T8QB5; never touched unrelated office D200707. Required backup before change: checkpoint `checkpoint-20261009-173526-b53d0bd-unsigned-public-release-gate-20261009`, full home snapshot `2026-10-09_09-35-30-110_unsigned-public-release-gate-20261009`, 0.87 GB SQLite, 345892 video indexes, `quick_check=ok`.

## Changes

- `scripts/release-engineering.mjs`: explicit `unsigned-public-release` profile, never triggered by default tags. Public profile is a **new separate install identity**: appId `com.local.video.manager.community`, GUID `b73f7252-798d-48d9-b877-19fb6d355f83`, installer output `release/unsigned-public-release`, name `拉面影视-免费分享版`, own package/Windows data path. No upgrade of the user's existing signed app or internal unsigned-test build.
- The public profile needs explicit GitHub Actions tag exactly `v<package.version>`, pinned `lite-candidate`, license + binary compliance + manual QA env flags and `RELEASE_UNSIGNED_PUBLIC_ACKNOWLEDGED=true`. It **rejects all signing credentials** and requires unsigned Authenticode status.
- **Approval manifest remains false.** Even if flags are forged, `verifyFormalApproval` validates owner authorization, application license and lock hash, source attribution and SHA-256 evidence for FFmpeg, FFprobe, NativeHost and all **five** required Lite runtime DLLs, plus actual clean-Windows evidence. Distinct community identity avoids touching legacy version; prior signed upgrade evidence is demanded only for old signed-profile in-place updates.
- Electron builder config uses unsigned PE/installer and unique NSIS GUID, independent desktop/start menu shortcut names, no file associations; all existing NSIS protections against junctions, unknown nonempty dirs, unsafe paths and deleting user data are kept. Existing BtbN default and isolated unsigned-test build unchanged.
- Independently archived complete **FFmpeg 8.1.2 source tar** (11,710,924 bytes, SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`, full 10,230 tar entries) and **tagged Windows build scripts** (32,279 bytes, SHA-256 `8da5eba4cb5662b4744403bf2de8b70a5a274de200ce39ae69f2602e404f439e`, 12 entries) on B5 D drive, pinning script commit `8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac`. FFmpeg upstream source and producer scripts are now local verified evidence, but exact source/binary correspondence for the third-party MSYS2 DLLs and LGPL static relinking materials remains outstanding.
- Track the **genuine GCC Runtime Library Exception v3.1 text** from pinned GCC upstream mirror `gcc-mirror/gcc` tag `releases/gcc-16.1.0`, source file `COPYING.RUNTIME`, SHA `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74`, in `docs/legal/GCC-RUNTIME-LIBRARY-EXCEPTION.txt` included in packaged legal directory. This locates and includes text omitted in the upstream Lite TAR; it is **not** proof the exact DLL source/build/relinkability obligations are fully met.
- Tests `tests/scripts/releaseEngineering.test.mjs` expanded for brand-new identity, signature status, tag/flag/secrets gating, binary SHA and manual-QA evidence failures, installer restrictions and GCC notice integrity.
- Updated `docs/release-workflow.md` and `docs/legal/FFMPEG-LITE-QA.md` with the precise release eligibility vs. local QA distinction.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/scripts/releaseEngineering.test.mjs`: PASS **26/26**.
- `npm run test:release-gate`: **PASS / exit 0** on HOME B5: 132 Vitest files, **1,188/1,188 tests passed**, 22/22 separate native media contract tests. No scope reductions to prior Windows file safety, DB migration, security or performance gate. Runtime **212.72 seconds**, Vitest stage 177.81 seconds. Log `.tmp/unsigned-public-gate.log`.
- `npm run test:electron-smoke`: **PASS / exit 0**, Electron44.7.0/ABI149 main/preload/safeStorage. `test:renderer-security-smoke`: **PASS / exit 0**, renderer asset/origin/IPC security and external source blocking. Home logs `.tmp/unsigned-community-electron-smoke.log` and `.tmp/unsigned-community-renderer-smoke.log`.
- Public-mode **fail-closed dry run PASS** on home B5: set explicit tag `refs/tags/v0.1.15` and all release flags including unsigned acknowledgement to true, without signing keys; called real `node scripts/run-electron-builder.mjs --dir`. The command **exited 1**, stopped at `Owner-approved release manifest ... required`, and did not build a community installer. Log `.tmp/community-release-fail-closed.log`; this is the expected safe outcome.
- Real clean Windows 11 no-Node no-dev-tools installation: NOT_RUN. Real public community upgrade/installer identity smoke: NOT_RUN, because public gate prevents build until source and QA approved. Historical isolated Lite unsigned-test installer QA PASS from prior commit remains historical evidence, not newly re-run this iteration.
- No production desktop changes, no new official shortcut. **桌面版本尚未交付**. No main merge, no public tag, no GitHub Release.

## Risks and follow-up

- FFmpeg LGPL2.1 static linking and external components still require correct corresponding source, relinkability materials, accurate DLL notices and actual source-to-binary linkage. The GCC runtime exception text is now present but its application to the exact bundled libgcc/libstdc++ DLL builds needs confirmation.
- A dedicated GitHub Actions protected public workflow/release uploader and real community-identity installation QA still need implementation. Do NOT relabel isolated `unsigned-test-build` as a public binary. A separate public package cannot bypass owner authorization, source evidence or clean Windows no-Node QA.
- Project source MIT is live; no Authenticode certificate purchase is planned. Public release remains **FAIL** until the external binary rights and clean Win11 verification are actually closed and final publishing authorized.

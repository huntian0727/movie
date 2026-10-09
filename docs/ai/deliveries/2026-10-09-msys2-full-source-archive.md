---
date: 2026-10-09
branch: ai/public-release-audit
type: docs
status: PASS_WITH_RELEASE_BLOCKERS
---

# Complete LGPL-candidate MSYS2 source archives and internal corresponding-source kit

## Context

User requested continuation and minimum-friction free/unsigned community installer release. Worked solely on HOME MP2T8QB5 (remote UUID 7ae059ed-2bf1-4a1a-b55c-04636fdcdeb0); NEVER accessed office D200707. Worktree began clean at commit `4013e5f01ac1e9123103aaa2d4765bdaf5b49f1f` on PR #24 Draft, `origin/main=807c49585d18c901b199fe0d3d8b0dbf31eb4114` unchanged. GitHub Windows CI `37927837499` and Security audit `37927837335` for starting commit confirmed SUCCESS.

Required pre-edit B5 backup `2026-10-09_12-11-28-542_msys2-source-archive-release-kit-20261009` completed and checkpoint `checkpoint-20261009-201123-4013e5f-msys2-source-archive-release-kit-20261009` pushed. B5 SQLite quick_check=ok, 345892 indexed videos; did not modify videos, production SQLite, real desktop app or Windows registry.

## Changes

- Resolved previously slow MSYS2 source archive download by testing region mirrors: USTC mirror transferred 1MiB in ~0.45s; original `repo.msys2.org` timed out after 15s with ~0.5MiB. Fully retrieved four **historical exact matching versions** of official MSYS2 source package archives:
  - `mingw-w64-libvpl-2.17.0-1.src.tar.zst`: 12,923,471 bytes, SHA-256 `4bd392447f4a5f986462cfc412ab7ace3dfaa980e53b41f35d08c44b8b31cc9d` (7 members).
  - `mingw-w64-openh264-2.6.0-1.src.tar.zst`: 60,290,594 bytes, SHA-256 `034c3e843d8bd584ffd95d89c8cdecfb71a0191afaacc2ccb6b12ca3119541ac` (5 members).
  - `mingw-w64-winpthreads-14.0.0.r179.g24aaa6147-1.src.tar.zst`: 51,994,397 bytes, SHA-256 `5b1659ca665551b57c3c4b0075ef323839457eeb62c3cc3855df9149f84978d6` (35 members, including original mingw-w64 git material).
  - `mingw-w64-gcc-16.1.0-5.src.tar.zst`: 102,479,270 bytes, SHA-256 `947166ed372d28ab8ffa25a66bc5e37a60a42e96a686424ce58cad304fcaea15` (19 members, including gcc-16.1.0.tar.xz + signature).
- Added `sourceArchiveSha256` pins to the original `scripts/native-msys2-package.lock.json` (this already pins matching four binary packages and all five DLLs). Created `scripts/audit-native-msys2-sources.mjs` to verify four archive SHA-256, tar path integrity, source payload + .SRCINFO, and **source-internal PKGBUILD bytes equal original binary's BUILDINFO PKGBUILD hash**. All four hashes precisely match: 4/4. Writes deterministic `docs/legal/MSYS2-EXACT-SOURCE-EVIDENCE.json`, status `releaseAllowed=false`.
- Added `tests/scripts/msys2SourceArchives.node-test.mjs` with unsafe path/duplicate/omitted source/false approval regression checks; wired into `npm run test:media-candidate-contract` (29 -> **31**).
- Added `npm run audit:msys2-sources` (requires existing private source inputs in `MOVIE_MSYS2_SOURCE_DIR`, never dynamically trusts remote arbitrary archives).
- Prepared complete private **corresponding-source review ZIP** combining FFmpeg 8.1.2 upstream source, pinned upstream Windows build scripts, four exact MSYS2 source archives, GCC runtime exception and third-party legal/source evidence. Final validated B5 file:
  `D:\CodexReleaseAudit\ffmpeg-lite-20261009\FFmpeg-Lite-8.1.2-corresponding-sources-REVIEW-v2.zip`;
  **239,488,121 bytes**, SHA-256 **`6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`**. ZIP independently streamed and hashed all **13** embedded source/docs files against embedded SHA256SUMS. Original initial review ZIP retained; v2 is latest. **Not uploaded or publicly distributed.**
- Updated `SOURCE_OFFER.md`, `LGPL_COMPLIANCE_CHECKLIST.md`, `BINARY-SOURCE-MAP.md`, `FFMPEG-LITE-QA.md`, `RELEASE_CHECKLIST.md` and public-release audit to explicitly close the *source archives not obtained* blocker while retaining static LGPL/relinking, licensing final applicability and clean-Win11/manual QA blockers.

## Verification

- Original B5 TAR listings all 4 archives PASS; actual run `MOVIE_MSYS2_SOURCE_DIR=... npm run audit:msys2-sources`: **PASS**, 4/4 archive hash, 4/4 source PKGBUILD vs binary PKGBUILD; report explicitly disallows publication.
- `npm run test:media-candidate-contract`: **PASS, 31/31** Node tests, original 29 plus 2 new.
- Actual ZIP content extraction/streaming SHA check: **PASS, 13/13** stored manifest entries, total archive SHA above; ZIP is only a private review candidate.
- `npm run test:release-gate`: **PASS / exit0** on B5. 132 Vitest files, **1,188/1,188 tests passed**, plus **31/31** Node native media/source provenance contract tests. Total elapsed 222.69s, Vitest stage 187.87s; log `.tmp/msys2-sources-release-gate.log`. Retained original safety, SQLite, performance and Windows file checks.
- `npm run typecheck`: **PASS / exit0**; `npm run test:electron-smoke`: **PASS / exit0**, Electron44.7.0 and DPAPI smoke; `npm run test:renderer-security-smoke`: **PASS / exit0**, bridge and asset sandbox/external script origin restrictions. Logs `.tmp/msys2-sources-types.log`, `.tmp/msys2-sources-electron.log`, `.tmp/msys2-sources-renderer.log`.
- At time of local source validation, prior commit `4013e5f` GitHub Windows CI run `37927837499` and Security audit run `37927837335` both **SUCCESS**. This iteration's new PR push still requires separate GitHub CI confirmation; never substitute prior commit status.

## Risks and follow-up

- This closes **actual source archive retrieval** and exact source-recipe identity; it does NOT automatically prove all LGPL obligations (static relink/rebuild/modify conditions, actual notice set and applicability), nor has the user-facing source kit been publicly uploaded. Need final applicable license review and real Release source assets when approved.
- No stable clean Windows 11, no developer tools user install/playback/scanning QA has been performed. B5 Insider and GitHub Windows Server runner are not a substitute for a clean supported desktop.
- `build/release-approval.json.approved=false`, PR #24 Draft, main unaffected. No public installer/tag/release and no change to existing desktop shortcut. **桌面版本尚未交付**.

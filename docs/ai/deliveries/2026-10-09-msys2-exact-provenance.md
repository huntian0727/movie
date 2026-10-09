---
date: 2026-10-09
branch: ai/public-release-audit
type: audit-automation
status: PASS_WITH_PUBLIC_RELEASE_BLOCKERS
---

# FFmpeg Lite: five exact DLLs matched to four original MSYS2 packages and their Git build recipes

## Context and safety

User requested direct continuation after reconnecting Desktop Commander Remote. Device discovery confirmed HOME **MP2T8QB5** online. **Never used office D200707**. Worktree initially clean on `ai/public-release-audit` HEAD `930db99dab08b47693d3b5c1d492a14fc00dbf80`, PR #24 Draft; `origin/main=807c49585d18c901b199fe0d3d8b0dbf31eb4114` unmodified. Latest GitHub Windows CI run `37917800078` confirmed **SUCCESS** (all four jobs including isolated NSIS), security audit `37917800118` SUCCESS. This closed the previous CI Windows line-ending/test timeout failure.

Required B5 pre-edit snapshot **PASS**: `2026-10-09_11-00-24-722_native-msys2-provenance-20261009`, checkpoint `checkpoint-20261009-190020-930db99-native-msys2-provenance-20261009` successfully pushed, SQLite quick_check=ok, 345892 video records. No user library videos, app shortcut, production install or real SQLite mutated.

## Primary provenance breakthrough

The **actual upstream FFmpeg Lite** release `serversideup/ffmpeg-lgpl-builds v8.1.2-27` has original Windows GitHub Actions run [29303740323](https://github.com/serversideup/ffmpeg-lgpl-builds/actions/runs/29303740323), job `86992785957`, build from exact Git commit `8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac` on 2026-07-14. Its 1,134,382-byte build log was obtained on B5 private audit storage; `Packages (96)` log line identifies exact contemporaneous MSYS2 packages.

Four historical package archives were downloaded from `https://repo.msys2.org/mingw/mingw64/`, independently hashed and inspected by `tar` without installing them to Windows:

- `mingw-w64-x86_64-libvpl 2.17.0-1`: package SHA-256 `3899c8e75e9b62cfff8b0987d70da3e2c142a075b94af45d868c3453d86aaece`; `libvpl-2.dll` hash **exactly matches** project Lite binary.
- `mingw-w64-x86_64-openh264 2.6.0-1`: package SHA `73988ace22048df42ae973873b770710bf019e0b070fc2b8084f1cf1993e14f0`; `libopenh264-7.dll` exact match.
- `mingw-w64-x86_64-libwinpthread 14.0.0.r179.g24aaa6147-1`: package SHA `8f12dc1be987165faab6363a159921553b4a2ac64e443cd0e7c501c343c2a92a`; `libwinpthread-1.dll` exact match.
- `mingw-w64-x86_64-gcc-libs 16.1.0-5`: package SHA `aa560f5438c35b71c3e7b24fd5becbca028f70c5b4d1f1697a86ff80fec947da`; both `libgcc_s_seh-1.dll` and `libstdc++-6.dll` exact match.

Every file was checked against the existing immutable `scripts/native-media-lite.lock.json` SHA, and every `.PKGINFO/.BUILDINFO` package name, version, build date, license and build recipe SHA were read from actual archived bytes, not guessed from current MSYS2 versions.

Then four historical `PKGBUILD` were fetched from `msys2/MINGW-packages` Git history at the package build timestamp, and actual recipe bytes matched **4/4 `.BUILDINFO.pkgbuild_sha256sum`**:

- libvpl commit `6b0a4b9cab8a1dd3c2d8cb9ba9e7b119c272b6b5`, recipe SHA `25e2112ac24d70e385bdf6b2152d3c362f0b590dcd1eff6c07bed79c5bf5be65`.
- OpenH264 commit `3aeb27c5a29430a0851fd7b1d5f22c5f84e396bf`, SHA `f6e6c2b17f8724b2e471cd3252115ef9a4d9f569287521a5e688224261318393`.
- winpthreads commit `b67b45ace97d4bc6dabdd56177ff3952d049a145`, SHA `55d530e1f88cf65e90ed44b5dca0a7bea41cfa530a87df742e9874a543e8b074`.
- GCC commit `18aeb95f69dd6bd3c9172a938c9fd35491536410`, SHA `40f248fa589babd9315cc589a76a0c00939355bd68c92287a2dcb7d1acb58f96`.

This closes **exact binary package provenance and build recipe identity**, not all source obligations.

## Changes

- New `scripts/native-msys2-package.lock.json`: four binary package immutable SHA hashes, contemporaneous versions, exact MSYS2 PKGBUILD Git commits and four exact build-script hashes.
- New `scripts/audit-native-msys2-packages.mjs`: no arbitrary internet download. Requires explicit local archive and PKGBUILD folders; fail-closed verifies original archives, `.PKGINFO/.BUILDINFO`, all five DLL bytes vs Lite lock, all four PKGBUILD SHA vs actual BUILDINFO, and writes deterministic `docs/legal/MSYS2-EXACT-PACKAGE-EVIDENCE.json`.
- New `tests/scripts/msys2PackageProvenance.node-test.mjs`: package metadata parser and SHA failure cases, identity invariants, exact report pins and `releaseAllowed:false`; added to `npm run test:media-candidate-contract`.
- New `npm run audit:msys2-provenance` (opt-in local provenance audit).
- `scripts/generate-native-lite-sbom.mjs` updates source notes to reflect verifiable exact MSYS2 package records without claiming legal signoff. Regenerated `docs/legal/FFMPEG-LITE-SBOM.spdx.json`; retains **NOASSERTION** SPDX conclusions and `CANDIDATE_NOT_APPROVED`.
- Updated `docs/legal/BINARY-SOURCE-MAP.md`, `THIRD_PARTY_NOTICES.md`, `FFMPEG-LITE-QA.md` with true contemporaneous versions, hash, URLs, source-only links and remaining requirements.

## Verification

- Original July 2026 upstream Windows workflow job and log: directly fetched via GitHub CLI, run SUCCESS, source commit confirmed.
- MSYS2 archives: all **4/4** archive SHA and syntax PASS; historical binary DLL SHA **5/5 identical** to exact Lite archive.
- Historical MSYS2 Git `PKGBUILD`: **4/4** byte-for-byte SHA identical to actual archival `.BUILDINFO.pkgbuild_sha256sum`.
- `npm run audit:msys2-provenance` with two explicit local B5 isolated evidence directories: PASS, 4 source packages / 5 DLLs / 4 recipes.
- `npm run test:media-candidate-contract`: PASS **29/29** contract tests (the previous suite was 25).
- `npm run release:sbom-lite`: PASS, 7 binary SPDX entries with source notes correctly updated for exact 4/4 package PKGBUILD and 5/5 DLL evidence; SPDX `licenseConcluded=NOASSERTION`, and no release approval. Another small text-only status update in the generator was made during the build regression run; following Node candidate contract and SBOM generation both passed.
- `npm run test:release-gate`: **PASS / exit 0** on HOME B5: **132 Vitest files / 1,188 of 1,188 tests PASS**, plus **29 of 29** Node media provenance contract tests. Total runtime **223.90s**, Vitest stage 189.65s. No prior Windows data safety, SQLite migration, test coverage or 320k record performance gate reduced. Raw ignored log `.tmp/msys2-exact-20261009-release-gate.log`.
- `npm run test:electron-smoke`: **PASS / exit0** (Electron44.7 ABI149, preloads and DPAPI); `npm run test:renderer-security-smoke`: **PASS / exit0** (sandboxed origin/bridge, external scripts and protocols blocked).
- Latest GitHub CI after new commit: NOT YET RUN, must wait for PR workflow.
- App runtime, Electron executable and package binary unchanged: no new desktop build or shortcut verified; **桌面版本尚未交付**.

## Risks and follow-up

MSYS2 publishes corresponding source-only tarballs for these exact packages at `https://repo.msys2.org/mingw/sources/`. HTTP HEAD returned 200 for all four, size estimates ~13 MB + 60 MB + 52 MB + 102 MB. Attempting to download on B5 transferred only ~3.5 MB in 110s before curl timeout; stopped the slow batch to respect user's request for **fastest simple release**. **Do not claim those source archives are already fully retrieved**. All source tar URLs are pinned in machine evidence report.

The exact correspondence of FFmpeg's upstream source & build script was previously obtained. Project remains blocked on verification/delivery approach for source-only packages and third-party notices/LGPL obligations, plus a genuinely clean stable Windows 11 no-Node user installation test. Do not approve `build/release-approval.json`, merge main, rename QA EXE to public, or tag/publish without final release authorization. Stable Win11 test is NOT_RUN; no installer published.
